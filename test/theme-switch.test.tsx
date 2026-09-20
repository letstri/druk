import { afterAll, expect, test } from 'bun:test'

import { getSyntaxStyle, invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, syntaxTheme, themeFor, themeNames, THEMES } from '../src/themes'
import { fixture, launch, loadMarketExtensions, openPalette, press } from './helpers'
import type { Harness } from './helpers'
import { allSegments } from './syntax'

function colors(t: Harness) {
  const capture = t.captureSpans() as unknown as {
    lines: {
      spans: {
        text: string
        fg?: { buffer: Record<string, number> }
        bg?: { buffer: Record<string, number> }
      }[]
    }[]
  }
  const rgb = (c?: { buffer: Record<string, number> }) =>
    c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''
  const seen = new Set<string>()
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (span.bg) seen.add(rgb(span.bg))
      if (span.fg && span.text.trim()) seen.add(rgb(span.fg))
    }
  }
  return seen
}

loadMarketExtensions()

afterAll(() => {
  setTheme('dark')
  invalidateSyntaxStyle()
})

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return `${Number.parseInt(h.slice(0, 2), 16)},${Number.parseInt(h.slice(2, 4), 16)},${Number.parseInt(h.slice(4, 6), 16)}`
}

async function switchTheme(t: Harness, query: string) {
  await openPalette(t)
  await press(t, i => void i.typeText(query))
  await press(t, i => i.pressEnter())
}

test('switching theme repaints chrome and syntax', async () => {
  const t = await launch(fixture({ 'a.ts': 'const x = 1 // c\n' }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  expect(colors(t)).toContain(hexToRgb(THEMES.dark.ui.bg))

  await switchTheme(t, 'latte')
  const latte = colors(t)
  expect(latte).toContain(hexToRgb(themeFor('catppuccin-latte').ui.bg))
  expect(latte).not.toContain(hexToRgb(THEMES.dark.ui.bg))

  await switchTheme(t, 'mocha')
  expect(colors(t)).toContain(hexToRgb(themeFor('catppuccin-mocha').ui.bg))
})

test("switching themes never leaves a previous theme's colors behind", async () => {
  for (const name of themeNames()) {
    setTheme(name)
    invalidateSyntaxStyle()
    expect(Object.keys(syntaxTheme).toSorted()).toEqual(
      Object.keys(themeFor(name).syntax).toSorted(),
    )
  }
})

test('plain identifiers stay readable against the background in every theme', async () => {
  const source = 'export const config = {\n  someKey: 1,\n}\n'
  const luminance = (hex: string) => {
    const h = hex.replace('#', '')
    const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16) / 255)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }

  for (const name of themeNames()) {
    setTheme(name)
    invalidateSyntaxStyle()
    const segments = await allSegments(source, 'typescript', 2)
    const style = getSyntaxStyle()
    const groups = [
      ...(style as unknown as { getAllStyles: () => Map<string, unknown> }).getAllStyles().keys(),
    ]

    const bg = luminance(themeFor(name).ui.bg)
    for (const segment of segments) {
      const group = groups.find(g => style.getStyleId(g) === segment.styleId)
      const fg = group ? (themeFor(name).syntax[group] as { fg?: string })?.fg : undefined
      if (!fg) continue
      expect(`${name}/${group}:${Math.abs(luminance(fg) - bg) > 0.08}`).toBe(
        `${name}/${group}:true`,
      )
    }
  }
}, 20000)
