import { describe, expect, test } from 'bun:test'

import {
  applyCompletion,
  extendsWord,
  filterCompletions,
  fuzzyMatch,
  isDeprecated,
  itemInfo,
  matchRuns,
  normalizeCompletion,
  plainMarkup,
  stripSnippet,
  wordStart,
} from '../src/lsp/completion'
import type { CompletionItem } from '../src/lsp/protocol'
import { layoutMenu } from '../src/ui/completionLayout'

describe('normalizeCompletion', () => {
  test('accepts a bare array, a list, and rejects junk', () => {
    expect(normalizeCompletion(null)).toBeNull()
    expect(normalizeCompletion([{ label: 'a' }])).toEqual({
      isIncomplete: false,
      items: [{ label: 'a' }],
    })
    expect(
      normalizeCompletion({ isIncomplete: true, items: [{ label: 'a' }] })
    ).toEqual({
      isIncomplete: true,
      items: [{ label: 'a' }],
    })
    expect(normalizeCompletion({ nonsense: 1 })).toBeNull()
  })
})

describe('wordStart', () => {
  test('walks identifier characters back from the cursor', () => {
    expect(wordStart('const foo_bar', 13)).toBe(6)
    expect(wordStart('a.mem', 5)).toBe(2)
    expect(wordStart('a.', 2)).toBe(2)
    expect(wordStart('', 0)).toBe(0)
  })
})

describe('extendsWord', () => {
  test('word characters typed past the request keep the reply valid', () => {
    expect(extendsWord('d.tab(', 2, 5)).toBe(true)
    expect(extendsWord('d.tab(', 5, 5)).toBe(true)
  })

  test('a scope change or a retreat invalidates it', () => {
    expect(extendsWord('d.snakeCase.', 2, 12)).toBe(false)
    expect(extendsWord('druk(', 4, 5)).toBe(false)
    expect(extendsWord('druk', 4, 2)).toBe(false)
    expect(extendsWord('ab', 1, 4)).toBe(false)
  })
})

describe('fuzzyMatch', () => {
  test('empty query matches everything with no highlight', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ positions: [], score: 0 })
  })

  test('non-subsequence fails', () => {
    expect(fuzzyMatch('xyz', 'map')).toBeNull()
  })

  test('prefers word starts and consecutive runs', () => {
    const exact = fuzzyMatch('map', 'map')!
    const scattered = fuzzyMatch('map', 'meltAtPressure')!
    expect(exact.score).toBeGreaterThan(scattered.score)
    expect(exact.positions).toEqual([0, 1, 2])
  })

  test('camelCase humps count as word starts', () => {
    const hump = fuzzyMatch('fb', 'fooBar')!
    const flat = fuzzyMatch('fb', 'foobar')!
    expect(hump.score).toBeGreaterThan(flat.score)
  })

  test('length is not scored, so an equal prefix match ties', () => {
    expect(fuzzyMatch('tab', 'table')!.score).toBe(
      fuzzyMatch('tab', 'tableOfContents')!.score
    )
  })

  test('the same letters in the same case beat a case-folded match', () => {
    expect(fuzzyMatch('tab', 'table')!.score).toBeGreaterThan(
      fuzzyMatch('tab', 'Table')!.score
    )
  })
})

describe('filterCompletions', () => {
  const items: CompletionItem[] = [
    { label: 'mapValues' },
    { label: 'map' },
    { label: 'unrelated' },
    { label: 'flatMap' },
  ]

  test('drops non-matches and puts the tight match first', () => {
    const got = filterCompletions(items, 'map').map((m) => m.item.label)
    expect(got).not.toContain('unrelated')
    expect(got[0]).toBe('map')
  })

  test('matches filterText but only highlights an honest label', () => {
    const [match] = filterCompletions(
      [{ filterText: 'send', label: '★ send' }],
      'se'
    )
    expect(match).toBeDefined()
    expect(match!.positions).toEqual([])
  })

  test('empty prefix keeps the server order via sortText', () => {
    const got = filterCompletions(
      [
        { label: 'b', sortText: '2' },
        { label: 'a', sortText: '1' },
      ],
      ''
    ).map((m) => m.item.label)
    expect(got).toEqual(['a', 'b'])
  })

  test('sortText decides between items the prefix fits equally well', () => {
    const got = filterCompletions(
      [
        { label: 'TableAliasProxyHandler', sortText: '16' },
        { label: 'tableName', sortText: '16' },
        { label: 'table', sortText: '11' },
      ],
      'tab'
    ).map((m) => m.item.label)
    expect(got[0]).toBe('table')
  })

  test('a better prefix match still outranks a lower sortText', () => {
    const got = filterCompletions(
      [
        { label: 'pgTable', sortText: '11' },
        { label: 'table', sortText: '16' },
      ],
      'tab'
    ).map((m) => m.item.label)
    expect(got[0]).toBe('table')
  })
})

// LSP snippet syntax below, not template literals.
/* oxlint-disable no-template-curly-in-string */
describe('stripSnippet', () => {
  test('placeholders keep their text, stops vanish, caret lands on the first stop', () => {
    expect(stripSnippet('foo($1)')).toEqual({ caret: 4, text: 'foo()' })
    expect(stripSnippet('foo(${1:arg})')).toEqual({
      caret: 4,
      text: 'foo(arg)',
    })
    expect(stripSnippet('${1|red,green|}')).toEqual({ caret: 0, text: 'red' })
    expect(stripSnippet('plain')).toEqual({ caret: null, text: 'plain' })
    expect(stripSnippet('done$0')).toEqual({ caret: null, text: 'done' })
  })
})

describe('applyCompletion', () => {
  test('replaces the typed prefix when the item has no textEdit', () => {
    const got = applyCompletion(
      'const x = ma\n',
      { character: 12, line: 0 },
      10,
      {
        label: 'map',
      }
    )
    expect(got.content).toBe('const x = map\n')
    expect(got.cursor).toEqual({ character: 13, line: 0 })
  })

  test('honours the server textEdit range', () => {
    const got = applyCompletion('a.me\n', { character: 4, line: 0 }, 2, {
      label: 'method',
      textEdit: {
        newText: 'method',
        range: {
          end: { character: 4, line: 0 },
          start: { character: 2, line: 0 },
        },
      },
    })
    expect(got.content).toBe('a.method\n')
    expect(got.cursor).toEqual({ character: 8, line: 0 })
  })

  test('extends a stale textEdit to cover characters typed during the request', () => {
    const got = applyCompletion('consol\n', { character: 6, line: 0 }, 0, {
      label: 'console',
      textEdit: {
        newText: 'console',
        range: {
          end: { character: 3, line: 0 },
          start: { character: 0, line: 0 },
        },
      },
    })
    expect(got.content).toBe('console\n')
  })

  test('applies additionalTextEdits and keeps the cursor on the primary insert', () => {
    const got = applyCompletion(
      'const y = druk\n',
      { character: 14, line: 0 },
      10,
      {
        additionalTextEdits: [
          {
            newText: 'import { drukImported } from "druk"\n',
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        label: 'drukImported',
      }
    )
    expect(got.content).toBe(
      'import { drukImported } from "druk"\nconst y = drukImported\n'
    )
    expect(got.cursor).toEqual({ character: 22, line: 1 })
  })

  test('snippet inserts land the caret on the first stop', () => {
    const got = applyCompletion('fo\n', { character: 2, line: 0 }, 0, {
      insertText: 'foo(${1:x})',
      insertTextFormat: 2,
      label: 'foo',
    })
    expect(got.content).toBe('foo(x)\n')
    expect(got.cursor).toEqual({ character: 4, line: 0 })
  })

  test('multi-line snippets are re-indented to the line they land on', () => {
    const got = applyCompletion(
      '  def name() do\n',
      { character: 15, line: 0 },
      13,
      {
        insertTextFormat: 2,
        label: 'do/end block',
        textEdit: {
          newText: 'do\n  $0\nend',
          range: {
            end: { character: 15, line: 0 },
            start: { character: 13, line: 0 },
          },
        },
      }
    )
    expect(got.content).toBe('  def name() do\n    \n  end\n')
    expect(got.cursor).toEqual({ character: 4, line: 1 })
  })

  test('a multi-line insert at column 0 keeps the server text as-is', () => {
    const got = applyCompletion(
      'def name() do\n',
      { character: 13, line: 0 },
      11,
      {
        insertTextFormat: 2,
        label: 'do/end block',
        textEdit: {
          newText: 'do\n  $0\nend',
          range: {
            end: { character: 13, line: 0 },
            start: { character: 11, line: 0 },
          },
        },
      }
    )
    expect(got.content).toBe('def name() do\n  \nend\n')
    expect(got.cursor).toEqual({ character: 2, line: 1 })
  })

  test('a plain-text multi-line insert is not re-indented', () => {
    const got = applyCompletion('    foo\n', { character: 7, line: 0 }, 4, {
      insertText: 'a\nb\nc',
      insertTextFormat: 1,
      label: 'block',
    })
    expect(got.content).toBe('    a\nb\nc\n')
  })
})

describe('plainMarkup', () => {
  test('flattens the marks a doc comment carries', () => {
    expect(
      plainMarkup({
        kind: 'markdown',
        value:
          '# Title\n\nCalls **now** with `arg`.\n\n```ts\nfn()\n```\n\n- one\n- two',
      })
    ).toBe('Title\n\nCalls now with arg.\n\nfn()\n\n• one\n• two')
    expect(plainMarkup('plain text')).toBe('plain text')
    expect(plainMarkup()).toBe('')
  })

  test('itemInfo collapses a multi-line signature and reads both deprecation spellings', () => {
    expect(
      itemInfo({ detail: '(x: number)\n  => void', label: 'a' }).detail
    ).toBe('(x: number) => void')
    expect(
      itemInfo({ label: 'a', labelDetails: { detail: '(x)' } }).detail
    ).toBe('(x)')
    expect(isDeprecated({ label: 'a', tags: [1] })).toBe(true)
    expect(isDeprecated({ deprecated: true, label: 'a' })).toBe(true)
    expect(isDeprecated({ label: 'a' })).toBe(false)
  })
})

describe('layoutMenu', () => {
  const many = Array.from({ length: 30 }, (_, at) => ({
    item: { kind: 3, label: `item${at}` },
    positions: [],
    score: 0,
  }))
  const roomy = { height: 40, width: 120 }

  const info = {
    deprecated: false,
    detail: '(a: number) => void',
    documentation: 'Does a thing.',
    source: '',
  }

  test('caps the list and adds the counter row', () => {
    const layout = layoutMenu(many, null, roomy, false)
    expect(layout.rows).toBe(12)
    expect(layout.height).toBe(15)
    expect(layout.documentation).toEqual([])
  })

  test('the panel holds the resolved lines, and the box never wraps a signature thin', () => {
    const layout = layoutMenu(many, info, roomy, true)
    expect(layout.signature).toEqual([
      { start: 0, text: '(a: number) => void' },
    ])
    expect(layout.documentation).toEqual(['Does a thing.'])
    expect(layout.width).toBeGreaterThanOrEqual(56)
  })

  test('a wrapped signature keeps each row offset into the string it was cut from', () => {
    const long =
      'const draw: <Value extends number>(props: Props<Value>) => Element'
    const layout = layoutMenu(
      many,
      { ...info, detail: long },
      { height: 40, width: 40 },
      true
    )
    expect(layout.signature.length).toBeGreaterThan(1)
    for (const line of layout.signature) {
      expect(long.slice(line.start, line.start + line.text.length)).toBe(
        line.text
      )
    }
  })

  test('the signature grows into the rows the documentation left blank', () => {
    const wordy = { ...info, detail: 'word '.repeat(60).trim() }
    const layout = layoutMenu(many, wordy, roomy, true)
    expect(layout.signature.length).toBe(6)
    expect(layout.signature.at(-1)!.text).not.toContain('…')
    const both = layoutMenu(
      many,
      { ...wordy, documentation: 'doc. '.repeat(200) },
      roomy,
      true
    )
    expect(both.signature.length).toBe(3)
    expect(both.documentation.length).toBe(both.panelRows - 3)
  })

  test('the origin only fills a row the panel would have drawn blank', () => {
    const spare = layoutMenu(
      many,
      { ...info, source: 'druk/alpha' },
      roomy,
      true
    )
    expect(spare.origin).toBe('druk/alpha')
    const full = layoutMenu(
      many,
      { ...info, documentation: 'doc. '.repeat(200), source: 'druk/alpha' },
      roomy,
      true
    )
    expect(full.origin).toBe('')
  })

  test('the panel is sized to the item, and the floor keeps it from shrinking', () => {
    const empty = layoutMenu(many, null, roomy, true)
    expect(empty.panelRows).toBe(0)
    expect(empty.height).toBe(layoutMenu(many, null, roomy, false).height)
    const filled = layoutMenu(many, info, roomy, true)
    expect(filled.panelRows).toBe(2)
    const wordy = layoutMenu(
      many,
      {
        deprecated: false,
        detail: 'x '.repeat(200),
        documentation: 'y '.repeat(400),
        source: '',
      },
      roomy,
      true
    )
    expect(wordy.panelRows).toBe(9)
    const kept = layoutMenu(many, info, roomy, true, wordy.panelRows)
    expect(kept.panelRows).toBe(9)
    expect(kept.height).toBe(wordy.height)
    expect(kept.width).toBe(wordy.width)
    expect(layoutMenu(many, null, roomy, true, 4).panelRows).toBe(4)
    expect(
      layoutMenu(many, info, { height: 19, width: 120 }, true, 9).panelRows
    ).toBe(3)
  })

  test('a short pane drops the panel before it drops the list', () => {
    const layout = layoutMenu(many, info, { height: 6, width: 120 }, true)
    expect(layout.panelRows).toBe(0)
    expect(layout.signature).toEqual([])
    expect(layout.rows).toBe(3)
    expect(layout.height).toBeLessThanOrEqual(6)
  })

  test('an empty list is the notice row alone', () => {
    expect(layoutMenu([], null, roomy, true)).toMatchObject({
      height: 3,
      rows: 0,
    })
  })
})

describe('matchRuns', () => {
  test('splits a label into hit and miss runs', () => {
    expect(matchRuns('flatMap', [0, 4, 5, 6])).toEqual([
      { hit: true, text: 'f' },
      { hit: false, text: 'lat' },
      { hit: true, text: 'Map' },
    ])
    expect(matchRuns('plain', [])).toEqual([{ hit: false, text: 'plain' }])
  })
})
