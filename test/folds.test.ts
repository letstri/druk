import { expect, test } from 'bun:test'

import {
  foldableRegions,
  foldsFrom,
  foldView,
  innermostRegion,
  reconcileFolds,
} from '../src/editor/folds'

const SAMPLE = [
  //         0
  'function outer() {',
  //              1
  '  const a = 1',
  //                 2
  '  if (a) {',
  //                 3
  '    log(a)',
  //                        4
  '  }',
  //                          5
  '}',
  //                           6
  '',
  //            7
  'const after = 2',
].join('\n')

test('a block owns the more-indented lines under it, not its closing brace', () => {
  const regions = foldableRegions(SAMPLE, 2)
  expect(regions).toContainEqual({ end: 4, start: 0 })
  expect(regions).toContainEqual({ end: 3, start: 2 })
  expect(regions.some((region) => region.start === 7)).toBe(false)
  expect(regions.some((region) => region.start === 1)).toBe(false)
})

test('the per-line test agrees with the whole-file pass', () => {
  const starts = [0]
  for (
    let at = SAMPLE.indexOf('\n');
    at >= 0;
    at = SAMPLE.indexOf('\n', at + 1)
  ) {
    starts.push(at + 1)
  }
  const wanted = new Set(
    foldableRegions(SAMPLE, 2).map((region) => region.start)
  )
  const answered = new Set<number>()
  for (let line = 0; line < starts.length; line += 1) {
    if (foldsFrom(SAMPLE, starts, line, 2)) {
      answered.add(line)
    }
  }
  expect([...answered].toSorted()).toEqual([...wanted].toSorted())
})

test('the innermost region is the one a fold at the cursor takes', () => {
  const regions = foldableRegions(SAMPLE, 2)
  expect(innermostRegion(regions, 3)).toEqual({ end: 3, start: 2 })
  expect(innermostRegion(regions, 0)).toEqual({ end: 4, start: 0 })
  expect(innermostRegion(regions, 7)).toBeNull()
})

test('a view hides the block and keeps the line numbers translatable', () => {
  const view = foldView(SAMPLE, [{ end: 4, start: 0 }])
  expect(view.text).toBe('function outer() {\n}\n\nconst after = 2')
  expect(view.real).toEqual([0, 5, 6, 7])
  expect(view.display[3]).toBe(-1)
  expect(view.display[5]).toBe(1)
  expect(view.hidden.get(0)).toBe(4)
})

test('a nested fold keeps no note while the block above it is closed', () => {
  const view = foldView(SAMPLE, [
    { end: 4, start: 0 },
    { end: 3, start: 2 },
  ])
  expect(view.hidden.has(2)).toBe(false)
  expect(foldView(SAMPLE, [{ end: 3, start: 2 }]).hidden.get(2)).toBe(1)
})

test('an edit away from a fold moves it without touching what it hides', () => {
  const view = foldView(SAMPLE, [{ end: 3, start: 2 }])
  const edited = view.text.split('\n')
  edited[1] = '  const a = 11'
  const { source, folds } = reconcileFolds(view, edited.join('\n'))
  expect(source.split('\n')[1]).toBe('  const a = 11')
  expect(source.split('\n')[3]).toBe('    log(a)')
  expect(folds).toEqual([{ end: 3, start: 2 }])
})

test('lines inserted above a fold carry it down with them', () => {
  const view = foldView(SAMPLE, [{ end: 3, start: 2 }])
  const edited = view.text.split('\n')
  edited.splice(1, 0, '  // note', '  // more')
  const { source, folds } = reconcileFolds(view, edited.join('\n'))
  expect(folds).toEqual([{ end: 5, start: 4 }])
  expect(source.split('\n')[5]).toBe('    log(a)')
})

test('an edit that takes an anchor away keeps the lines it was hiding', () => {
  const view = foldView(SAMPLE, [{ end: 3, start: 2 }])
  const edited = view.text.split('\n')
  edited.splice(2, 1)
  const { source, folds } = reconcileFolds(view, edited.join('\n'))
  expect(source).toContain('log(a)')
  expect(folds).toEqual([])
})

test('a fold whose lines are gone is dropped rather than pointed elsewhere', () => {
  const view = foldView(SAMPLE, [{ end: 3, start: 2 }])
  const { folds } = reconcileFolds(view, 'x')
  expect(folds).toEqual([])
})

test('tabs count as a full indent stop', () => {
  const text = ['def f():', '\treturn 1', 'g()'].join('\n')
  expect(foldableRegions(text, 4)).toEqual([{ end: 1, start: 0 }])
})

test('a blank line inside a block does not end it', () => {
  const text = ['a:', '  one', '', '  two', 'b:'].join('\n')
  expect(foldableRegions(text, 2)).toContainEqual({ end: 3, start: 0 })
})
