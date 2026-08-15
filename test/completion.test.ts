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
      items: [{ label: 'a' }],
      isIncomplete: false,
    })
    expect(normalizeCompletion({ isIncomplete: true, items: [{ label: 'a' }] })).toEqual({
      items: [{ label: 'a' }],
      isIncomplete: true,
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
    expect(extendsWord('d.tab(', 2, 5)).toBe(true) // "tab" typed after asking at the dot
    expect(extendsWord('d.tab(', 5, 5)).toBe(true) // nothing typed at all
  })

  test('a scope change or a retreat invalidates it', () => {
    expect(extendsWord('d.snakeCase.', 2, 12)).toBe(false) // a `.` landed mid-flight
    expect(extendsWord('druk(', 4, 5)).toBe(false) // a `(` landed mid-flight
    expect(extendsWord('druk', 4, 2)).toBe(false) // cursor moved back past the ask
    expect(extendsWord('ab', 1, 4)).toBe(false) // cursor past the line the ask saw
  })
})

describe('fuzzyMatch', () => {
  test('empty query matches everything with no highlight', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
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
    expect(fuzzyMatch('tab', 'table')!.score).toBe(fuzzyMatch('tab', 'tableOfContents')!.score)
  })

  test('the same letters in the same case beat a case-folded match', () => {
    expect(fuzzyMatch('tab', 'table')!.score).toBeGreaterThan(fuzzyMatch('tab', 'Table')!.score)
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
    const got = filterCompletions(items, 'map').map(m => m.item.label)
    expect(got).not.toContain('unrelated')
    expect(got[0]).toBe('map')
  })

  test('matches filterText but only highlights an honest label', () => {
    const [match] = filterCompletions([{ label: '★ send', filterText: 'send' }], 'se')
    expect(match).toBeDefined()
    expect(match!.positions).toEqual([])
  })

  test('empty prefix keeps the server order via sortText', () => {
    const got = filterCompletions(
      [
        { label: 'b', sortText: '2' },
        { label: 'a', sortText: '1' },
      ],
      '',
    ).map(m => m.item.label)
    expect(got).toEqual(['a', 'b'])
  })

  test('sortText decides between items the prefix fits equally well', () => {
    // What tsserver sends for `x.tab|`: the type's own property ranks 11, the
    // auto-import candidates 16. The property must not sink under 200 of them.
    const got = filterCompletions(
      [
        { label: 'TableAliasProxyHandler', sortText: '16' },
        { label: 'tableName', sortText: '16' },
        { label: 'table', sortText: '11' },
      ],
      'tab',
    ).map(m => m.item.label)
    expect(got[0]).toBe('table')
  })

  test('a better prefix match still outranks a lower sortText', () => {
    const got = filterCompletions(
      [
        { label: 'pgTable', sortText: '11' },
        { label: 'table', sortText: '16' },
      ],
      'tab',
    ).map(m => m.item.label)
    expect(got[0]).toBe('table')
  })
})

// The `${1:...}` strings below are LSP snippet syntax, not template literals.
/* oxlint-disable no-template-curly-in-string */
describe('stripSnippet', () => {
  test('placeholders keep their text, stops vanish, caret lands on the first stop', () => {
    expect(stripSnippet('foo($1)')).toEqual({ text: 'foo()', caret: 4 })
    expect(stripSnippet('foo(${1:arg})')).toEqual({ text: 'foo(arg)', caret: 4 })
    expect(stripSnippet('${1|red,green|}')).toEqual({ text: 'red', caret: 0 })
    expect(stripSnippet('plain')).toEqual({ text: 'plain', caret: null })
    // A trailing $0 is where the cursor would land anyway.
    expect(stripSnippet('done$0')).toEqual({ text: 'done', caret: null })
  })
})

describe('applyCompletion', () => {
  test('replaces the typed prefix when the item has no textEdit', () => {
    const got = applyCompletion('const x = ma\n', { line: 0, character: 12 }, 10, {
      label: 'map',
    })
    expect(got.content).toBe('const x = map\n')
    expect(got.cursor).toEqual({ line: 0, character: 13 })
  })

  test('honours the server textEdit range', () => {
    const got = applyCompletion('a.me\n', { line: 0, character: 4 }, 2, {
      label: 'method',
      textEdit: {
        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
        newText: 'method',
      },
    })
    expect(got.content).toBe('a.method\n')
    expect(got.cursor).toEqual({ line: 0, character: 8 })
  })

  test('extends a stale textEdit to cover characters typed during the request', () => {
    // Range measured at "con|", cursor has since reached "console|".
    const got = applyCompletion('consol\n', { line: 0, character: 6 }, 0, {
      label: 'console',
      textEdit: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        newText: 'console',
      },
    })
    expect(got.content).toBe('console\n')
  })

  test('applies additionalTextEdits and keeps the cursor on the primary insert', () => {
    const got = applyCompletion('const y = druk\n', { line: 0, character: 14 }, 10, {
      label: 'drukImported',
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'import { drukImported } from "druk"\n',
        },
      ],
    })
    expect(got.content).toBe('import { drukImported } from "druk"\nconst y = drukImported\n')
    expect(got.cursor).toEqual({ line: 1, character: 22 })
  })

  test('snippet inserts land the caret on the first stop', () => {
    const got = applyCompletion('fo\n', { line: 0, character: 2 }, 0, {
      label: 'foo',
      insertText: 'foo(${1:x})',
      insertTextFormat: 2,
    })
    expect(got.content).toBe('foo(x)\n')
    expect(got.cursor).toEqual({ line: 0, character: 4 })
  })

  test('multi-line snippets are re-indented to the line they land on', () => {
    // expert's do/end block, accepted under an indented def: the body must sit
    // one level deeper than the def and the end must line up with it, not
    // land at the absolute columns the server authored.
    const got = applyCompletion('  def name() do\n', { line: 0, character: 15 }, 13, {
      label: 'do/end block',
      textEdit: {
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 15 } },
        newText: 'do\n  $0\nend',
      },
      insertTextFormat: 2,
    })
    expect(got.content).toBe('  def name() do\n    \n  end\n')
    expect(got.cursor).toEqual({ line: 1, character: 4 })
  })

  test('a multi-line insert at column 0 keeps the server text as-is', () => {
    const got = applyCompletion('def name() do\n', { line: 0, character: 13 }, 11, {
      label: 'do/end block',
      textEdit: {
        range: { start: { line: 0, character: 11 }, end: { line: 0, character: 13 } },
        newText: 'do\n  $0\nend',
      },
      insertTextFormat: 2,
    })
    expect(got.content).toBe('def name() do\n  \nend\n')
    expect(got.cursor).toEqual({ line: 1, character: 2 })
  })

  test('a plain-text multi-line insert is not re-indented', () => {
    // Only snippets are re-indented: newlines outside one are the text the
    // server means, so adding the line's indent would corrupt it.
    const got = applyCompletion('    foo\n', { line: 0, character: 7 }, 4, {
      label: 'block',
      insertText: 'a\nb\nc',
      insertTextFormat: 1,
    })
    expect(got.content).toBe('    a\nb\nc\n')
  })
})

describe('plainMarkup', () => {
  test('flattens the marks a doc comment carries', () => {
    expect(
      plainMarkup({
        kind: 'markdown',
        value: '# Title\n\nCalls **now** with `arg`.\n\n```ts\nfn()\n```\n\n- one\n- two',
      }),
    ).toBe('Title\n\nCalls now with arg.\n\nfn()\n\n• one\n• two')
    expect(plainMarkup('plain text')).toBe('plain text')
    expect(plainMarkup(undefined)).toBe('')
  })

  test('itemInfo collapses a multi-line signature and reads both deprecation spellings', () => {
    expect(itemInfo({ label: 'a', detail: '(x: number)\n  => void' }).detail).toBe(
      '(x: number) => void',
    )
    // labelDetails is the fallback: the panel wants a signature either way.
    expect(itemInfo({ label: 'a', labelDetails: { detail: '(x)' } }).detail).toBe('(x)')
    expect(isDeprecated({ label: 'a', tags: [1] })).toBe(true)
    expect(isDeprecated({ label: 'a', deprecated: true })).toBe(true)
    expect(isDeprecated({ label: 'a' })).toBe(false)
  })
})

describe('layoutMenu', () => {
  const many = Array.from({ length: 30 }, (_, at) => ({
    item: { label: `item${at}`, kind: 3 },
    score: 0,
    positions: [],
  }))
  const roomy = { width: 120, height: 40 }

  const info = {
    detail: '(a: number) => void',
    documentation: 'Does a thing.',
    source: '',
    deprecated: false,
  }

  test('caps the list and adds the counter row', () => {
    const layout = layoutMenu(many, null, roomy, false)
    expect(layout.rows).toBe(12)
    // border pair + rows + counter
    expect(layout.height).toBe(15)
    expect(layout.documentation).toEqual([])
  })

  test('the panel holds the resolved lines, and the box never wraps a signature thin', () => {
    const layout = layoutMenu(many, info, roomy, true)
    expect(layout.signature).toEqual([{ text: '(a: number) => void', start: 0 }])
    expect(layout.documentation).toEqual(['Does a thing.'])
    expect(layout.width).toBeGreaterThanOrEqual(56)
  })

  test('a wrapped signature keeps each row offset into the string it was cut from', () => {
    // The panel paints from those offsets: the highlighter parses the signature
    // as one line, and a row of it is a slice of that line's captures.
    const long = 'const draw: <Value extends number>(props: Props<Value>) => Element'
    const layout = layoutMenu(many, { ...info, detail: long }, { width: 40, height: 40 }, true)
    expect(layout.signature.length).toBeGreaterThan(1)
    for (const line of layout.signature) {
      expect(long.slice(line.start, line.start + line.text.length)).toBe(line.text)
    }
  })

  test('the signature grows into the rows the documentation left blank', () => {
    // Capped at three regardless, a generic ended in an ellipsis while the panel
    // drew four blank rows under a one-line doc comment.
    const wordy = { ...info, detail: 'word '.repeat(60).trim() }
    const layout = layoutMenu(many, wordy, roomy, true)
    expect(layout.signature.length).toBe(6)
    expect(layout.signature.at(-1)!.text).not.toContain('…')
    // Long docs win the space back: the signature never starves them.
    const both = layoutMenu(many, { ...wordy, documentation: 'doc. '.repeat(200) }, roomy, true)
    expect(both.signature.length).toBe(3)
    expect(both.documentation.length).toBe(both.panelRows - 3)
  })

  test('the origin only fills a row the panel would have drawn blank', () => {
    const spare = layoutMenu(many, { ...info, source: 'druk/alpha' }, roomy, true)
    expect(spare.origin).toBe('druk/alpha')
    const full = layoutMenu(
      many,
      { ...info, documentation: 'doc. '.repeat(200), source: 'druk/alpha' },
      roomy,
      true,
    )
    expect(full.origin).toBe('')
  })

  test('the box is the same size whatever the selected item resolved to', () => {
    // The size may not follow the selection: walking the list would resize the
    // popup under the cursor on every keystroke.
    const empty = layoutMenu(many, null, roomy, true)
    const filled = layoutMenu(many, info, roomy, true)
    const wordy = layoutMenu(
      many,
      { detail: 'x '.repeat(200), documentation: 'y '.repeat(400), source: '', deprecated: false },
      roomy,
      true,
    )
    expect(empty.height).toBe(filled.height)
    expect(empty.width).toBe(filled.width)
    expect(wordy.height).toBe(filled.height)
    expect(wordy.width).toBe(filled.width)
    expect(empty.panelRows).toBeGreaterThan(0)
  })

  test('a short pane drops the panel before it drops the list', () => {
    const layout = layoutMenu(many, info, { width: 120, height: 6 }, true)
    expect(layout.panelRows).toBe(0)
    expect(layout.signature).toEqual([])
    expect(layout.rows).toBe(3)
    expect(layout.height).toBeLessThanOrEqual(6)
  })

  test('an empty list is the notice row alone', () => {
    expect(layoutMenu([], null, roomy, true)).toMatchObject({ rows: 0, height: 3 })
  })
})

describe('matchRuns', () => {
  test('splits a label into hit and miss runs', () => {
    expect(matchRuns('flatMap', [0, 4, 5, 6])).toEqual([
      { text: 'f', hit: true },
      { text: 'lat', hit: false },
      { text: 'Map', hit: true },
    ])
    expect(matchRuns('plain', [])).toEqual([{ text: 'plain', hit: false }])
  })
})
