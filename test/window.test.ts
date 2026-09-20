import { describe, expect, test } from 'bun:test'

import { logicalWindow } from '../src/editor/window'

const wrapped = (lines: number, perLine: number) =>
  Array.from({ length: lines * perLine }, (_, row) => Math.floor(row / perLine))

describe('the window a viewport covers', () => {
  test('is the scroll position itself when nothing wraps', () => {
    expect(logicalWindow(100, 20, [], 60)).toEqual({ from: 40, to: 180 })
  })

  test('never asks for a negative line', () => {
    expect(logicalWindow(5, 20, [], 60).from).toBe(0)
  })

  test('translates visual rows to lines when the file wraps', () => {
    // Four visual rows per line: row 5 970 is line 1 492, and line 5 970 is past the file's end.
    const sources = wrapped(3000, 4)
    const { from, to } = logicalWindow(5970, 22, sources, 60)

    expect(from).toBe(1492 - 60)
    expect(to).toBeLessThan(3000)
    expect(from).toBeLessThanOrEqual(1492)
    expect(to).toBeGreaterThanOrEqual(1497)
  })

  test('clamps to the last row rather than running off the table', () => {
    const sources = wrapped(100, 3)
    const { to } = logicalWindow(sources.length - 1, 40, sources, 10)

    expect(to).toBe(99 + 10)
  })

  test('a window deep in a wrapped file still covers the lines on screen', () => {
    const sources = wrapped(800, 3)
    for (const line of [100, 400, 799]) {
      const scrollY = line * 3
      const { from, to } = logicalWindow(scrollY, 22, sources, 60)
      expect(from).toBeLessThanOrEqual(line)
      expect(to).toBeGreaterThanOrEqual(line)
    }
  })
})
