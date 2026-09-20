import { expect, test } from 'bun:test'

import { fixture, launch, openFile, press, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
// Opt is an ESC prefix ahead of the Ctrl chord's control byte.
const BACK = `${ESC}${String.fromCharCode(26)}` // Ctrl+Opt+Z
const FORWARD = `${ESC}${String.fromCharCode(25)}` // Ctrl+Opt+Y
const UNDER_CURSOR = `${ESC}${String.fromCharCode(15)}` // Ctrl+Opt+O

const PROJECT = {
  'a.ts': 'const one = 1\nconst two = 2\nconst three = 3\nconst four = 4\n',
  'b.ts': 'const b = 2\n',
}

const bar = (t: Harness) => t.captureCharFrame().split('\n').at(-2) ?? ''

test('back and forward walk the tabs the editor has landed on', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  await openFile(t, 'b.ts')
  expect(t.captureCharFrame()).toContain('const b = 2')

  await press(t, i => void i.pressKeys([BACK]))
  expect(t.captureCharFrame()).toContain('const one = 1')

  await press(t, i => void i.pressKeys([FORWARD]))
  expect(t.captureCharFrame()).toContain('const b = 2')
})

test('going back lands on the line the file was left at', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  await pressTimes(t, 3, i => i.pressArrow('down'))
  expect(bar(t)).toContain('Ln 4')

  await openFile(t, 'b.ts')
  expect(bar(t)).toContain('Ln 1')

  await press(t, i => void i.pressKeys([BACK]))
  expect(t.captureCharFrame()).toContain('const one = 1')
  expect(bar(t)).toContain('Ln 4')
})

test('a jump inside one file is a stop of its own', async () => {
  const t = await launch(fixture({ 'a.ts': "const one = 1\nconst two = 2\n'./a'\n" }))
  await openFile(t, 'a.ts')
  await pressTimes(t, 2, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('right'))
  expect(bar(t)).toContain('Ln 3')

  await press(t, i => void i.pressKeys([UNDER_CURSOR]))
  expect(bar(t)).toContain('Ln 1')

  await press(t, i => void i.pressKeys([BACK]))
  expect(bar(t)).toContain('Ln 3')
})

test('the arrows on the tab strip do the same', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  await openFile(t, 'b.ts')

  const back = t.captureCharFrame().split('\n')[0]!.indexOf('←')
  await t.mockMouse.click(back, 0)
  await settle(t)
  expect(t.captureCharFrame()).toContain('const one = 1')

  await t.mockMouse.click(back + 2, 0)
  await settle(t)
  expect(t.captureCharFrame()).toContain('const b = 2')
})

test('with nowhere to go the keys say so', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')

  await press(t, i => void i.pressKeys([BACK]))
  expect(bar(t)).toContain('Nothing to go back to')

  await press(t, i => void i.pressKeys([FORWARD]))
  expect(bar(t)).toContain('Nothing to go forward to')
})
