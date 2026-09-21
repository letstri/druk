import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

// The terminal's focus-out report (DECSET 1004), as a raw stdin sequence.
const blur = (t: Harness) => press(t, (input) => input.pressKey('\u001B[O'))

const openNext = async (t: Harness) => {
  await press(t, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressEnter())
}

const ONE_FILE = { 'a.ts': 'const a = 1\n' }

async function edited(
  config: { autoSaveOnBlur: boolean },
  files: Record<string, string> = ONE_FILE,
  text = 'EDIT'
) {
  const dir = fixture(files)
  const t = await launch(dir, config)
  await openNext(t)
  await press(t, (input) => input.typeText(text))
  return { dir, file: join(dir, 'a.ts'), t }
}

const TWO = { 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' }

/** a.ts edited to `ONEaaa`, then left for b.ts — the blur the tab switch is. */
async function switched(autoSaveOnBlur: boolean) {
  const { t, dir } = await edited({ autoSaveOnBlur }, TWO, 'ONE')
  await pressEscape(t)
  await openNext(t)
  return { dir, t }
}

test('losing terminal focus saves the dirty buffer', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await blur(t)

  expect(readFileSync(file, 'utf-8')).toBe('EDITconst a = 1\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('turned off: blur leaves the buffer dirty', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: false })
  await blur(t)

  expect(readFileSync(file, 'utf-8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('unsaved')
})

test('switching tabs saves the buffer left behind', async () => {
  const { t, dir } = await switched(true)

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('ONEaaa\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('off: switching tabs leaves the buffer dirty', async () => {
  const { dir } = await switched(false)

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('aaa\n')
})

test('the last dirty tab is still saved by blur', async () => {
  const { t, dir } = await switched(true)
  await press(t, (input) => input.typeText('TWO'))
  await blur(t)

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('ONEaaa\n')
  expect(readFileSync(join(dir, 'b.ts'), 'utf-8')).toBe('TWObbb\n')
  expect(t.captureCharFrame()).toContain('Saved b.ts')
})

test('leaving the editor for the sidebar saves the buffer', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await pressEscape(t)

  expect(readFileSync(file, 'utf-8')).toBe('EDITconst a = 1\n')
  expect(t.captureCharFrame()).toContain('Saved a.ts')
})

test('off: leaving the editor leaves the buffer dirty', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: false })
  await pressEscape(t)

  expect(readFileSync(file, 'utf-8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('unsaved')
})

test('a buffer whose file changed on disk is skipped, not clobbered', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  writeFileSync(file, 'theirs from outside\n')
  await settle(t, 300)
  await blur(t)

  expect(readFileSync(file, 'utf-8')).toBe('theirs from outside\n')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Changed on disk with unsaved edits: a.ts')
})

test('tab switch skips a buffer whose file changed on disk', async () => {
  const { t, dir } = await edited({ autoSaveOnBlur: true }, TWO, 'ONE')
  writeFileSync(join(dir, 'a.ts'), 'theirs from outside\n')
  await settle(t, 300)
  await pressEscape(t)
  await openNext(t)

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('theirs from outside\n')
  expect(t.captureCharFrame()).toContain(
    'Changed on disk with unsaved edits: a.ts'
  )
})

test('closing a dirty tab and discarding does not save it', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await press(t, (input) => input.pressKey('w', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Unsaved edits')
  await press(t, (input) => input.pressEnter())

  expect(readFileSync(file, 'utf-8')).toBe('const a = 1\n')
  expect(t.captureCharFrame()).toContain('Discarded unsaved edits in a.ts')
})

test('focus-in reports do not save anything', async () => {
  const { t, file } = await edited({ autoSaveOnBlur: true })
  await press(t, (input) => input.pressKey('\u001B[I'))

  expect(readFileSync(file, 'utf-8')).toBe('const a = 1\n')
})
