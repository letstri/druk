import { expect, test } from 'bun:test'

import { THEMES } from '../src/themes'
import type { ThemeName } from '../src/themes'
import { fixture, launch, openPalette, press } from './helpers'
import type { Harness } from './helpers'

function spanColors(t: Harness, needle: string) {
  const capture = t.captureSpans() as unknown as {
    lines: {
      spans: {
        text: string
        fg?: { buffer: Record<string, number> }
        bg?: { buffer: Record<string, number> }
      }[]
    }[]
  }
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (span.text.includes(needle) && span.fg && span.bg) {
        const at = (c: { buffer: Record<string, number> }) => [
          c.buffer['0']!,
          c.buffer['1']!,
          c.buffer['2']!,
        ]
        return { fg: at(span.fg), bg: at(span.bg) }
      }
    }
  }
  return null
}

const contrast = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

test('typed text is readable in the palette, search and prompts', async () => {
  for (const theme of Object.keys(THEMES) as ThemeName[]) {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { theme })

    await openPalette(t)
    await press(t, i => void i.typeText('zzz'))
    const palette = spanColors(t, 'zzz')
    expect(`${theme} palette:${palette !== null}`).toBe(`${theme} palette:true`)
    expect(`${theme} palette contrast>60:${contrast(palette!.fg, palette!.bg) > 60}`).toBe(
      `${theme} palette contrast>60:true`,
    )

    await press(t, i => i.pressEscape())
    await press(t, i => i.pressKey('f', { ctrl: true }))
    await press(t, i => void i.typeText('qqq'))
    const search = spanColors(t, 'qqq')
    expect(`${theme} search:${search !== null}`).toBe(`${theme} search:true`)
    expect(`${theme} search contrast>60:${contrast(search!.fg, search!.bg) > 60}`).toBe(
      `${theme} search contrast>60:true`,
    )
  }
}, 30000)
