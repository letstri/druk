import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, settle } from './helpers'
import type { Harness } from './helpers'

// Rows as [gutter number, line index].
function numbered(t: Harness): Array<[number, number]> {
  return (
    t
      .captureCharFrame()
      .split('\n')
      // Unanchored: the tree sits left of the gutter.
      .map(row => /(\d+)\s+line (\d+)/.exec(row))
      .filter(match => match !== null)
      .map(match => [Number(match[1]), Number(match[2])] as [number, number])
  )
}

function expectNumbersMatchLines(t: Harness) {
  const rows = numbered(t)
  expect(rows.length).toBeGreaterThan(3)
  for (const [shown, line] of rows) expect(shown).toBe(line + 1)
}

async function open(t: Harness, name: string) {
  await openFile(t, name)
}

const wrapped = `${Array.from({ length: 40 }, (_, i) =>
  i % 5 === 0 ? `line ${i} ${'x'.repeat(120)}` : `line ${i}`,
).join('\n')}\n`

const plain = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`

describe('line numbers after switching files', () => {
  test('plain -> wrapped keeps numbers on logical lines', async () => {
    const t = await launch(fixture({ 'a.ts': plain, 'b.ts': wrapped }))
    await open(t, 'a.ts')
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })

  test('wrapped -> plain drops the stale wrap layout', async () => {
    const t = await launch(fixture({ 'a.ts': wrapped, 'b.ts': plain }))
    await open(t, 'a.ts')
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })

  test('switching away from a scrolled wrapped file', async () => {
    const t = await launch(fixture({ 'a.ts': wrapped, 'b.ts': plain }))
    await open(t, 'a.ts')
    for (let i = 0; i < 30; i++) t.mockInput.pressKey('down')
    await settle(t)
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })
})
