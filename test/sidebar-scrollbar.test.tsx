import { describe, expect, test } from 'bun:test'

import { fixture, launch, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'

const MANY = Object.fromEntries(
  Array.from({ length: 400 }, (_, index) => [
    `file-${String(index).padStart(3, '0')}.ts`,
    'x\n',
  ])
)

function thumb(t: Harness, sidebarWidth = 30) {
  const rows = t
    .captureCharFrame()
    .split('\n')
    .filter((row) => row.length > 0)
    .slice(3, -1)
  const column = rows.map((row) => row[sidebarWidth - 1] ?? ' ')
  const filled = column.flatMap((glyph, row) =>
    '█▀▄'.includes(glyph) ? [row] : []
  )
  return { column, filled }
}

describe('the sidebar scrollbar', () => {
  test('is tall enough to see and to grab', async () => {
    const t = await launch(fixture(MANY), {}, { height: 24, width: 100 })
    await settle(t)

    expect(thumb(t).filled.length).toBeGreaterThanOrEqual(3)
  })

  test('still sits at the top before anything scrolls', async () => {
    const t = await launch(fixture(MANY), {}, { height: 24, width: 100 })
    await settle(t)

    expect(thumb(t).filled[0]).toBe(0)
  })

  test('moves down as the tree scrolls', async () => {
    const t = await launch(fixture(MANY), {}, { height: 24, width: 100 })
    await settle(t)
    const before = thumb(t).filled[0] ?? 0

    await pressTimes(t, 120, (input) => input.pressArrow('down'))

    expect(thumb(t).filled[0] ?? 0).toBeGreaterThan(before)
  }, 30_000)

  test('a tree that fits shows no thumb at all', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'x\n', 'b.ts': 'x\n' }),
      {},
      { height: 24, width: 100 }
    )
    await settle(t)

    expect(thumb(t).filled).toEqual([])
  })
})
