import { describe, expect, test } from 'bun:test'

import { buildQuery, searchText } from '../src/core/search'
import { ui } from '../src/themes'
import { fixture, launch, press } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
}

const hex = (fg?: { buffer: Uint8Array }) =>
  fg
    ? `#${Array.from(fg.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''

// The toggle chips say which of them are on: lit is the accent, off is dim.
const chipLit = (t: Harness, label: string) => {
  const chip = (t.captureSpans() as unknown as Frame).lines
    .flatMap((line) => line.spans)
    .find((span) => span.text.trim() === label)
  return hex(chip?.fg) === ui.accent.toLowerCase()
}

const CONTENT = 'alpha ALPHA alphabet\nAlphabet soup\n'

async function openSearch() {
  const t = await launch(fixture({ 'a.ts': CONTENT }))
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressKey('f', { ctrl: true }))
  return t
}

describe('buildQuery', () => {
  test('escapes the query unless regex is asked for', () => {
    expect(buildQuery('a.b')!.test('axb')).toBe(false)
    expect(buildQuery('a.b', { regex: true })!.test('axb')).toBe(true)
  })

  test('an invalid regex is null, not a crash', () => {
    expect(buildQuery('a(', { regex: true })).toBeNull()
  })

  test('whole word bounds the match', () => {
    expect(
      searchText('cat concatenate', 'cat', 'a.ts', { wholeWord: true })
    ).toHaveLength(1)
  })

  test('case sensitivity is honoured', () => {
    expect(
      searchText('a A', 'a', 'a.ts', { caseSensitive: true })
    ).toHaveLength(1)
  })

  test('regex matches report their real length', () => {
    const [match] = searchText('foo123bar', String.raw`\d+`, 'a.ts', {
      regex: true,
    })
    expect(match).toMatchObject({ col: 3, length: 3 })
  })
})

describe('search panel toggles', () => {
  test('Ctrl+C makes the search case-sensitive', async () => {
    const t = await openSearch()
    await press(t, (i) => i.typeText('ALPHA'))
    expect(t.captureCharFrame()).toContain('of 4')

    expect(chipLit(t, 'Aa')).toBe(false)

    await press(t, (i) => i.pressKey('c', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('1 of 1')
    expect(chipLit(t, 'Aa')).toBe(true)
  })

  test('Ctrl+W matches whole words only', async () => {
    const t = await openSearch()
    await press(t, (i) => i.typeText('alpha'))
    expect(t.captureCharFrame()).toContain('of 4')

    await press(t, (i) => i.pressKey('w', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('of 2')
    expect(chipLit(t, 'ab')).toBe(true)
  })

  test('Ctrl+R turns the query into a regex, and says when it is invalid', async () => {
    const t = await openSearch()
    await press(t, (i) => i.pressKey('r', { ctrl: true }))
    await press(t, (i) => i.typeText('al.ha'))
    expect(t.captureCharFrame()).toContain('of 4')

    await press(t, (i) => i.typeText('('))
    expect(t.captureCharFrame()).toContain('Invalid regex')
  })
})
