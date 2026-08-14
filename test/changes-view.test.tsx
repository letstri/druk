import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ui } from '../src/themes'
import {
  launch,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  until,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (color?: { buffer: Uint8Array }) =>
  color
    ? `#${Array.from(color.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
    : ''

const rowBgs = (t: Harness, y: number) => {
  const frame = t.captureSpans() as unknown as Frame
  return frame.lines[y]?.spans.map(span => hex(span.bg)) ?? []
}

const rowOf = (t: Harness, text: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .findIndex(line => line.includes(text))

const rowsWith = (t: Harness, text: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter(line => line.includes(text)).length

/** A real repository with committed files. */
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-changes-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

const many = (tag: string) => `${Array.from({ length: 40 }, (_, i) => `${tag}${i}`).join('\n')}\n`

test('Show all changes stacks every file in the editor slot', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')

  const frame = t.captureCharFrame()
  expect(frame).toContain('Uncommitted')
  expect(frame).toContain('+ ALPHA')
  expect(frame).toContain('+ BETA')
  expect(frame).toContain('a.ts')
  expect(frame).toContain('b.ts')
  expect(frame).not.toContain('⇄')
})

test('Esc closes the all-changes page back to the editor', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await pressEscape(t)
  await untilGone(t, 'Uncommitted')
})

test('arrows in the panel do not open a one-file diff over the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  await press(t, i => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('Uncommitted')
  expect(frame).not.toContain('⇄')
})

test('a save under the page refreshes the stacked diffs', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  // The file has to be an open tab: that is what the watcher reloads, and the
  // reload is what tells the page to re-read.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  writeFileSync(join(dir, 'a.ts'), 'GAMMA\n')
  await untilFrame(t, '+ GAMMA')
  expect(t.captureCharFrame()).toContain('+ BETA')
})

test('a in the source-control panel opens the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'Changes')
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, 'Uncommitted')
  expect(t.captureCharFrame()).toContain('+ ALPHA')
})

test('a path staged and then edited is two sections', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'BETA\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(join(dir, 'a.ts'), 'GAMMA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'staged')
  const frame = t.captureCharFrame()
  expect(frame).toContain('staged')
  expect(frame).toContain('+ BETA')
  expect(frame).toContain('+ GAMMA')
})

test('Enter on an Incoming commit closes the page so the commit is visible', async () => {
  const base = mkdtempSync(join(tmpdir(), 'druk-changes-sync-'))
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  const mine = join(base, 'mine')
  execFileSync('git', ['clone', '-q', origin, mine])
  const git = (...args: string[]) => execFileSync('git', args, { cwd: mine })
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-qm', 'first')
  git('push', '-q', '-u', 'origin', 'main')

  const theirs = join(base, 'theirs')
  execFileSync('git', ['clone', '-q', origin, theirs])
  execFileSync('git', ['config', 'user.email', 'theirs@example.com'], { cwd: theirs })
  execFileSync('git', ['config', 'user.name', 'Theirs'], { cwd: theirs })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: theirs })
  writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
  execFileSync('git', ['add', '.'], { cwd: theirs })
  execFileSync('git', ['commit', '-qm', 'from elsewhere'], { cwd: theirs })
  execFileSync('git', ['push', '-q'], { cwd: theirs })
  git('fetch', '-q')
  writeFileSync(join(mine, 'a.ts'), 'dirty\n')

  const t = await launch(mine, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await untilFrame(t, 'from elsewhere')
  // Changes heading, the dirty file, Incoming, then the commit.
  await pressTimes(t, 8, i => i.pressArrow('up'))
  await pressTimes(t, 3, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
  await untilFrame(t, 'const r = 1')
})

test('Enter in the panel opens the file and closes the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
  expect(t.captureCharFrame()).toContain('ALPHA')
})

test('opening the page scrolls to the file under the panel cursor', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'b.ts')
  // Heading or a.ts: two downs land on b.ts and stay there.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, 'Uncommitted')
  await untilFrame(t, '+ BETA')
  expect(t.captureCharFrame()).not.toContain('+ new0')
})

test('the page closes once nothing is left to show', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('d'))
  await untilFrame(t, 'Discard changes')
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
})

test('after the list shrinks the page still follows the highlighted file', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n', 'c.ts': 'gamma\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')
  writeFileSync(join(dir, 'c.ts'), 'GAMMA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'c.ts')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, '+ GAMMA')
  await press(t, i => void i.typeText('d'))
  await untilFrame(t, 'Discard changes')
  await press(t, i => i.pressEnter())
  await untilGone(t, '+ GAMMA')
  await untilFrame(t, '+ BETA')
  expect(t.captureCharFrame()).not.toContain('+ new0')
})

test('a file header names the path above the patch and leaves a gap', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')

  const lines = t.captureCharFrame().split('\n')
  const header = lines.findIndex(row => row.includes('▾') && row.includes('a.ts'))
  const patch = lines.findIndex(row => row.includes('+ ALPHA'))
  expect(header).toBeGreaterThanOrEqual(0)
  expect(patch).toBeGreaterThan(header + 1)
  expect(t.captureCharFrame()).toContain('b.ts')
})

test('← folds a file to its header and → opens it again', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  await press(t, i => i.pressTab())
  await press(t, i => i.pressKey('h'))
  await untilGone(t, '+ ALPHA')
  expect(t.captureCharFrame()).toContain('▸')
  expect(t.captureCharFrame()).toContain('a.ts')
  await press(t, i => i.pressKey('l'))
  await untilFrame(t, '+ ALPHA')
  expect(t.captureCharFrame()).toContain('▾')
})

test('Tab and Shift+Tab walk the file headers that ← folds', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  await press(t, i => i.pressTab())
  const a = rowOf(t, '▾ M a.ts')
  const b = rowOf(t, '▾ M b.ts')
  expect(rowBgs(t, a)).toContain(ui.accent)
  expect(rowBgs(t, a)).toContain(ui.treeSelectedBg)
  expect(rowBgs(t, b)).not.toContain(ui.accent)
  await press(t, i => i.pressTab())
  expect(rowBgs(t, rowOf(t, '▾ M b.ts'))).toContain(ui.accent)
  expect(rowBgs(t, rowOf(t, '▾ M a.ts'))).not.toContain(ui.accent)
  await press(t, i => i.pressKey('h'))
  await untilGone(t, '+ BETA')
  expect(t.captureCharFrame()).toContain('+ ALPHA')
  await press(t, i => i.pressTab({ shift: true }))
  await press(t, i => i.pressKey('h'))
  await untilGone(t, '+ ALPHA')
})

test('an added file is labelled new', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'fresh.ts'), 'hello\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'fresh.ts')
  expect(t.captureCharFrame()).toContain('new')
})

test('a scrolled file keeps its header at the top of the page', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M a.ts')
  // Into the page and a screenful down, which pushes a.ts's own header off the
  // top — the sticky overlay is what keeps it on screen.
  await press(t, i => i.pressTab())
  await press(t, i => i.pressKey('d', { ctrl: true }))
  await untilGone(t, '+ new0')
  expect(t.captureCharFrame()).toContain('▾ M a.ts')
})

test('folding the stuck file does not leave its header drawn twice', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M a.ts')
  // Scroll a.ts's own header off the top, so the sticky overlay is holding it.
  await press(t, i => i.pressTab())
  await press(t, i => i.pressKey('d', { ctrl: true }))
  await untilGone(t, '+ new0')

  // Folding moves every header below it. The overlay reads those positions off
  // the renderables, which only move a macrotask later — before the remeasure
  // it kept the pre-fold position and was painted over the one now in flow.
  await press(t, i => i.pressKey('h'))
  await untilFrame(t, '▸ M a.ts')
  await until(t, () => rowsWith(t, '+40 −40') === 1)
})

test('clicking a file above the one on screen scrolls back to it', async () => {
  // Backwards is the direction that broke: a section scrolled off the top has a
  // negative y, and the reveal used to wait for that to turn positive.
  const dir = repo({ 'a.ts': many('old'), 'b.ts': many('old'), 'c.ts': many('old') })
  writeFileSync(join(dir, 'a.ts'), many('alpha'))
  writeFileSync(join(dir, 'b.ts'), many('beta'))
  writeFileSync(join(dir, 'c.ts'), many('gamma'))

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Show all changes')
  // A rewrite leads with its removals, so the page is a screenful of them —
  // which file's header is up is what says where the scroll is.
  await untilFrame(t, '▾ M a.ts')

  await t.mockMouse.click(6, rowOf(t, ' c.ts'))
  await untilFrame(t, '▾ M c.ts')

  await t.mockMouse.click(6, rowOf(t, ' a.ts'))
  await untilFrame(t, '▾ M a.ts')
})

test('Tab walks the files and puts the one it lands on at the top', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': many('old') })
  writeFileSync(join(dir, 'a.ts'), many('alpha'))
  writeFileSync(join(dir, 'b.ts'), many('beta'))

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M a.ts')

  await press(t, i => i.pressTab()) // out of the panel, into the page
  await press(t, i => i.pressTab()) // onto b.ts
  await untilFrame(t, '▾ M b.ts')
  // Rows 0-1 are the tab strip and the page header; row 2 is the rule that
  // separates one file from the last, so a file scrolled to the top of the page
  // has its own header on row 3.
  expect(rowOf(t, '▾ M b.ts')).toBe(3)
})

test('Shift+S in the panel flips the page to side-by-side', async () => {
  // Plain `s` there is sync, and the panel is what holds the keyboard while the
  // page is read — a layout key only the page answered to was unreachable.
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n')

  const t = await launch(dir, {}, { width: 130 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ TWO')
  expect(t.captureCharFrame()).toContain('inline')

  await press(t, i => i.pressKey('s', { shift: true }))
  await untilFrame(t, 'side-by-side')
})

test('flipping the layout keeps the file being read at the top', async () => {
  // Split pads a side row for row, so every section grows — a scroll offset kept
  // across the flip lands the reader somewhere else entirely.
  const dir = repo({ 'a.ts': many('old'), 'b.ts': many('old') })
  writeFileSync(join(dir, 'a.ts'), many('alpha'))
  writeFileSync(join(dir, 'b.ts'), many('beta'))

  const t = await launch(dir, {}, { width: 130, height: 24 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M a.ts')
  await press(t, i => i.pressArrow('down')) // onto b.ts, which goes to the top
  await untilFrame(t, '▾ M b.ts')
  expect(rowOf(t, '▾ M b.ts')).toBe(3)

  await press(t, i => i.pressKey('s', { shift: true }))
  await untilFrame(t, 'side-by-side')
  expect(rowOf(t, '▾ M b.ts')).toBe(3)
})

test('Space on the page stages the file its header names', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M a.ts')
  await press(t, i => i.pressTab()) // into the page, on a.ts's header
  await press(t, i => void i.typeText(' '))

  await until(t, () =>
    execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().startsWith('M  a.ts'),
  )
  // The staged copy is a section of its own, and says which heading it is under.
  await untilFrame(t, 'staged')
})

test('the stage button on a header stages that file, not the row under the pointer', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { width: 130, height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '▾ M b.ts')
  await press(t, i => i.pressTab())
  await press(t, i => i.pressTab()) // Tab walks to b.ts's header and lights it

  const row = rowOf(t, '▾ M b.ts')
  const at = t.captureCharFrame().split('\n')[row]!.lastIndexOf('+')
  await t.mockMouse.click(at, row) // the `+` sits at the right edge of the header
  await until(t, () =>
    execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().includes('M  b.ts'),
  )
  // Clicking the button must not fold the file away — the row's own handler
  // would have done that.
  expect(t.captureCharFrame()).toContain('+ BETA')
})
