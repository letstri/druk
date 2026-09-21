import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ctrlOpt,
  fixture,
  launch,
  press,
  pressEscape,
  runCommand,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const TOGGLE = ctrlOpt('g')

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString())
  }
}

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('Ctrl+Opt+G shows the changed files, Esc puts the tree back', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressKeys([TOGGLE]))

  const open = frame(t)
  expect(open).toContain('Changes')
  expect(open).toContain('a.ts')
  expect(open).not.toContain('EXPLORER')

  await pressEscape(t)
  expect(frame(t)).toContain('EXPLORER')
})

test('outside a repository the panel says so instead of listing nothing', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n' }))
  await press(t, (i) => i.pressKeys([TOGGLE]))
  expect(frame(t)).toContain('open a repository to use git')
})

test('the cursor opens the diff for the file it lands on', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await press(t, (i) => i.pressArrow('down'))
  await settle(t, 100)

  const shown = frame(t)
  expect(shown).toContain('alpha changed')
  expect(shown).toContain('+1 −1')
  expect(shown).toContain('Space stage')
})

test('Enter opens the changed file itself, over the diff the cursor showed', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await press(t, (i) => i.pressArrow('down'))
  await untilFrame(t, '+1 −1')

  await press(t, (i) => i.pressEnter())
  await settle(t, 100)

  const shown = frame(t)
  expect(shown).toContain('alpha changed')
  expect(shown).not.toContain('+1 −1')
  expect(shown).toContain('a.ts')
})

test('c commits the change from the panel, p reports on push', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await press(t, (i) => i.typeText('c'))
  await press(t, (i) => i.typeText('panel commit'))
  await press(t, (i) => i.pressEnter())
  expect(frame(t)).toContain('commit all')
  await press(t, (i) => i.pressEnter())
  await settle(t, 200)

  expect(frame(t)).toContain('no changes')
  const log = Bun.spawnSync(['git', 'log', '-1', '--format=%s'], { cwd: dir })
  expect(log.stdout.toString().trim()).toBe('panel commit')

  await press(t, (i) => i.typeText('p'))
  await settle(t, 300)
  expect(frame(t)).not.toContain('EXPLORER')
})

test('the peek strip advertises the panel keys, not the tree ones', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await press(t, (i) => i.pressKey('k', { ctrl: true }))

  const peek = frame(t)
  expect(peek).toContain('Keys · source control')
  expect(peek).toContain('↑↓ · Enter')
  expect(peek).toContain('Space a c d')
  expect(peek).not.toContain('a / A')
})

test('the palette opens the panel too', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  expect(frame(t)).toContain('▾ Changes')
})

test('Shift+Tab walks the strip: Files → Git → Review → Ext → Files', async () => {
  const t = await launch(repo())
  expect(frame(t)).toContain('EXPLORER')

  await press(t, (i) => i.pressTab({ shift: true }))
  const open = frame(t)
  expect(open).toContain('▾ Changes')
  expect(open).toContain('a.ts')

  await press(t, (i) => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('0 items')

  await press(t, (i) => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('INSTALLED')

  await press(t, (i) => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('EXPLORER')
})

test('r in the panel opens the review, which is a button of its own', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressTab({ shift: true }))
  expect(frame(t)).toContain('▾ Changes')

  await press(t, (i) => i.typeText('r'))
  const open = frame(t)
  expect(open).toContain('0 items')
  expect(open).not.toContain('▾ Changes')
  expect(open).toContain('Review')
})

test('plain Tab still hands the keyboard to the editor, from either view', async () => {
  const t = await launch(repo())
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())

  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.typeText('Z'))
  expect(frame(t)).toContain('Zalpha changed')
})

test('the panel draws file icons in the glyph column', async () => {
  const dir = fixture({ 'notes.md': '# hi\n', 'src/a.ts': 'alpha\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'src/a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'notes.md'), '# changed\n')

  const t = await launch(dir, { iconTheme: 'unicode' })
  await press(t, (i) => i.pressTab({ shift: true }))
  await untilFrame(t, 'a.ts')
  const open = frame(t)

  expect(open).toContain('◆ a.ts')
  expect(open).toContain('¶ notes.md')
  expect(open).toContain('▾ src')
})

test('the status mark holds its column as the cursor walks onto a row', async () => {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))
  const markColumn = () =>
    frame(t)
      .split('\n')
      .find((row) => row.includes('b.ts'))
      ?.indexOf('M')

  const resting = markColumn()
  expect(resting).toBeGreaterThan(0)

  // Down twice: past the heading and a.ts, onto b.ts, where the `+` is drawn.
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressArrow('down'))
  expect(frame(t)).toContain('M +')
  expect(markColumn()).toBe(resting)
})
