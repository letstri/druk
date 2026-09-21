import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { HATCH } from '../src/ui/DiffView'
import {
  launch,
  openDiff,
  openPalette,
  press,
  pressEscape,
  runCommand,
  settle,
  until,
  untilFrame,
  untilGone,
} from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

interface Span {
  text: string
  fg: unknown
}

function repo(files: Record<string, string>) {
  const dir = tempDir('druk-diff-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('the diff shows deletions, additions and both line numbers', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\n')

  // Wide: the hints only spell the layout out when the row can afford it.
  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  // The renderable assembles its panes on a queued microtask: one flush is not always enough.
  await untilFrame(t, '+ four')

  const frame = t.captureCharFrame()
  expect(frame).toContain('a.ts')
  expect(frame).toContain('+2 −1')
  expect(frame).toContain('- TWO'.replace('TWO', 'two'))
  expect(frame).toContain('+ TWO')
  expect(frame).toContain('+ four')
  expect(frame).toContain('inline')
})

test('"Diff current file" opens the panel on that file, cursor and all', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await runCommand(t, 'Diff current file')

  let frame = t.captureCharFrame()
  expect(frame).toContain('▾ Changes')
  expect(frame).toContain('+ BETA')

  await press(t, (i) => i.pressArrow('up'))
  frame = t.captureCharFrame()
  expect(frame).toContain('+ ALPHA')
})

test('"Diff current file" on an unchanged file says so instead of opening', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await runCommand(t, 'Diff current file')

  const frame = t.captureCharFrame()
  expect(frame).toContain('No changes in a.ts')
  expect(frame).not.toContain('Esc close')
})

test('"Show all changes" is a palette command', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await openPalette(t)
  await press(t, (i) => i.typeText('all changes'))
  expect(t.captureCharFrame()).toContain('Show all changes')
})

test('Tab into the page, then s switches to side-by-side and back', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n')

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressKey('s'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('side-by-side')
  expect(frame).toContain('- two')
  expect(frame).toContain('+ TWO')

  await press(t, (i) => i.pressKey('s'))
  expect(t.captureCharFrame()).not.toContain('side-by-side')
})

test('an added file stays inline in split view — there is no side to compare', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'b.ts'), 'one\ntwo\n')

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ two')

  expect(t.captureCharFrame()).not.toContain(HATCH.repeat(4))
})

test('split view hatches the rows it pads a side with', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\nfive\n')

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ five')

  const run = HATCH.repeat(8)
  await until(t, () => t.captureCharFrame().includes(run))
  const hatched = t
    .captureCharFrame()
    .split('\n')
    .filter((line) => line.includes(run))
  expect(hatched.length).toBeGreaterThanOrEqual(2)
  for (const line of hatched) {
    expect(line).toMatch(new RegExp(`${HATCH} +\\d+ \\+ `, 'u'))
  }
})

test('the hatch fills the pane again when the diff is given more columns', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\nfive\n')

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ five')
  const run = HATCH.repeat(8)
  await until(t, () => t.captureCharFrame().includes(run))
  const width = (frame: string) =>
    Math.max(
      ...frame.split('\n').map((line) => line.match(/╱+/u)?.[0].length ?? 0)
    )
  const narrow = width(t.captureCharFrame())

  await press(t, (i) => i.pressKey('b', { ctrl: true }))
  await until(t, () => width(t.captureCharFrame()) > narrow)
  const hatched = t
    .captureCharFrame()
    .split('\n')
    .filter((line) => line.includes(run))
  for (const line of hatched) {
    expect(line).toMatch(new RegExp(`${HATCH} +\\d+ \\+ `, 'u'))
  }
})

test('every change is on the page at once, whichever row the cursor is on', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')
  expect(t.captureCharFrame()).toContain('+ BETA')

  await press(t, (i) => i.pressArrow('down'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('+ ALPHA')
  expect(frame).toContain('+ BETA')
})

test('Esc hands the page back to the panel, and the panel closes it', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40, width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')
  await press(t, (i) => i.pressTab())
  expect(t.captureCharFrame()).toContain('Esc sidebar')

  await pressEscape(t)
  await settle(t)
  expect(t.captureCharFrame()).toContain('+ ALPHA')

  await pressEscape(t)
  await untilGone(t, '+ ALPHA')
})

test('with the sidebar hidden, Esc closes the diff — there is no panel to go back to', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await press(t, (i) => i.pressKey('b', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Esc close')

  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('+ ALPHA')
})

test('an untracked file diffs as all additions', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'new.ts'), 'fresh\nlines\n')

  const t = await launch(dir)
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('new.ts')
  expect(frame).toContain('+ fresh')
  expect(frame).toContain('+ lines')
})

test('long unchanged stretches stay out of the hunks', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  const changed = [...lines]
  changed[0] = 'CHANGED'
  writeFileSync(join(dir, 'a.ts'), `${changed.join('\n')}\n`)

  const t = await launch(dir, {}, { height: 30 })
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('CHANGED')
  expect(frame).toContain('line2')
  expect(frame).not.toContain('line10')
})

test('the mouse wheel scrolls the diff', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  writeFileSync(join(dir, 'a.ts'), `${lines.map((l) => `${l}!`).join('\n')}\n`)

  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, '- line0')

  // A flush per tick: the renderer drops events sent faster than its minimum scroll interval.
  for (let n = 0; n < 6; n += 1) {
    await t.mockMouse.scroll(60, 10, 'down')
  }
  await untilGone(t, '- line0')

  for (let n = 0; n < 8; n += 1) {
    await t.mockMouse.scroll(60, 10, 'up')
  }
  await untilFrame(t, '- line0')
})

test('PageDown and Ctrl+D both page the diff, Ctrl+U comes back', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  writeFileSync(join(dir, 'a.ts'), `${lines.map((l) => `${l}!`).join('\n')}\n`)

  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, '- line0')
  await press(t, (i) => i.pressTab())

  await press(t, (i) => i.pressKeys(['\u001B[6~']))
  await untilGone(t, '- line0')

  await press(t, (i) => i.pressKey('u', { ctrl: true }))
  await untilFrame(t, '- line0')

  await press(t, (i) => i.pressKey('d', { ctrl: true }))
  await untilGone(t, '- line0')
})

test('the diff is a page: sidebar, tabs and status bar all stay around it', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('+1 −1')
  expect(frame).toContain('▾ Changes')
  const lines = frame.split('\n')
  expect(lines[0]).toContain('a.ts')
  expect(lines.at(-2)).toContain('⎇ main')
})

test('the palette opens over the diff, and Ctrl+W closes the page', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await openDiff(t)

  await openPalette(t)
  expect(t.captureCharFrame()).toContain('Commands')
  await pressEscape(t)
  expect(t.captureCharFrame()).toContain('+1 −1')

  await press(t, (i) => i.pressKey('w', { ctrl: true }))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('+1 −1')
  expect(frame).toContain('ONE')
  expect(frame.split('\n')[0]).toContain('a.ts')
})

test('a long path is cut from the left so the file header stays on screen', async () => {
  const dir = tempDir('druk-diff-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  const deep =
    'a-very/deeply/nested/folder/structure/with-a-quite-long-file-name.test.tsx'
  mkdirSync(join(dir, deep, '..'), { recursive: true })
  writeFileSync(join(dir, deep), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, deep), 'ONE\n')

  const t = await launch(dir)
  await openDiff(t)

  const headerRow = t
    .captureCharFrame()
    .split('\n')
    .find((row) => row.includes('name.test.tsx'))!
  expect(headerRow).toContain('…')
  expect(headerRow).toContain('name.test.tsx')
})

test('removed lines highlight like added ones in split view', async () => {
  const base = [
    'export function App() {',
    '  return (',
    '    <Show>',
    '      <EditorPane',
    '        path={workspace.activePath()}',
    '        theme={config.theme}',
    '      />',
    '    </Show>',
    '  )',
    '}',
    '',
  ].join('\n')
  const dir = repo({ 'a.tsx': base })
  writeFileSync(
    join(dir, 'a.tsx'),
    base.replace('theme={config.theme}', 'mode={config.mode}')
  )

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  const removedLine = () =>
    (t.captureSpans() as { lines: { spans: Span[] }[] }).lines
      .map((line) => line.spans)
      .find((line) => line.some((span) => span.text === 'theme'))
  await until(t, () => removedLine() !== undefined)

  const spans = removedLine()!
  const fgOf = (text: string) =>
    String(spans.find((span) => span.text === text)?.fg)
  expect(fgOf('theme')).toBe(fgOf('mode')!)
  expect(fgOf('theme')).not.toBe(fgOf('=')!)
})

test('a clean working tree has no row to open a diff from', async () => {
  const t = await launch(repo({ 'a.ts': 'alpha\n' }))
  await runCommand(t, 'Source control')
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('no changes')
  expect(frame).not.toContain('Esc close')
})

test('unsaved edits diff against HEAD before the file is saved', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'saved\n')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.typeText('typed '))
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('- alpha')
  expect(frame).toContain('+ typed saved')
})

function lock(v: (i: number) => string, count = 6000): string {
  const entry = (i: number) =>
    `    "node_modules/pkg-${i}": { "version": "${v(i)}", "integrity": "sha512-${'x'.repeat(40)}" }`
  return `{\n  "packages": {\n${Array.from({ length: count }, (_, i) => entry(i)).join(',\n')}\n  }\n}\n`
}

test('a huge change renders plain and cut instead of stalling on syntax color', async () => {
  const dir = repo({ 'package-lock.json': lock((i) => `1.0.${i}`) })
  writeFileSync(
    join(dir, 'package-lock.json'),
    lock((i) => (i % 2 ? `1.0.${i}` : `2.0.${i}`))
  )

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '−5999 · first 10000 lines')
  await untilFrame(t, '"1.0.0"')

  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressKeys(['[6~']))
  await untilGone(t, '"1.0.0"')
})

test('a patch of thousands of rows goes plain even under the byte limit', async () => {
  const dir = repo({ 'package-lock.json': lock((i) => `1.0.${i}`, 1500) })
  writeFileSync(
    join(dir, 'package-lock.json'),
    lock((i) => (i % 2 ? `1.0.${i}` : `2.0.${i}`), 1500)
  )

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await untilFrame(t, 'plain (large file)')
  expect(t.captureCharFrame()).not.toContain('first 10000 lines')
})

test('a huge change and a small one stack, each gated on its own', async () => {
  const dir = repo({
    'a.ts': 'const a = 1\n',
    'package-lock.json': lock((i) => `1.0.${i}`),
  })
  writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
  writeFileSync(
    join(dir, 'package-lock.json'),
    lock((i) => (i % 2 ? `1.0.${i}` : `2.0.${i}`))
  )

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ const a = 2')
  await untilFrame(t, 'first 10000 lines')
  await untilFrame(t, '"1.0.0"')
  expect(t.captureCharFrame()).toContain('+ const a = 2')
})
