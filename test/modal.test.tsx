import { describe, expect, test } from 'bun:test'

import { listRows, modalWidth } from '../src/ui/modal'
import { wrapText } from '../src/ui/text'
import { fixture, launch, openPalette, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'src/alpha.ts': 'const capture = 1\n',
  'src/beta.ts': '// capture\n',
}

const hex = (buf?: { buffer: Uint8Array }) =>
  buf
    ? Array.from(buf.buffer.slice(0, 3), (v) =>
        v.toString(16).padStart(2, '0')
      ).join('')
    : ''

function fgOf(t: Harness, needle: string): string {
  const cap = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
  }
  for (const line of cap.lines) {
    const span = line.spans.find((s) => s.text.includes(needle))
    if (span) {
      return hex(span.fg)
    }
  }
  return ''
}

const bordered = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter(
      (row) =>
        row.includes('╭') ||
        row.includes('╰') ||
        (row.match(/│/gu)?.length ?? 0) >= 2
    )

describe('modalWidth', () => {
  test('follows the terminal between its bounds', () => {
    expect(modalWidth(200, 0.5, 60, 120)).toBe(100)
    expect(modalWidth(300, 0.5, 60, 120)).toBe(120)
    expect(modalWidth(80, 0.5, 60, 120)).toBe(60)
  })

  test('never draws wider than the screen, whatever the minimum says', () => {
    expect(modalWidth(60, 0.86, 64, 160)).toBeLessThanOrEqual(58)
    expect(modalWidth(30, 0.9, 72, 160)).toBeLessThanOrEqual(28)
  })
})

describe('listRows', () => {
  test('spends what the terminal has, up to the cap', () => {
    expect(listRows(40, 8, 18)).toBe(18)
    expect(listRows(20, 8, 18)).toBe(12)
  })

  test('keeps a usable minimum on a tiny screen', () => {
    expect(listRows(6, 8, 18)).toBe(3)
  })
})

describe('wrapText', () => {
  test('breaks on spaces within the width', () => {
    expect(wrapText('one two three four', 9)).toEqual([
      'one two',
      'three',
      'four',
    ])
  })

  test('cuts a word with nowhere to break', () => {
    expect(wrapText('aaaaaaaaaa', 4)).toEqual(['aaaa', 'aaaa', 'aa'])
  })

  test('always returns a line, so a caller can map over it', () => {
    expect(wrapText('', 10)).toEqual([''])
  })
})

describe('an open modal', () => {
  test('dims what is behind it without hiding it', async () => {
    const t = await launch(fixture(PROJECT), {}, { height: 30, width: 100 })
    const before = fgOf(t, 'EXPLORER')
    expect(before).not.toBe('')

    await openPalette(t)
    await settle(t)
    const behind = fgOf(t, 'EXPLORER')

    expect(t.captureCharFrame()).toContain('EXPLORER')
    expect(behind).not.toBe(before)
    expect(Number.parseInt(behind, 16)).toBeLessThan(
      Number.parseInt(before, 16)
    )
  })

  test('fits inside a narrow terminal, borders and all', async () => {
    const t = await launch(fixture(PROJECT), {}, { height: 18, width: 60 })
    await press(t, (input) => input.pressKey('r', { ctrl: true }))
    await press(t, (input) => input.typeText('capture'))
    await settle(t, 300)

    const rows = bordered(t)
    expect(rows.length).toBeGreaterThan(3)
    for (const row of rows) {
      expect(row.trimEnd().length).toBeLessThanOrEqual(60)
    }
    expect(rows.every((row) => /[│╭╰].*[│╮╯]/u.test(row))).toBe(true)
  })

  test('grows with the terminal', async () => {
    const narrow = await launch(fixture(PROJECT), {}, { height: 30, width: 80 })
    await openPalette(narrow)
    await settle(narrow)

    const wide = await launch(fixture(PROJECT), {}, { height: 30, width: 160 })
    await openPalette(wide)
    await settle(wide)

    const width = (t: Harness) => bordered(t)[0]!.trim().length
    expect(width(wide)).toBeGreaterThan(width(narrow))
  })
})
