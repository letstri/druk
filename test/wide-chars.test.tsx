import { expect, test } from 'bun:test'

import { inCells } from '../src/editor/columns'
import { fixture, launch, openFile, spansOf, until } from './helpers'

const span = (line: string, start: number, end: number) =>
  inCells({ end, start }, line)

test('a character column past a wide character is two cells per character', () => {
  const line = 'const 中文 = 1'
  // `中文` is two characters and four cells, so everything after it shifts by two.
  expect(span(line, 0, 5)).toEqual({ end: 5, start: 0 })
  expect(span(line, 6, 8)).toEqual({ end: 10, start: 6 })
  expect(span(line, 11, 12)).toEqual({ end: 14, start: 13 })
})

test('a cluster is measured whole, however many code points it holds', () => {
  // One grapheme, two cells: counting code points would say four, and by code unit, seven.
  expect(span('👨‍👩‍👧 x', 8, 9)).toEqual({ end: 3, start: 2 })
  // A variation selector makes a narrow symbol wide; the base code point alone would not say so.
  expect(span('⚠️ x', 3, 4)).toEqual({ end: 4, start: 3 })
  // A combining mark takes no cell of its own.
  expect(span('éx', 2, 3)).toEqual({ end: 2, start: 1 })
})

test('a tab still counts as its own two cells', () => {
  expect(span('a\tb', 2, 3)).toEqual({ end: 4, start: 3 })
})

test('an ASCII line is handed back untouched', () => {
  const plain = { end: 9, start: 4 }
  expect(inCells(plain, 'const a = 1')).toBe(plain)
})

test('syntax lands on the code after a wide character, not left of it', async () => {
  const dir = fixture({ 'a.ts': 'const 名前 = "x"\n' })
  const t = await launch(dir, {}, { height: 12, width: 80 })
  await openFile(t, 'a.ts')

  const spans = () => spansOf(t, 'const 名前')
  const quoted = () => spans().find((s) => s.text.includes('"x"'))
  // The keyword painted on its own is the line having been highlighted at all; the gutter is
  // spans of its own, so a count would be satisfied before a single token was coloured.
  await until(t, () => spans().some((s) => s.text.trim() === 'const'), 15_000)
  // Painted as its own span: a mapping that counted the two wide characters as one cell each
  // would tint two cells of the name instead and leave the last quote plain.
  expect(quoted()?.text.trim()).toBe('"x"')
  // Past bun's 5s default: the wait above is for a cold grammar load.
}, 60_000)
