import { describe, expect, test } from 'bun:test'

import { syntaxTheme, ui } from '../src/themes'
import { fixture, launch, press, settle, until } from './helpers'
import type { Harness } from './helpers'

const LINES = Array.from({ length: 60 }, (_, index) =>
  index === 30 ? 'const note = 1' : `const value${index} = ${index}`
)

const PROJECT = {
  'docs/long.md': `${'x'.repeat(200)}note${'y'.repeat(60)}\nplain line\n`,
  'src/alpha.ts': `${LINES.join('\n')}\n`,
}

async function search(query: string, height: number) {
  const t = await launch(fixture(PROJECT), {}, { height, width: 100 })
  await press(t, (input) => input.pressKey('r', { ctrl: true }))
  await press(t, (input) => input.typeText(query))
  await settle(t, 300)
  return t
}

async function searchInCode(query: string, height: number) {
  const t = await search(query, height)
  await press(t, (input) => input.pressArrow('down'))
  return t
}

const panel = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter((row) => row.includes('│'))
    .map((row) =>
      row.slice(row.indexOf('│') + 1, row.lastIndexOf('│')).trimEnd()
    )

const previewLines = (t: Harness) => {
  const rows = panel(t)
  const last = rows.findLastIndex((row) => row.includes('▌'))
  return rows
    .slice(last + 1)
    .map((row) => /^\s+(\d+) /u.exec(row)?.[1])
    .filter(Boolean)
    .map(Number)
}

interface Frame {
  lines: {
    spans: { text: string; fg?: { buffer: Uint8Array }; attributes: number }[]
  }[]
}

const hex = (fg?: { buffer: Uint8Array }) =>
  fg
    ? `#${Array.from(fg.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''

const spans = (t: Harness) =>
  (t.captureSpans() as unknown as Frame).lines.flatMap((l) => l.spans)

describe('the search preview', () => {
  test('grows with the terminal, rather than staying at five lines', async () => {
    const short = previewLines(await searchInCode('note', 30))
    const tall = previewLines(await searchInCode('note', 60))

    expect(short).toContain(31)
    expect(tall).toContain(31)
    expect(tall.length).toBeGreaterThan(short.length)
  })

  test('gives way on a terminal with no room for it', async () => {
    const t = await search('note', 20)
    const rows = panel(t)

    expect(rows.some((row) => row.includes('src/alpha.ts'))).toBe(true)
    expect(rows.some((row) => row.includes('Enter jump'))).toBe(true)
    expect(rows.some((row) => row.includes('const value29'))).toBe(false)
    expect(t.captureCharFrame().split('\n').length).toBeLessThanOrEqual(21)
  })

  test('paints the file it is previewing, not a wall of one colour', async () => {
    const t = await searchInCode('note', 40)
    await until(t, () =>
      spans(t).some(
        (span) =>
          span.text === 'const' && hex(span.fg) === syntaxTheme.keyword?.fg
      )
    )
  })

  test('picks the hit out of the line it is on', async () => {
    const t = await searchInCode('note', 40)
    const marked = spans(t).filter(
      (span) => span.text === 'note' && hex(span.fg) === ui.accent.toLowerCase()
    )

    expect(marked.length).toBe(3)
  })

  test('scrolls to a hit that is 200 columns along, and says it did', async () => {
    const t = await search('note', 40)
    const rows = panel(t)
    const preview = rows.slice(
      rows.findLastIndex((row) => row.includes('▌')) + 1
    )

    expect(
      preview.some((row) => row.includes('…') && row.includes('note'))
    ).toBe(true)
    expect(
      preview.some((row) => row.includes('plain line') && row.includes('…'))
    ).toBe(false)
  })
})
