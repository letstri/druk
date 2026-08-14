import { describe, expect, test } from 'bun:test'

import { conflictAt, conflictFrom, parseConflicts, resolveConflict } from '../src/core/conflicts'

const CONFLICTED = [
  'const a = 1',
  '<<<<<<< HEAD',
  'const b = 2',
  '=======',
  'const b = 3',
  '>>>>>>> feature/x',
  'const c = 4',
  '',
].join('\n')

/** git's diff3 style, which puts the merge base between the two sides. */
const DIFF3 = [
  '<<<<<<< HEAD',
  'ours',
  '||||||| merged common ancestors',
  'base',
  '=======',
  'theirs',
  '>>>>>>> other',
  '',
].join('\n')

describe('parsing', () => {
  test('finds the block and names both sides', () => {
    const [conflict] = parseConflicts(CONFLICTED)
    expect(conflict).toEqual({
      start: 1,
      base: null,
      separator: 3,
      end: 5,
      ours: 'HEAD',
      theirs: 'feature/x',
    })
  })

  test('picks the base marker out of a diff3 block', () => {
    const [conflict] = parseConflicts(DIFF3)
    expect(conflict?.base).toBe(2)
    expect(conflict?.separator).toBe(4)
  })

  test('an unterminated block is not a conflict', () => {
    // Prose about the markers, or a merge half-written: offering to resolve this
    // would eat everything after it.
    expect(parseConflicts('<<<<<<< HEAD\nours\nno separator, no end\n')).toEqual([])
    expect(parseConflicts('<<<<<<< HEAD\nours\n=======\ntheirs\n')).toEqual([])
  })

  test('eight angle brackets is not a marker', () => {
    expect(parseConflicts('<<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n')).toEqual([])
  })

  test('a CRLF file parses', () => {
    const text = '<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> other\r\n'
    expect(parseConflicts(text)).toHaveLength(1)
  })

  test('several blocks come back in order', () => {
    const two = CONFLICTED + CONFLICTED
    const found = parseConflicts(two)
    expect(found).toHaveLength(2)
    expect(found[0]!.start).toBeLessThan(found[1]!.start)
  })
})

describe('finding the one at the cursor', () => {
  const conflicts = parseConflicts(CONFLICTED)

  test('the markers count as inside', () => {
    expect(conflictAt(conflicts, 1)).not.toBeNull()
    expect(conflictAt(conflicts, 5)).not.toBeNull()
  })

  test('the lines around it do not', () => {
    expect(conflictAt(conflicts, 0)).toBeNull()
    expect(conflictAt(conflicts, 6)).toBeNull()
  })
})

describe('walking between them', () => {
  const conflicts = parseConflicts(CONFLICTED + CONFLICTED)

  test('forward from the top lands on the first', () => {
    expect(conflictFrom(conflicts, 0, 1)).toBe(conflicts[0]!)
  })

  test('forward from the last wraps to the first', () => {
    expect(conflictFrom(conflicts, conflicts[1]!.start, 1)).toBe(conflicts[0]!)
  })

  test('backward from the top wraps to the last', () => {
    expect(conflictFrom(conflicts, 0, -1)).toBe(conflicts[1]!)
  })

  test('a file with none answers null', () => {
    expect(conflictFrom([], 0, 1)).toBeNull()
  })
})

describe('resolving', () => {
  const [conflict] = parseConflicts(CONFLICTED)

  test('ours keeps the first side and drops every marker', () => {
    expect(resolveConflict(CONFLICTED, conflict!, 'ours')).toBe(
      'const a = 1\nconst b = 2\nconst c = 4\n',
    )
  })

  test('theirs keeps the second', () => {
    expect(resolveConflict(CONFLICTED, conflict!, 'theirs')).toBe(
      'const a = 1\nconst b = 3\nconst c = 4\n',
    )
  })

  test('both keeps them in the order the markers had them', () => {
    expect(resolveConflict(CONFLICTED, conflict!, 'both')).toBe(
      'const a = 1\nconst b = 2\nconst b = 3\nconst c = 4\n',
    )
  })

  test('the diff3 base goes with the markers, whichever side is kept', () => {
    const [diff3] = parseConflicts(DIFF3)
    expect(resolveConflict(DIFF3, diff3!, 'ours')).toBe('ours\n')
    expect(resolveConflict(DIFF3, diff3!, 'theirs')).toBe('theirs\n')
  })

  test('CRLF endings outside the block survive it', () => {
    const text = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> other\r\nb\r\n'
    const [crlf] = parseConflicts(text)
    expect(resolveConflict(text, crlf!, 'ours')).toBe('a\r\nours\r\nb\r\n')
  })

  test('a conflict ending the file with no trailing newline resolves', () => {
    const text = 'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other'
    const [last] = parseConflicts(text)
    expect(resolveConflict(text, last!, 'theirs')).toBe('a\ntheirs\n')
  })

  test('an empty side resolves to nothing at all', () => {
    const text = 'a\n<<<<<<< HEAD\n=======\ntheirs\n>>>>>>> other\nb\n'
    const [empty] = parseConflicts(text)
    expect(resolveConflict(text, empty!, 'ours')).toBe('a\nb\n')
  })
})
