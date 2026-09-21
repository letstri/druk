import { describe, expect, test } from 'bun:test'

import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  pressTimes,
  settle,
} from './helpers'
import type { Harness } from './helpers'

const WRAPPED = `${Array.from({ length: 40 }, (_, i) =>
  i % 5 === 0 ? `line ${i} ${'x'.repeat(120)}` : `line ${i}`
).join('\n')}\n`

const PLAIN = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`

/** [number in the gutter, index in the file]; a blank gutter row is a continuation. */
function numbersMatchLines(t: Harness) {
  const rows = t
    .captureCharFrame()
    .split('\n')
    // Unanchored: the tree sits left of the gutter.
    .map((row) => /(\d+)\s+line (\d+)/u.exec(row))
    .filter((match) => match !== null)
  expect(rows.length).toBeGreaterThan(3)
  for (const match of rows) {
    expect(Number(match[1])).toBe(Number(match[2]) + 1)
  }
}

async function opened(files: Record<string, string>, ...names: string[]) {
  const t = await launch(fixture(files))
  for (const name of names) {
    await openFile(t, name)
  }
  return t
}

test('line numbers past 99 are not truncated', async () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join(
    '\n'
  )
  const t = await launch(fixture({ 'big.txt': lines }))
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())

  await pressTimes(t, 120, (i) => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('120 line 120')
  expect(frame).not.toContain('unsaved')
})

describe('line numbers with wrapped lines', () => {
  const open = () => opened({ 'a.ts': WRAPPED }, 'a.ts')

  test('are right to begin with', async () => {
    numbersMatchLines(await open())
  })

  test('survive the sidebar being hidden', async () => {
    const t = await open()
    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    await settle(t)
    numbersMatchLines(t)
  })

  test('survive the sidebar being resized', async () => {
    const t = await open()
    await pressEscape(t)
    await press(t, (input) => input.pressKey(']'))
    await press(t, (input) => input.pressKey(']'))
    await settle(t)
    numbersMatchLines(t)
  })

  test('survive the terminal being resized', async () => {
    const t = await open()
    t.resize(120, 24)
    await settle(t)
    numbersMatchLines(t)

    t.resize(60, 24)
    await settle(t)
    numbersMatchLines(t)
  })
})

describe('line numbers after switching files', () => {
  test('plain -> wrapped keeps numbers on logical lines', async () => {
    numbersMatchLines(
      await opened({ 'a.ts': PLAIN, 'b.ts': WRAPPED }, 'a.ts', 'b.ts')
    )
  })

  test('wrapped -> plain drops the stale wrap layout', async () => {
    numbersMatchLines(
      await opened({ 'a.ts': WRAPPED, 'b.ts': PLAIN }, 'a.ts', 'b.ts')
    )
  })

  test('switching away from a scrolled wrapped file', async () => {
    const t = await opened({ 'a.ts': WRAPPED, 'b.ts': PLAIN }, 'a.ts')
    for (let i = 0; i < 30; i += 1) {
      t.mockInput.pressKey('down')
    }
    await settle(t)
    await openFile(t, 'b.ts')
    numbersMatchLines(t)
  })
})
