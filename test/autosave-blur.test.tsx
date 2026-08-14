import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

/** The terminal's focus-out report (DECSET 1004), as a raw stdin sequence. */
const blur = (t: Harness) => press(t, input => input.pressKey('\u001B[O'))

async function edited(config: { autoSaveOnBlur: boolean }) {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, config)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('EDIT'))
  return { t, dir, file: join(dir, 'a.ts') }
}

test('losing terminal focus saves the dirty buffer', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await blur(t)

  expect(readFileSync(file, 'utf8')).toBe('EDITconst a = 1\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('turned off: blur leaves the buffer dirty', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: false })
  await blur(t)

  expect(readFileSync(file, 'utf8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('unsaved')
})

test('switching tabs saves the buffer left behind', async () => {
  const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
  const t = await launch(dir, { autoSaveOnBlur: true })
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('ONE'))
  await pressEscape(t)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('ONEaaa\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('off: switching tabs leaves the buffer dirty', async () => {
  const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
  const t = await launch(dir, { autoSaveOnBlur: false })
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('ONE'))
  await pressEscape(t)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('aaa\n')
})

test('the last dirty tab is still saved by blur', async () => {
  const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
  const t = await launch(dir, { autoSaveOnBlur: true })
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('ONE'))
  await pressEscape(t)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('TWO'))
  await blur(t)

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('ONEaaa\n')
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('TWObbb\n')
  expect(t.captureCharFrame()).toContain('Saved b.ts')
})

test('leaving the editor for the sidebar saves the buffer', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await pressEscape(t)

  expect(readFileSync(file, 'utf8')).toBe('EDITconst a = 1\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('off: leaving the editor leaves the buffer dirty', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: false })
  await pressEscape(t)

  expect(readFileSync(file, 'utf8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('unsaved')
})

test('a buffer whose file changed on disk is skipped, not clobbered', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  writeFileSync(file, 'theirs from outside\n')
  await settle(t, 300)
  await blur(t)

  expect(readFileSync(file, 'utf8')).toBe('theirs from outside\n')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Changed on disk with unsaved edits: a.ts')
})

test('tab switch skips a buffer whose file changed on disk', async () => {
  const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
  const t = await launch(dir, { autoSaveOnBlur: true })
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('ONE'))
  writeFileSync(join(dir, 'a.ts'), 'theirs from outside\n')
  await settle(t, 300)
  await pressEscape(t)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('theirs from outside\n')
  expect(t.captureCharFrame()).toContain('Changed on disk with unsaved edits: a.ts')
})

test('closing a dirty tab and discarding does not save it', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await press(t, input => input.pressKey('w', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Unsaved edits')
  await press(t, input => input.pressEnter())

  expect(readFileSync(file, 'utf8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('Discarded unsaved edits in a.ts')
})

test('focus-in reports do not save anything', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await press(t, input => input.pressKey('\u001B[I'))

  expect(readFileSync(file, 'utf8')).toBe('const a = 1\n')
})
