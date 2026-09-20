import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

const content = `${Array.from({ length: 40 }, (_, i) =>
  i % 5 === 0 ? `line ${i} ${'x'.repeat(120)}` : `line ${i}`,
).join('\n')}\n`

// [number in the gutter, index in the file]; a blank gutter row is a continuation.
function numbered(t: Harness): Array<[number, number]> {
  return (
    t
      .captureCharFrame()
      .split('\n')
      // Unanchored: with the tree on screen the row does not start with the gutter.
      .map(row => /(\d+)\s+line (\d+)/.exec(row))
      .filter(match => match !== null)
      .map(match => [Number(match[1]), Number(match[2])] as [number, number])
  )
}

async function open() {
  const t = await launch(fixture({ 'a.ts': content }))
  await openFile(t, 'a.ts')
  return t
}

function expectNumbersMatchLines(t: Harness) {
  const rows = numbered(t)
  expect(rows.length).toBeGreaterThan(3)
  for (const [shown, line] of rows) expect(shown).toBe(line + 1)
}

describe('line numbers with wrapped lines', () => {
  test('are right to begin with', async () => {
    expectNumbersMatchLines(await open())
  })

  test('survive the sidebar being hidden', async () => {
    const t = await open()
    await press(t, input => input.pressKey('b', { ctrl: true }))
    await settle(t)
    expectNumbersMatchLines(t)
  })

  test('survive the sidebar being resized', async () => {
    const t = await open()
    await pressEscape(t)
    await press(t, input => input.pressKey(']'))
    await press(t, input => input.pressKey(']'))
    await settle(t)
    expectNumbersMatchLines(t)
  })

  test('survive the terminal being resized', async () => {
    const t = await open()
    t.resize(120, 24)
    await settle(t)
    expectNumbersMatchLines(t)

    t.resize(60, 24)
    await settle(t)
    expectNumbersMatchLines(t)
  })
})
