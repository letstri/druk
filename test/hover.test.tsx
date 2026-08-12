import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { fixture, launch, settle } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (color?: { buffer: Uint8Array }) =>
  color
    ? `#${Array.from(color.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
    : ''

/** Backgrounds of row `y`, as hex strings. */
const rowBgs = (t: Harness, y: number) => {
  const frame = t.captureSpans() as unknown as Frame
  return frame.lines[y]?.spans.map(span => hex(span.bg)) ?? []
}

/** The row of the char frame that contains `text`, or -1. */
const rowOf = (t: Harness, text: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .findIndex(line => line.includes(text))

describe('hover on clickable rows', () => {
  test('a tree row under the pointer tints, and untints when it leaves', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' }))

    // Nothing is selected at launch, so the row is plain until the pointer lands.
    const y = rowOf(t, 'b.ts')
    expect(y).toBeGreaterThan(0)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)

    await t.mockMouse.moveTo(3, y)
    await settle(t)
    expect(rowBgs(t, y)).toContain(ui.hoverBg)

    // Off the row — onto the row above — the tint goes with the pointer.
    await t.mockMouse.moveTo(3, y - 1)
    await settle(t)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)
  })

  test('the selected row keeps its selection colour under the pointer', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))

    // The tree draws a file as `· name`; the open tab says `a.ts` too, so the
    // glyph is what tells the rows apart. Clicking selects the row and leaves
    // the pointer parked on it.
    const y = rowOf(t, '· a.ts')
    expect(y).toBeGreaterThan(0)
    await t.mockMouse.click(3, y)
    await settle(t)
    expect(rowBgs(t, y)).toContain(ui.treeSelectedBg)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)
  })
})
