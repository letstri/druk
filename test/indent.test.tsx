import { expect, test } from 'bun:test'

import { getSyntaxStyle } from '../src/languages/highlight'
import { THEMES } from '../src/themes'
import { fixture, launch, openFile, press, pressTimes, runCommand, until } from './helpers'
import type { Harness } from './helpers'
import { allSegments } from './syntax'

const NESTED = 'function f() {\n  if (x) {\n    return 1\n  }\n}\n'

/** Every (line, column) carrying the indent-guide style. */
async function guideColumns(content: string, tabSize: number) {
  const segs = await allSegments(content, 'typescript', tabSize)
  const guide = getSyntaxStyle().getStyleId('indent.guide')
  const lines = content.split('\n')
  return segs
    .filter(s => s.styleId === guide)
    .flatMap(s => Array.from({ length: s.end - s.start }, (_, i) => [s.line, s.start + i] as const))
    .filter(([line, col]) => lines[line]?.[col] === ' ')
}

test('guides mark every indent stop at the configured width', async () => {
  // "  if (x) {" starts at flat offset 14 -> guide at its column 0 only.
  // "    return 1" is two levels -> guides at columns 0 and 2.
  const two = await guideColumns(NESTED, 2)
  expect(two.length).toBe(4) // 1 + 2 + 1 for the closing "  }"

  // At width 4 the same source has fewer stops: nothing lands on column 2.
  const four = await guideColumns(NESTED, 4)
  expect(four.length).toBeLessThan(two.length)
})

test('a tab indent is tinted by the renderer alone', async () => {
  // The tab already carries a guide in its first cell, so a highlight over it
  // would tint the whole tab and make tab files look unlike space files.
  const tabbed = 'function f() {\n\tif (x) {\n\t\treturn 1\n\t}\n}\n'
  const segs = await allSegments(tabbed, 'typescript', 2)
  const guide = getSyntaxStyle().getStyleId('indent.guide')
  expect(segs.filter(s => s.styleId === guide)).toEqual([])
})

test('tab size is configurable and shown on the settings page', async () => {
  const t = await launch(fixture({ 'a.ts': NESTED }), { tabSize: 4 })
  await runCommand(t, 'Settings')
  const row = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Tab size'))!
  expect(row().trimEnd().endsWith('4')).toBe(true)

  for (let i = 0; i < 16 && !row().includes('▌'); i++) {
    await press(t, input => input.pressArrow('down'))
  }
  await press(t, input => input.pressArrow('right'))
  expect(row().trimEnd().endsWith('8')).toBe(true)
  await press(t, input => input.pressArrow('left'))
  expect(row().trimEnd().endsWith('4')).toBe(true)
})

test('tab indents keep drawing guides after the view scrolls', async () => {
  // Tabs are painted by OpenTUI, not the highlighter: it writes the indicator
  // glyph into the first cell of the tab and spaces after it. A code point it
  // cannot print leaves those cells untouched, so the previous frame shows
  // through and the file looks different at every scroll position.
  const filler = Array.from({ length: 40 }, (_, i) => `\tconst x${i} = ${i}`).join('\n')
  const content = `${filler}\n\t\t<marker/>\n${filler}\n`
  const dir = fixture({ 'a.tsx': content })
  const t = await launch(dir, {}, {}, { openFile: `${dir}/a.tsx` })

  await pressTimes(t, 45, input => input.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('█ █ <marker/>')
  const control = [...frame].filter(ch => ch !== '\n' && ch.codePointAt(0)! < 0x20)
  expect(control).toEqual([])
})

/** The foreground of each character of `needle`, once per row that draws it. */
function coloursOf(t: Harness, needle: string): string[][] {
  const frame = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
  }
  const rows: string[][] = []
  for (const line of frame.lines) {
    const cells: { ch: string; fg: string }[] = []
    for (const span of line.spans) {
      const fg = span.fg ? Array.from(span.fg.buffer.slice(0, 3)).join(',') : '-'
      for (const ch of span.text) cells.push({ ch, fg })
    }
    const at = cells
      .map(c => c.ch)
      .join('')
      .indexOf(needle)
    if (at >= 0) rows.push(cells.slice(at, at + needle.length).map(c => c.fg))
  }
  return rows
}

test('a tab-indented line is coloured where its text is drawn', async () => {
  // OpenTUI addresses highlights in rendered cells and draws a tab as two of
  // them, so handing it character columns slid every colour on this line one
  // cell left per tab — the deeper the nesting, the further off.
  const body = 'KV: KVNamespace'
  const source = `interface A {\n\t${body}\n}\ninterface B {\n  ${body}\n}\n`
  const t = await launch(fixture({ 'a.ts': source }), {}, { width: 70, height: 16 })
  await openFile(t, 'a.ts')
  await until(t, () => new Set(coloursOf(t, body).flat()).size > 1)

  const [tabbed, spaced] = coloursOf(t, body)
  // Same text, same indent width: only the tab can make the two disagree.
  expect(tabbed).toEqual(spaced!)
})

test('indent guides are visible in every theme', () => {
  const rgb = (hex: string) =>
    [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16))

  for (const [id, theme] of Object.entries(THEMES)) {
    const [bg, guide] = [rgb(theme.ui.bg), rgb(theme.ui.indentGuide)]
    const delta = Math.max(...bg.map((v, i) => Math.abs(v - guide[i]!)))
    // Lower bound only: an invisible guide is a bug, a strong one is taste, and
    // themes are meant to be copied from a published palette verbatim.
    expect(`${id}:${delta >= 6}`).toBe(`${id}:true`)
  }
})
