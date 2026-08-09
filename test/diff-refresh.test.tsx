import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  openDiff,
  press,
  pressEscape,
  runCommand,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'

const run = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

/** Two committed files, both changed since — the panel's cursor pages them. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  run(dir, 'init', '-q')
  run(dir, 'config', 'user.email', 'druk@test')
  run(dir, 'config', 'user.name', 'druk')
  run(dir, 'config', 'commit.gpgsign', 'false')
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

/** The panel's first change row: tab strip, view tabs, header, `Changes`. */
const FIRST_ROW = 4

test('Esc closes the diff opened from the panel, not the panel under it', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  await t.mockMouse.click(4, FIRST_ROW)
  await untilFrame(t, 'alpha changed')

  await pressEscape(t)
  const after = frame(t)
  expect(after).not.toContain('alpha changed')
  // The panel is still the sidebar's view: only the page it opened went away.
  expect(after).toContain('▾ Changes')
})

test('a commit elsewhere closes the page for the file it committed', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', 'a.ts')
  run(dir, 'commit', '-qm', 'just a')
  await untilGone(t, 'alpha changed')

  // a.ts lost its row in the panel, so the page it opened goes with it. b.ts is
  // still changed and still listed — nothing has pointed the cursor at it.
  expect(frame(t)).toContain('b.ts')
})

test('an edit elsewhere to the open file rebuilds the page against HEAD', async () => {
  const dir = repo()
  const t = await launch(dir)
  // The file has to be an open tab: that is what the watcher reloads, and the
  // reload is what tells the page to re-read.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  writeFileSync(join(dir, 'a.ts'), 'alpha rewritten\n')
  await untilFrame(t, 'alpha rewritten')

  expect(frame(t)).not.toContain('alpha changed')
})

test('the diff closes itself once nothing is left to show', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'all of it')
  await untilGone(t, 'alpha changed')
})

/**
 * b.ts is an ordinary change. The other three are listed but have nothing to
 * show — a.ts because its change is staged and the working copy was put back,
 * c.ts and d.ts because they are untracked and empty — so their pages are the
 * "No changes in this file" fallback, which takes the `<diff>` renderable away.
 */
function emptyPageRepo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  run(dir, 'init', '-q')
  run(dir, 'config', 'user.email', 'druk@test')
  run(dir, 'config', 'user.name', 'druk')
  run(dir, 'config', 'commit.gpgsign', 'false')
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  run(dir, 'add', 'a.ts')
  writeFileSync(join(dir, 'a.ts'), 'alpha\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')
  writeFileSync(join(dir, 'c.ts'), '')
  writeFileSync(join(dir, 'd.ts'), '')
  return dir
}

/**
 * What the app writes when a key handler throws — nothing may reach it. The
 * throw cannot be trapped as an uncaughtException: OpenTUI's key dispatch wraps
 * every listener in a try/catch and reports the error through console.error.
 */
function watchErrors() {
  const original = console.error
  const seen: string[] = []
  console.error = (...args: unknown[]) => {
    seen.push(args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' '))
  }
  return { seen, stop: () => void (console.error = original) }
}

test('paging between changes with nothing to show keeps drawing them', async () => {
  // Issue #70: the ref is never called back when the `<diff>` goes away, so
  // DiffView kept using a destroyed renderable — "TextBufferView is destroyed".
  const t = await launch(emptyPageRepo())
  const errors = watchErrors()
  try {
    await openDiff(t, 1)
    await untilFrame(t, 'beta changed')

    // b.ts → c.ts drops the `<diff>` renderable, which the reconciler destroys a
    // tick later; d.ts's page is the fallback too, so nothing replaces it.
    await press(t, i => i.pressArrow('down'))
    await untilFrame(t, 'No changes in this file')
    await press(t, i => i.pressArrow('down'))
    await untilFrame(t, 'd.ts')

    // …and back onto a real change, which the destroyed pane must not have cost.
    await press(t, i => i.pressArrow('up'))
    await press(t, i => i.pressArrow('up'))
    await untilFrame(t, 'beta changed')
  } finally {
    errors.stop()
  }
  expect(errors.seen.join('\n')).not.toContain('TextBufferView is destroyed')
})
