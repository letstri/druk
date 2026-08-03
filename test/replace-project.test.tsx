import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  runCommand,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'a.ts': 'const OLD = 1\n',
  'b.ts': 'let OLD = 2\n',
  'c.ts': 'var OLD = 3\n',
}

const SIZE = { width: 100, height: 30 }

/** Open project replace from the palette and type both fields. */
async function openReplace(t: Harness, query: string, replacement: string) {
  await runCommand(t, 'Replace in project')
  await press(t, i => void i.typeText(query)) // nothing selected: the query field starts focused
  await press(t, i => i.pressTab())
  await press(t, i => void i.typeText(replacement))
  await settle(t, 300) // past the scan debounce
}

test('the palette opens project search with the replace field showing', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await runCommand(t, 'Replace in project')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Search in project')
  expect(frame).toContain('Replace with…')
})

test('rows preview the hit beside its replacement', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openReplace(t, 'OLD', 'NEW')
  expect(t.captureCharFrame()).toContain('const OLDNEW = 1')
})

test('replace-all routes buffers and disk, and says which was which', async () => {
  const dir = fixture(PROJECT)
  // Autosave off: switching tabs would otherwise save b.ts and unmake the dirty case.
  const t = await launch(dir, { autoSaveOnBlur: false }, SIZE)
  // b.ts: open and made dirty. a.ts: open, clean, and active. c.ts: closed.
  await openFile(t, 'b.ts')
  await press(t, i => void i.typeText('x'))
  await openFile(t, 'a.ts')

  await openReplace(t, 'OLD', 'NEW')
  await press(t, i => i.pressKey('a', { ctrl: true }))
  await untilFrame(t, 'Replace 3 matches in 3 files')
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Replaced 3 matches in 3 files')

  const frame = t.captureCharFrame()
  expect(frame).toContain('2 in open tabs, unsaved')
  // The two buffer-routed files kept their disks; the closed one was written.
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const OLD = 1\n')
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('let OLD = 2\n')
  expect(readFileSync(join(dir, 'c.ts'), 'utf8')).toBe('var NEW = 3\n')
  // The active buffer took the edit — and can give it back as one undo step.
  expect(frame).toContain('const NEW = 1')
  await press(t, i => i.pressKey('z', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('const OLD = 1')
})

test('the confirm suspends the panel: one Enter, no stray apply', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, SIZE)
  await openReplace(t, 'OLD', 'NEW')
  await press(t, i => i.pressKey('a', { ctrl: true }))
  await untilFrame(t, 'Replace 3 matches')

  // Escape cancels the modal and only the modal — the panel keeps its state.
  await pressEscape(t)
  await settle(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Replace 3 matches')
  expect(frame).toContain('Search in project')
  expect(frame).toContain('const OLDNEW = 1')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const OLD = 1\n')

  // Confirming closes the panel and applies everywhere — exactly once.
  await press(t, i => i.pressKey('a', { ctrl: true }))
  await untilFrame(t, 'Replace 3 matches')
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Replaced 3 matches in 3 files')
  expect(t.captureCharFrame()).not.toContain('Search in project')
  expect(readFileSync(join(dir, 'c.ts'), 'utf8')).toBe('var NEW = 3\n')
})

test('Enter applies one match and the row leaves the list', async () => {
  const dir = fixture({ 'a.ts': 'OLD\n', 'b.ts': 'OLD\n' })
  const t = await launch(dir, {}, SIZE)
  await openReplace(t, 'OLD', 'NEW')
  await untilFrame(t, '1 of 2 in 2 files')

  await press(t, i => i.pressEnter())
  await settle(t, 300)
  await untilFrame(t, '1 of 1 in 1 file')
  // One file changed on disk, the other is still listed for its turn.
  const disks = [
    readFileSync(join(dir, 'a.ts'), 'utf8'),
    readFileSync(join(dir, 'b.ts'), 'utf8'),
  ].toSorted()
  expect(disks).toEqual(['NEW\n', 'OLD\n'])
})

test('a match drifted on disk is refused, not applied askew', async () => {
  const dir = fixture({ 'a.ts': 'keep OLD here\n' })
  const t = await launch(dir, {}, SIZE)
  await openReplace(t, 'OLD', 'NEW')
  await untilFrame(t, '1 of 1')

  writeFileSync(join(dir, 'a.ts'), 'the line moved\nkeep OLD here\n')
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'That match is gone')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('the line moved\nkeep OLD here\n')
})

test('an invalid regex refuses with its own message', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await runCommand(t, 'Replace in project')
  await press(t, i => void i.typeText('(('))
  await press(t, i => i.pressKey('r', { ctrl: true })) // regex mode
  await press(t, i => i.pressKey('a', { ctrl: true }))
  await untilFrame(t, 'Invalid regex')
})

test('the confirm counts past the panel display cap', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `f${i}.ts`,
      Array.from({ length: 10 }, () => 'OLD\n').join(''),
    ]),
  )
  const t = await launch(fixture(many), {}, SIZE)
  await openReplace(t, 'OLD', 'NEW')
  await untilFrame(t, '200+')
  await press(t, i => i.pressKey('a', { ctrl: true }))
  await untilFrame(t, 'Replace 300 matches in 30 files')
})
