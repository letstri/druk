import { describe, expect, test } from 'bun:test'

import { problemRows } from '../src/editor/problems'
import type { ProblemSeverity } from '../src/lsp/protocol'

const marks = (entries: [number, ProblemSeverity][]) =>
  new Map(entries.map(([line, severity]) => [line, { severity }]))

describe('problems down the track', () => {
  test('a problem marks the row that stands for its line', () => {
    const rows = problemRows(marks([[0, 'error']]), 100, 10)

    expect(rows[0]).toBe('error')
    expect(rows.filter(Boolean)).toHaveLength(1)
  })

  test('the whole file is covered, not just the visible part', () => {
    const rows = problemRows(marks([[950, 'error']]), 1000, 20)

    expect(rows.at(-1)).toBe('error')
    expect(rows[0]).toBeUndefined()
  })

  test('the worst severity wins when a row covers several lines', () => {
    const rows = problemRows(
      marks([
        [0, 'warning'],
        [1, 'error'],
        [2, 'warning'],
      ]),
      30,
      10
    )

    expect(rows[0]).toBe('error')
  })

  test('info and hint stay off the track', () => {
    const rows = problemRows(
      marks([
        [0, 'info'],
        [40, 'hint'],
      ]),
      100,
      10
    )

    expect(rows.some(Boolean)).toBe(false)
  })

  test('lines outside the file are ignored rather than clamped onto a row', () => {
    expect(problemRows(marks([[500, 'error']]), 100, 10).some(Boolean)).toBe(
      false
    )
  })

  test('nothing to draw on is an empty result, not a crash', () => {
    expect(problemRows(marks([[1, 'error']]), 100, 0)).toEqual([])
    expect(problemRows(marks([[1, 'error']]), 0, 10).some(Boolean)).toBe(false)
  })
})
