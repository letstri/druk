import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

const porcelain = (dir: string) =>
  Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: dir }).stdout.toString()

/** A repository with one commit, one modified file and one untracked file. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', 'a.ts', 'b.ts')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'c.ts'), 'gamma\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()
const openPanel = (t: Harness) => press(t, i => void i.pressKeys([TOGGLE]))

test('Space stages the row under the cursor and moves it under Staged Changes', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'a.ts')

  await press(t, i => void i.typeText(' '))
  await until(t, () => porcelain(dir).startsWith('M  a.ts'))
  await untilFrame(t, 'Staged Changes')

  const shown = frame(t)
  expect(shown).toContain('Staged Changes')
  // c.ts is untracked and was not touched, so the other heading is still there.
  expect(shown).toContain('Changes')
  expect(shown).toContain('c.ts')
})

test('Space on a staged row takes it back out of the index', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'Staged Changes')

  await press(t, i => void i.typeText(' '))
  await until(t, () => !porcelain(dir).includes('M  a.ts'))
  expect(porcelain(dir)).toContain(' M a.ts')
})

test('Space on a heading stages everything under it, untracked files included', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'c.ts')

  // Up from the first change onto the `Changes` heading, which stands for all
  // of them — VS Code's `+` on a group header.
  await press(t, i => i.pressArrow('up'))
  await press(t, i => void i.typeText(' '))
  await until(t, () => porcelain(dir).includes('A  c.ts'))
  expect(porcelain(dir)).toContain('M  a.ts')
})

/** Auto sidebar on the harness's 80-column terminal. The heading's `+`/`−` sits in it. */
const SIDEBAR = 30

/** The heading row (`▾ Changes`, not `▾ Staged Changes`) and the column of its button. */
const headingButton = (t: Harness, label: 'Changes' | 'Staged Changes' | 'Merge Changes') => {
  const lines = frame(t).split('\n')
  const y = lines.findIndex(line => line.slice(0, SIDEBAR).includes(`▾ ${label}`))
  const slice = y >= 0 ? lines[y]!.slice(0, SIDEBAR) : ''
  const glyph = label === 'Staged Changes' ? '−' : '+'
  return { y, x: slice.lastIndexOf(glyph), slice }
}

test('a heading always wears its +/−, even when the cursor is on a file', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'Staged Changes')

  // The panel lands on the first file, not the heading. Both headings still
  // carry the control — that is how every file under one is staged at once
  // without walking onto the heading first.
  const staged = headingButton(t, 'Staged Changes')
  const changes = headingButton(t, 'Changes')
  expect(staged.slice).toContain('−')
  expect(changes.slice).toContain('+')

  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await untilFrame(t, 'c.ts')
  expect(headingButton(t, 'Staged Changes').slice).toContain('−')
  expect(headingButton(t, 'Changes').slice).toContain('+')
})

test('clicking + on the Changes heading stages every file under it', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'c.ts')

  const { x, y } = headingButton(t, 'Changes')
  expect(x).toBeGreaterThan(0)
  await t.mockMouse.click(x, y)
  await until(t, () => porcelain(dir).includes('A  c.ts'))
  expect(porcelain(dir)).toContain('M  a.ts')
  // The click is the button, not the heading: folding would hide the files.
  expect(frame(t)).toContain('a.ts')
  expect(frame(t)).toContain('c.ts')
})

test('clicking − on the Staged Changes heading takes every file back out', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts', 'c.ts')
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'Staged Changes')

  const { x, y } = headingButton(t, 'Staged Changes')
  expect(x).toBeGreaterThan(0)
  await t.mockMouse.click(x, y)
  await until(t, () => porcelain(dir).includes(' M a.ts'))
  expect(porcelain(dir)).toContain('?? c.ts')
  expect(porcelain(dir)).not.toContain('M  a.ts')
})

test('with something staged, c commits exactly that and skips the file picker', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'Staged Changes')

  await press(t, i => void i.typeText('c'))
  // Straight to the message: the index is the selection, so there is nothing
  // left to pick.
  expect(frame(t)).toContain('Commit message')
  expect(frame(t)).not.toContain('Commit — ')
  await press(t, i => void i.typeText('staged only'))
  await press(t, i => i.pressEnter())
  await until(t, () => porcelain(dir).startsWith('?? c.ts'))

  const log = Bun.spawnSync(['git', 'log', '-1', '--name-only', '--format=%s'], { cwd: dir })
  const out = log.stdout.toString()
  expect(out).toContain('staged only')
  expect(out).toContain('a.ts')
  expect(out).not.toContain('c.ts')
})

test('a staged row diffs HEAD against the index, not against the working tree', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  // Edited again after staging: the file is under both headings, and each side
  // has a different diff to show.
  writeFileSync(join(dir, 'a.ts'), 'alpha changed twice\n')
  const t = await launch(dir)
  await openPanel(t)
  await untilFrame(t, 'Staged Changes')

  // The staged row is the first change; ↓ against it counts as a landing.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('up'))
  await untilFrame(t, 'alpha changed')
  const staged = frame(t)
  expect(staged).toContain('alpha changed')
  expect(staged).not.toContain('alpha changed twice')

  // Down past the `Changes` heading to the unstaged copy of the same file.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await untilFrame(t, 'alpha changed twice')
  expect(frame(t)).toContain('alpha changed twice')
})
