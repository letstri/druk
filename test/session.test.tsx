import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape } from './helpers'

const PROJECT = { 'notes.md': '# hi\n', 'src/main.ts': 'const a = 1\n' }

test('reopening a project restores tabs, active file and expanded folders', async () => {
  const dir = fixture(PROJECT)

  const first = await launch(dir)
  await press(first, (i) => i.pressArrow('down'))
  await press(first, (i) => i.pressEnter())
  await press(first, (i) => i.pressArrow('down'))
  await press(first, (i) => i.pressEnter())
  await pressEscape(first)
  await press(first, (i) => i.pressArrow('down'))
  await press(first, (i) => i.pressEnter())

  const second = await launch(dir)
  const frame = second.captureCharFrame()
  expect(frame).toContain('main.ts')
  expect(frame).toContain('notes.md')
  expect(frame).toContain('# hi')
  expect(frame).toContain('▾ src')
})

test('files deleted since last time are dropped', async () => {
  const dir = fixture(PROJECT)

  const first = await launch(dir)
  await press(first, (i) => i.pressArrow('down'))
  await press(first, (i) => i.pressEnter())
  await press(first, (i) => i.pressArrow('down'))
  await press(first, (i) => i.pressEnter())
  expect(first.captureCharFrame()).toContain('main.ts')

  rmSync(join(dir, 'src/main.ts'))
  const second = await launch(dir)
  expect(second.captureCharFrame()).toContain('no open files')
})
