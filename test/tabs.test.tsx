import { expect, test } from 'bun:test'

import { fixture, launch, openFile, openPalette, press, settle } from './helpers'

test('the tab bar is a single row above the editor', async () => {
  const t = await launch(fixture({ 'a.ts': 'x\n' }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const rows = t.captureCharFrame().split('\n')
  expect(rows[0]).toContain('a.ts')
  expect(rows[1]).toContain('1 x')
})

test('long names are shortened, never clipped mid-word', async () => {
  const t = await launch(fixture({ 'a-very-long-component-name.tsx': 'x\n', 'b.ts': 'y\n' }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame().split('\n')[0]).toContain('…')
})

test('many open tabs still fit the row', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`file-number-${i}.ts`, `const a${i} = 1\n`]),
  )
  const t = await launch(fixture(files))
  for (let i = 0; i < 12; i++) await openFile(t, `file-number-${i}.ts`)
  const row = t.captureCharFrame().split('\n')[0]!
  expect(row.length).toBeLessThanOrEqual(80)
  expect(row).toContain('file-number-11')
}, 20000)

test('the switcher lists open tabs and jumps to one', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`file-number-${i}.ts`, `const a${i} = 1\n`]),
  )
  const t = await launch(fixture(files))
  for (let i = 0; i < 8; i++) await openFile(t, `file-number-${i}.ts`)

  await press(t, i => i.pressKey('t', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Switch tab')

  await press(t, i => void i.typeText('number-2'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('const a2 = 1')
}, 20000)

test('close others leaves a single tab', async () => {
  const files = { 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n', 'c.ts': 'const c = 3\n' }
  const t = await launch(fixture(files))
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    await openFile(t, name)
  }

  await openPalette(t)
  await press(t, i => void i.typeText('Close other'))
  await press(t, i => i.pressEnter())

  const row = t.captureCharFrame().split('\n')[0]!
  expect(row).toContain('c.ts')
  expect(row).not.toContain('a.ts')
})

test('Ctrl+PgUp/PgDn and Ctrl+Opt+arrows step through tabs', async () => {
  const t = await launch(fixture({ 'one.ts': 'const one = 1\n', 'two.ts': 'const two = 2\n' }))
  for (const name of ['one.ts', 'two.ts']) {
    await openFile(t, name)
  }
  expect(t.captureCharFrame()).toContain('const two = 2')

  // The mock has no page keys.
  await press(t, i => void i.pressKeys(['\u001B[5;5~']))
  expect(t.captureCharFrame()).toContain('const one = 1')

  await press(t, i => void i.pressKeys(['\u001B[6;5~']))
  expect(t.captureCharFrame()).toContain('const two = 2')

  // Ctrl+Opt+arrow: macOS swallows plain Ctrl+arrow.
  await press(t, i => void i.pressKeys(['\u001B[1;7D']))
  expect(t.captureCharFrame()).toContain('const one = 1')

  await press(t, i => void i.pressKeys(['\u001B[1;7C']))
  expect(t.captureCharFrame()).toContain('const two = 2')
})

test('clicking an overflow counter opens the list of open tabs', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`component-${i}.tsx`, `const a${i} = 1\n`]),
  )
  const t = await launch(fixture(files))
  for (let i = 0; i < 9; i++) await openFile(t, `component-${i}.tsx`)

  const bar = t.captureCharFrame().split('\n')[0]!
  const counter = bar.indexOf('\u2039')
  expect(counter).toBeGreaterThan(-1)

  await t.mockMouse.click(counter, 0)
  await settle(t)
  expect(t.captureCharFrame()).toContain('Switch tab')

  await press(t, input => void input.typeText('component-0'))
  await press(t, input => input.pressEnter())
  expect(t.captureCharFrame()).toContain('const a0 = 1')
}, 20000)
