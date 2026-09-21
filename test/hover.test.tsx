import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, openFile, settle, untilFrame } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: {
    spans: {
      text: string
      fg?: { buffer: Uint8Array }
      bg?: { buffer: Uint8Array }
    }[]
  }[]
}

const hex = (color?: { buffer: Uint8Array }) =>
  color
    ? `#${Array.from(color.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''

const rowBgs = (t: Harness, y: number) => {
  const frame = t.captureSpans() as unknown as Frame
  return frame.lines[y]?.spans.map((span) => hex(span.bg)) ?? []
}

const glyphFg = (t: Harness, y: number, glyph: string) => {
  const frame = t.captureSpans() as unknown as Frame
  const span = frame.lines[y]?.spans.find((s) => s.text.includes(glyph))
  return hex(span?.fg)
}

const rowOf = (t: Harness, text: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .findIndex((line) => line.includes(text))

describe('hover on clickable rows', () => {
  test('a tree row under the pointer tints, and untints when it leaves', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
    )

    const y = rowOf(t, 'b.ts')
    expect(y).toBeGreaterThan(0)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)

    await t.mockMouse.moveTo(3, y)
    await settle(t)
    expect(rowBgs(t, y)).toContain(ui.hoverBg)

    await t.mockMouse.moveTo(3, y - 1)
    await settle(t)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)
  })

  test('a hovered row stays tinted across a tree refresh', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
    const t = await launch(dir)

    const y = rowOf(t, 'b.ts')
    await t.mockMouse.moveTo(3, y)
    await settle(t)
    expect(rowBgs(t, y)).toContain(ui.hoverBg)

    writeFileSync(join(dir, 'z.ts'), 'const z = 3\n')
    await untilFrame(t, 'z.ts')
    expect(rowBgs(t, y)).toContain(ui.hoverBg)
  })

  test('the selected row keeps its selection colour under the pointer', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))

    const y = rowOf(t, '   a.ts')
    expect(y).toBeGreaterThan(0)
    await t.mockMouse.click(3, y)
    await settle(t)
    expect(rowBgs(t, y)).toContain(ui.treeSelectedBg)
    expect(rowBgs(t, y)).not.toContain(ui.hoverBg)
  })

  test('the fold chevron under the pointer takes the accent', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'function outer() {\n  const a = 1\n  return a\n}\n' })
    )
    await openFile(t, 'a.ts')

    const y = rowOf(t, 'function outer() {')
    const x = t.captureCharFrame().split('\n')[y]!.indexOf('▾')
    expect(x).toBeGreaterThan(0)
    expect(glyphFg(t, y, '▾')).toBe(ui.gutter)

    await t.mockMouse.moveTo(x, y)
    await settle(t)
    expect(glyphFg(t, y, '▾')).toBe(ui.accent)

    await t.mockMouse.moveTo(x, y + 1)
    await settle(t)
    expect(glyphFg(t, y, '▾')).toBe(ui.gutter)
  })
})
