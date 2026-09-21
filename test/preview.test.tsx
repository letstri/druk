import { expect, test } from 'bun:test'

import {
  fixture,
  launch,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  until,
} from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'a.ts': 'const a = 1\n',
  'b.ts': 'const b = 2\n',
  'sub/c.ts': 'const c = 3\n',
}

// The page keys as a terminal sends them; `mockInput` has no helper for either.
const PAGE_UP = '\u001B[5~'
const PAGE_DOWN = '\u001B[6~'

const frame = (t: Harness) => t.captureCharFrame()
const strip = (t: Harness) => frame(t).split('\n')[0] ?? ''

const onFirstFile = (t: Harness) =>
  pressTimes(t, 2, (input) => input.pressArrow('down'))

test('Space shows the file under the cursor without opening a tab', async () => {
  const t = await launch(fixture(PROJECT))
  await onFirstFile(t)
  await press(t, (input) => input.pressKey(' '))

  await until(t, () => frame(t).includes('const a = 1'))
  expect(frame(t)).toContain('preview ·')
  expect(strip(t)).not.toContain('a.ts')

  await press(t, (input) => input.pressArrow('down'))
  await until(t, () => frame(t).includes('const b = 2'))
  expect(frame(t)).not.toContain('const a = 1')
  expect(strip(t)).not.toContain('b.ts')
})

test('Space again closes it, and Enter opens the file for real', async () => {
  const t = await launch(fixture(PROJECT))
  await onFirstFile(t)
  await press(t, (input) => input.pressKey(' '))
  await until(t, () => frame(t).includes('const a = 1'))

  await press(t, (input) => input.pressKey(' '))
  expect(frame(t)).not.toContain('const a = 1')

  await press(t, (input) => input.pressKey(' '))
  await until(t, () => frame(t).includes('const a = 1'))
  await press(t, (input) => input.pressEnter())
  await until(t, () => strip(t).includes('a.ts'))
  await pressEscape(t)
  expect(frame(t)).not.toContain('preview ·')
})

test('the page keys scroll the preview while the tree keeps the arrows', async () => {
  const lines = Array.from(
    { length: 200 },
    (_, at) => `const line${at} = ${at}`
  ).join('\n')
  const t = await launch(fixture({ 'a.ts': `${lines}\n`, 'sub/c.ts': '' }))
  await onFirstFile(t)
  await press(t, (input) => input.pressKey(' '))
  await until(t, () => frame(t).includes('const line0 = 0'))

  await press(t, (input) => input.pressKeys([PAGE_DOWN]))
  await until(t, () => !frame(t).includes('const line0 = 0'))
  expect(frame(t)).toContain('a.ts')

  await press(t, (input) => input.pressKeys([PAGE_UP]))
  await until(t, () => frame(t).includes('const line0 = 0'))
})

test('a folder and a file druk cannot read say so rather than showing nothing', async () => {
  const t = await launch(fixture({ ...PROJECT, 'bin.dat': 'a\0b' }))
  await press(t, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressKey(' '))
  await until(t, () => frame(t).includes('Folder'))

  await pressTimes(t, 3, (input) => input.pressArrow('down'))
  await until(t, () => frame(t).includes('Binary'))
})

test('the palette turns it on from the editor, and Esc closes it', async () => {
  const t = await launch(fixture(PROJECT))
  await onFirstFile(t)
  await press(t, (input) => input.pressEnter())
  await until(t, () => strip(t).includes('a.ts'))

  await runCommand(t, 'Preview file')
  await until(t, () => frame(t).includes('preview'))

  await pressEscape(t)
  expect(frame(t)).not.toContain('preview ·')
})
