import { describe, expect, test } from 'bun:test'

import { unifiedDiff } from '../src/core/diff'

describe('unifiedDiff', () => {
  test('an unchanged file produces an empty patch', () => {
    const diff = unifiedDiff('a.ts', 'a\nb\n', 'a\nb\n')
    expect(diff.patch).toBe('')
    expect(diff.adds).toBe(0)
    expect(diff.dels).toBe(0)
  })

  test('a modified line emits one hunk with context and counts', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
    expect(diff.patch).toBe(
      [
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
        '',
      ].join('\n')
    )
  })

  test('a change of only the final newline is still a change', () => {
    const diff = unifiedDiff('a.ts', 'a\nb', 'a\nb\n')
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
    expect(diff.patch).toContain('-b\n\\ No newline at end of file\n+b\n')
    expect(unifiedDiff('a.ts', 'a\nb\n', 'a\nb\n').patch).toBe('')
  })

  test('a gained final newline is marked beside the file’s other changes', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\nthree', 'ONE\ntwo\nthree\n')
    expect(diff.adds).toBe(2)
    expect(diff.dels).toBe(2)
    expect(diff.lines).toBe(5)
    expect(diff.patch).toBe(
      [
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,3 +1,3 @@',
        '-one',
        '+ONE',
        ' two',
        '-three',
        '\\ No newline at end of file',
        '+three',
        '',
      ].join('\n')
    )
  })

  test('a last line with no newline is marked where it is only context', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo', 'ONE\ntwo')
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
    expect(diff.patch).toContain('+ONE\n two\n\\ No newline at end of file\n')
  })

  test('an added last line with no newline is marked on the new side', () => {
    const diff = unifiedDiff('a.ts', 'one\n', 'one\ntwo')
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(0)
    expect(diff.patch).toContain(' one\n+two\n\\ No newline at end of file\n')
  })

  test('a new file diffs from /dev/null with a -0,0 hunk', () => {
    const diff = unifiedDiff('new.ts', '', 'a\nb\n')
    expect(diff.adds).toBe(2)
    expect(diff.dels).toBe(0)
    expect(diff.patch).toBe(
      ['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,2 @@', '+a', '+b', ''].join(
        '\n'
      )
    )
  })

  test('a deleted file diffs to /dev/null', () => {
    const diff = unifiedDiff('gone.ts', 'a\nb\n', '')
    expect(diff.dels).toBe(2)
    expect(diff.patch).toContain('+++ /dev/null')
    expect(diff.patch).toContain('@@ -1,2 +0,0 @@')
  })

  test('far-apart changes land in separate hunks, close ones share', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
    const far = [...lines]
    far[0] = 'FIRST'
    far[29] = 'LAST'
    const twoHunks = unifiedDiff(
      'a.ts',
      `${lines.join('\n')}\n`,
      `${far.join('\n')}\n`
    )
    expect(twoHunks.patch.match(/^@@ /gmu)).toHaveLength(2)
    expect(twoHunks.patch).not.toContain('line15')

    const near = [...lines]
    near[0] = 'FIRST'
    near[4] = 'FIFTH'
    const oneHunk = unifiedDiff(
      'a.ts',
      `${lines.join('\n')}\n`,
      `${near.join('\n')}\n`
    )
    expect(oneHunk.patch.match(/^@@ /gmu)).toHaveLength(1)
  })

  test('hunk positions stay correct after earlier insertions', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
    const changed = [...lines]
    changed.splice(2, 0, 'INSERTED')
    changed[25] = 'CHANGED'
    const diff = unifiedDiff(
      'a.ts',
      `${lines.join('\n')}\n`,
      `${changed.join('\n')}\n`
    )
    expect(diff.patch).toContain('@@ -22,7 +23,7 @@')
    expect(diff.patch).toContain('-line24')
    expect(diff.patch).toContain('+CHANGED')
  })
})

describe('scale', () => {
  test('a small edit in a large file stays exact', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
    const changed = [...lines]
    changed[2500] = 'CHANGED'
    const diff = unifiedDiff(
      'a.ts',
      `${lines.join('\n')}\n`,
      `${changed.join('\n')}\n`
    )
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
  })

  test('two unrelated texts fall back to a rewrite rather than hanging', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `alpha ${i}`).join('\n')
    const b = Array.from({ length: 4000 }, (_, i) => `beta ${i}`).join('\n')
    const started = performance.now()
    const diff = unifiedDiff('a.ts', `${a}\n`, `${b}\n`)
    expect(performance.now() - started).toBeLessThan(5000)
    expect(diff.dels).toBe(4000)
    expect(diff.adds).toBe(4000)
    expect(diff.lines).toBe(8000)
    expect(diff.truncated).toBe(false)
  })

  test('a rewrite marks the side that has no final newline', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `alpha ${i}`).join('\n')
    const b = Array.from({ length: 4000 }, (_, i) => `beta ${i}`).join('\n')
    const diff = unifiedDiff('a.ts', a, `${b}\n`)
    expect(diff.patch).toContain(
      '-alpha 3999\n\\ No newline at end of file\n+beta 0\n'
    )
    expect(diff.patch).toEndWith('+beta 3999\n')
    expect(diff.lines).toBe(8000)
  })

  test('maxLines cuts the patch body but not the counts', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `alpha ${i}`).join('\n')
    const b = Array.from({ length: 4000 }, (_, i) => `beta ${i}`).join('\n')
    const diff = unifiedDiff('a.ts', `${a}\n`, `${b}\n`, 100)
    expect(diff.adds).toBe(4000)
    expect(diff.dels).toBe(4000)
    expect(diff.lines).toBe(100)
    expect(diff.truncated).toBe(true)
    const body = diff.patch
      .split('\n')
      .filter(
        (l) => /^[ +-]/u.test(l) && !l.startsWith('+++') && !l.startsWith('---')
      )
    expect(body).toHaveLength(100)
    // The cap is spent across both sides: all-deletions would read as "new file empty".
    expect(diff.patch).toContain('@@ -1,50 +1,50 @@')
    expect(body.filter((l) => l.startsWith('-'))).toHaveLength(50)
    expect(body.filter((l) => l.startsWith('+'))).toHaveLength(50)
  })

  test('a diff under maxLines is not truncated', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\n', 'one\nTWO\n', 100)
    expect(diff.truncated).toBe(false)
    expect(diff.lines).toBe(3)
  })

  test('a rewrite keeps its context rows and hunk arithmetic', () => {
    const shared = ['keep0', 'keep1', 'keep2', 'keep3', 'keep4']
    const a = [
      ...shared,
      ...Array.from({ length: 3000 }, (_, i) => `alpha ${i}`),
      ...shared,
    ]
    const b = [
      ...shared,
      ...Array.from({ length: 3000 }, (_, i) => `beta ${i}`),
      ...shared,
    ]
    const diff = unifiedDiff('a.ts', `${a.join('\n')}\n`, `${b.join('\n')}\n`)
    expect(diff.adds).toBe(3000)
    expect(diff.dels).toBe(3000)
    expect(diff.patch).toContain('@@ -3,3006 +3,3006 @@')
    expect(diff.patch).toContain(' keep2\n keep3\n keep4\n-alpha 0')
    expect(diff.patch).toContain('+beta 2999\n keep0\n keep1\n keep2\n')
    expect(diff.lines).toBe(6006)
    expect(diff.truncated).toBe(false)
  })

  test('maxLines keeps whole earlier hunks and drops later ones', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
    const changed = [...lines]
    changed[0] = 'FIRST'
    changed[59] = 'LAST'
    const diff = unifiedDiff(
      'a.ts',
      `${lines.join('\n')}\n`,
      `${changed.join('\n')}\n`,
      6
    )
    expect(diff.patch).toContain('+FIRST')
    expect(diff.patch).not.toContain('+LAST')
    expect(diff.adds).toBe(2)
    expect(diff.dels).toBe(2)
    expect(diff.truncated).toBe(true)
  })
})
