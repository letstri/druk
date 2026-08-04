import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, runCommand, settle, untilFrame } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

/** A repository with one commit and one modified file, so the panel has a row. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('Ctrl+Opt+G shows the changed files, Esc puts the tree back', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))

  const open = frame(t)
  expect(open).toContain('◆ review')
  expect(open).toContain('a.ts')
  expect(open).not.toContain('explorer')

  await pressEscape(t)
  expect(frame(t)).toContain('explorer')
})

test('outside a repository the panel says so instead of listing nothing', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n' }))
  await press(t, i => void i.pressKeys([TOGGLE]))
  expect(frame(t)).toContain('open a repository to use git')
})

test('the cursor opens the diff for the file it lands on', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))
  // ↑ at the top counts as a landing, which is how the row already under the
  // cursor gets its page without walking off it first.
  await press(t, i => i.pressArrow('up'))
  await settle(t, 100)

  const shown = frame(t)
  expect(shown).toContain('alpha changed')
  expect(shown).toContain('+1 −1')
  // The keyboard stays in the panel: the arrows are the pager, not the scroll.
  expect(shown).toContain('↑↓ diff')
})

test('Enter opens the changed file itself, over the diff the cursor showed', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await press(t, i => i.pressArrow('up'))
  await untilFrame(t, '+1 −1')

  await press(t, i => i.pressEnter())
  await settle(t, 100)

  const shown = frame(t)
  expect(shown).toContain('alpha changed')
  expect(shown).not.toContain('+1 −1') // the file, not the page
  expect(shown).toContain('a.ts')
})

test('c commits the change from the panel, p reports on push', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))

  // Commit: the file picker, then the message prompt, then a clean panel.
  await press(t, i => void i.typeText('c'))
  expect(frame(t)).toContain('Commit — 1 of 1 files')
  await press(t, i => i.pressEnter())
  expect(frame(t)).toContain('Commit message')
  await press(t, i => void i.typeText('panel commit'))
  await press(t, i => i.pressEnter())
  await settle(t, 200)

  expect(frame(t)).toContain('no changes')
  const log = Bun.spawnSync(['git', 'log', '-1', '--format=%s'], { cwd: dir })
  expect(log.stdout.toString().trim()).toBe('panel commit')

  // Push has no remote to reach; the point is that `p` runs it and reports.
  await press(t, i => void i.typeText('p'))
  await settle(t, 300)
  expect(frame(t)).not.toContain('explorer') // still in the panel, no paste happened
})

test('the peek strip advertises the panel keys, not the tree ones', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await press(t, i => i.pressKey('k', { ctrl: true }))

  const peek = frame(t)
  expect(peek).toContain('Keys · source control')
  expect(peek).toContain('↑↓ · Enter')
  expect(peek).toContain('c p b B r Esc')
  expect(peek).not.toContain('a / A')
})

test('the palette opens the panel too', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  expect(frame(t)).toContain('◆ review')
})

test('Shift+Tab walks the sidebar tab strip: Files → Git → Ext → Files', async () => {
  const t = await launch(repo())
  expect(frame(t)).toContain('explorer')

  await press(t, i => i.pressTab({ shift: true }))
  const open = frame(t)
  expect(open).toContain('◆ review')
  expect(open).toContain('a.ts')

  // The review is not a stop on the strip — it is opened from the panel.
  await press(t, i => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('INSTALLED')

  await press(t, i => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('explorer')
})

test('the panel opens the review and Shift+Tab comes back to it', async () => {
  const t = await launch(repo())
  await press(t, i => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('◆ review')

  await press(t, i => void i.typeText('r'))
  const open = frame(t)
  expect(open).toContain('0 items') // the review panel's own header
  expect(open).not.toContain('◆ review') // …in place of the git panel's
  // Git stays the pressed button: the review is a view of what it lists, which
  // is also what makes that button the way back.
  expect(open).toContain('Git')

  await press(t, i => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('◆ review')
})

test('plain Tab still hands the keyboard to the editor, from either view', async () => {
  const t = await launch(repo())
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // a.ts open, so there is somewhere to go

  await press(t, i => i.pressTab())
  // The editor has it: a bare letter types instead of reaching the tree's keymap.
  await press(t, i => void i.typeText('Z'))
  expect(frame(t)).toContain('Zalpha changed')
})

test('the panel draws file icons in the glyph column', async () => {
  const dir = fixture({ 'src/a.ts': 'alpha\n', 'notes.md': '# hi\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'src/a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'notes.md'), '# changed\n')

  const t = await launch(dir, { iconTheme: 'unicode' })
  await press(t, i => i.pressTab({ shift: true }))
  await untilFrame(t, 'a.ts')
  const open = frame(t)

  expect(open).toContain('◆ a.ts')
  expect(open).toContain('¶ notes.md')
  // The folder row keeps its open/shut form, which is what the glyph column costs.
  expect(open).toContain('▾ src')
})
