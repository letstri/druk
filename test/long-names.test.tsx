import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fixture, launch, openComparison, press, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'

/**
 * A `<text>` wraps by word unless it is told not to, so anywhere the user's own
 * words reach — a branch named after an issue title, a path, a diagnostic — used
 * to grow its row instead of being cut, and take the panel's layout with it.
 * Each of these draws one of those surfaces at a hostile length and asserts the
 * data still costs the rows it is given.
 */

const BRANCH =
  '49-tanstack-start-setupmiddleware-callback-imports-are-not-pruned-from-the-client-bundle'

/** Frame rows carrying `needle` — the count is what wrapping used to inflate. */
const rowsWith = (t: Harness, needle: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter(row => row.includes(needle)).length

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-long-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'init.defaultBranch', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('the branch picker gives a long branch and its upstream one row each', async () => {
  const dir = repo()
  const bare = mkdtempSync(join(tmpdir(), 'druk-long-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir })
  execFileSync('git', ['switch', '-q', '-c', BRANCH], { cwd: dir })
  execFileSync('git', ['push', '-q', '--set-upstream', 'origin', BRANCH], { cwd: dir })
  execFileSync('git', ['switch', '-q', 'main'], { cwd: dir })

  const t = await launch(dir, {}, { width: 100, height: 40 })
  await runCommand(t, 'Switch branch')
  await untilFrame(t, 'Switch to branch')

  // The local branch and its remote-tracking ref: two rows, not one row per
  // fifty characters. The upstream is the trap — it is a branch name too, and
  // left whole it squeezed the name's box to nothing and wrapped it downward.
  expect(rowsWith(t, '49-tanstack')).toBe(2)
  expect(t.captureCharFrame()).toContain('↑↓ move · Enter pick · Esc cancel')
}, 20000)

test('the status bar keeps its hints beside a long branch', async () => {
  const dir = repo()
  execFileSync('git', ['switch', '-q', '-c', BRANCH], { cwd: dir })

  const t = await launch(dir, {}, { width: 100, height: 30 })
  await untilFrame(t, '⎇ 49-tanstack')

  const bar = t
    .captureCharFrame()
    .split('\n')
    .find(row => row.includes('⎇'))!
  expect(bar).toContain('F1 commands')
  expect(bar.length).toBeLessThanOrEqual(100)
  // The welcome screen names the branch too, and its block is sized by its
  // widest row — an uncut one drew over the sidebar rather than being clipped.
  expect(rowsWith(t, 'tanstack-start')).toBe(2)
}, 20000)

test('the settings page keeps a long value on its own row', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { typescriptTsdk: '/a/very/long/path/that/goes/on/and/on/node_modules/typescript/lib' },
    { width: 100, height: 46 },
  )
  await runCommand(t, 'Settings')
  await untilFrame(t, 'TypeScript')

  expect(rowsWith(t, '/a/very/long')).toBe(1)
  // …and on the row its label is on. A value that cannot shrink and is left
  // whole eats the label's columns and wraps the rest into single characters.
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('/a/very/long'))!
  expect(row).toContain('TypeScript')
}, 20000)

test('the problems list gives a long diagnostic one row', async () => {
  const name = `${'component-with-a-really-long-name'.repeat(3)}.ts`
  const dir = fixture({ [name]: 'const a = 1\n' })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        typescript: [process.execPath, join(import.meta.dir, 'fixtures', 'fake-lsp.ts')],
      },
    },
    { width: 100, height: 30 },
    { openFile: join(dir, name) },
  )
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', 15_000)
  await runCommand(t, 'List problems')
  await untilFrame(t, 'Enter jumps', 15_000)

  // The tab strip shortens the name itself, so the modal's row is the only one
  // carrying the whole of it. Fifty of these at three rows apiece is a modal
  // several screens tall.
  expect(rowsWith(t, 'really-long-name')).toBe(1)
}, 40000)

test('the completion menu keeps a huge label, signature and doc inside its box', async () => {
  const dir = fixture({ 'a.ts': '' })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        typescript: [process.execPath, join(import.meta.dir, 'fixtures', 'fake-lsp.ts')],
      },
    },
    { width: 90, height: 30 },
    { openFile: join(dir, 'a.ts') },
  )
  await press(t, input => void input.typeText('long'))
  await untilFrame(t, 'longName', 15_000)

  // One row for the item, whatever its label, signature and origin add up to.
  expect(rowsWith(t, 'longName')).toBe(1)
  // The documentation is one unbreakable word: it has to be cut per row rather
  // than widen the popup past the pane it floats in.
  const frame = t.captureCharFrame()
  expect(frame.split('\n').every(row => row.length <= 90)).toBe(true)
  expect(frame).toContain('unbreakableword')
}, 40_000)

test('the comparison header keeps its rows beside a long branch', async () => {
  const dir = repo()
  execFileSync('git', ['switch', '-q', '-c', BRANCH], { cwd: dir })
  writeFileSync(join(dir, 'b.ts'), 'two\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'a fairly long commit subject about middleware'], {
    cwd: dir,
  })

  const t = await launch(dir, {}, { width: 100, height: 30 })
  await openComparison(t)
  await untilFrame(t, '1 files')

  // The header is five fixed rows: a branch allowed to wrap pushed the base, the
  // summary and the mode line past the fifth, where they are simply gone.
  const frame = t.captureCharFrame()
  expect(frame).toContain('base  main')
  expect(frame).toContain('[Files]  Commits')
}, 30000)

test('the review panel gives a long note and a deep path one row each', async () => {
  const dir = fixture({
    'src/features/authentication/session/refresh-token-rotation.ts': 'const a = 1\n',
  })
  const t = await launch(dir, {}, { width: 100, height: 30 })
  await runCommand(t, 'Open file…')
  await press(t, input => void input.typeText('refresh-token'))
  await press(t, input => input.pressEnter())

  await runCommand(t, 'Note this line as issue')
  await press(
    t,
    input =>
      void input.typeText(
        'this rotation window is far too long a sentence to fit in a sidebar column and it ' +
          'keeps going for a while yet',
      ),
  )
  await press(t, input => input.pressEnter())
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'ISSUE 1')

  // One row for the note and one for the file heading it hangs under: a remark
  // is prose at whatever length it was typed, and the path is four folders deep.
  // The needle for the heading is the path's head, since the tab strip carries
  // the file's name too and shortens it itself.
  expect(rowsWith(t, 'ISSUE 1')).toBe(1)
  expect(rowsWith(t, 'src/features')).toBe(1)

  // And an answer to it, whose author is whatever a writer of the notes file
  // put there: one row, which is also the row the card's copy of it is drawn
  // on — the box floats beside the sidebar, so a second row here would be the
  // reply wrapping in one of the two.
  await press(t, input => input.pressArrow('down'))
  await press(t, input => void input.typeText('r'))
  await press(
    t,
    input =>
      void input.typeText(
        'it is not, the refresh window is measured against the issuer clock and that is the ' +
          'whole of it',
      ),
  )
  await press(t, input => input.pressEnter())
  await untilFrame(t, '↳ you')
  expect(rowsWith(t, '↳ you')).toBe(1)
  expect(rowsWith(t, 'ISSUE 1')).toBe(1)
}, 20000)
