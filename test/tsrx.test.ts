import { describe, expect, test } from 'bun:test'

import { filetypeForPath, getSyntaxStyle } from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { allSegments } from './syntax'

// tsrx is a market extension, not one of the preinstalled languages.
loadMarketExtensions()

/** What each group got painted on, so a pattern change shows up as text. */
async function painted(source: string) {
  const segments = await allSegments(source, 'tsrx')
  const lines = source.split('\n')
  const style = getSyntaxStyle()
  const byGroup = new Map<number, string[]>()
  for (const segment of segments) {
    const text = lines[segment.line]?.slice(segment.start, segment.end) ?? ''
    if (!text.trim()) continue
    byGroup.set(segment.styleId, [...(byGroup.get(segment.styleId) ?? []), text.trim()])
  }
  return (group: string) => byGroup.get(style.getStyleId(group)!) ?? []
}

describe('recognising tsrx files', () => {
  test('by extension, wherever the file sits', () => {
    expect(filetypeForPath('App.tsrx')).toBe('tsrx')
    expect(filetypeForPath('src/routes/App.lynx.tsrx')).toBe('tsrx')
  })

  test('without stealing files that merely contain the letters', () => {
    expect(filetypeForPath('tsrx.d.ts')).toBe('typescript')
    expect(filetypeForPath('notatsrx')).toBeUndefined()
  })
})

describe('painting tsrx files', () => {
  // Octane indents with tabs, as every file in its repo does.
  const SAMPLE = `import { use } from 'octane';

// Prose naming @for and @try and @{ stays prose.
export function App(props: { rows: Row[]; step: string }) @{
\tconst total = props.rows.length;

\t<main class="feed">
\t\t@if (total > 0) {
\t\t\t<p>{'have' as string}</p>
\t\t} @else {
\t\t\t<p>none</p>
\t\t}
\t\t@for (const r of props.rows; key r.id) {
\t\t\t<li>{r.label as string}</li>
\t\t} @empty {
\t\t\t<li>blank</li>
\t\t}
\t\t@switch (props.step) {
\t\t\t@case 'one': {
\t\t\t\t<span>1</span>
\t\t\t}
\t\t\t@default: {
\t\t\t\t<span>x</span>
\t\t\t}
\t\t}
\t\t@try {
\t\t\t<output>{use(thing) as string}</output>
\t\t} @pending {
\t\t\t<p>wait</p>
\t\t} @catch (err, reset) {
\t\t\t<button onClick={reset}>x</button>
\t\t}
\t</main>
}
`

  // A grammar that names a node it does not have matches nothing, silently. The
  // whole point of the tsx grammar here is that everything inside `@{ … }` keeps
  // highlighting, so assert the ordinary tsx tokens as well as the directives.
  test('the body inside @{ … } highlights as ordinary tsx', async () => {
    const group = await painted(SAMPLE)

    expect(group('keyword')).toContain('import')
    expect(group('keyword')).toContain('const')
    expect(group('string')).toContain(`'octane'`)
    expect(group('tag')).toContain('<main')
    expect(group('attribute')).toContain('class')
    expect(group('type')).toContain('string')
  })

  for (const directive of [
    '@if',
    '@else',
    '@for',
    '@empty',
    '@switch',
    '@case',
    '@default',
    '@try',
    '@pending',
    '@catch',
  ]) {
    test(`${directive} reads as a keyword`, async () => {
      const group = await painted(SAMPLE)
      expect(group('keyword')).toContain(directive)
    })
  }

  test('the @ of the body marker, and key, are keywords too', async () => {
    const group = await painted(SAMPLE)
    // `{` belongs to the grammar as a bracket; only the `@` is ours.
    expect(group('keyword')).toContain('@')
    expect(group('keyword')).toContain('key')
  })

  test('a directive named in a comment stays a comment', async () => {
    const group = await painted(SAMPLE)
    // The overlay is regex-driven and cannot tell prose from code by itself. Left
    // to specificity alone, `keyword.directive` outranks `comment` and lights up
    // every mention of a directive in a doc comment. Asserting the line survives
    // *whole* is what catches that: lighting `@for` inside it splits the comment
    // into fragments, and the same directive really does appear in the code below,
    // so no assertion about the keyword group alone can tell the two apart.
    expect(group('comment')).toContain('// Prose naming @for and @try and @{ stays prose.')
  })

  test('a directive named in a string stays a string', async () => {
    const group = await painted(`const help = '@if needs a block';\n`)

    expect(group('keyword')).not.toContain('@if')
    expect(group('string')).toContain(`'@if needs a block'`)
  })

  test('key is only the @for clause, not any identifier after a semicolon', async () => {
    const group = await painted(
      `export function A() @{\n\tlet x = 1;\n\n\tkey = 2;\n\t<p>x</p>\n}\n`,
    )

    expect(group('keyword')).not.toContain('key')
  })

  test('key in an ordinary statement on one line stays plain', async () => {
    // `; key` is exactly how the clause sits in a `@for` header, so the pattern
    // needs the `key <expr>)` shape to tell the two apart.
    const group = await painted(
      `export function A() @{\n\trun(); key.press(); key = 2;\n\t@for (const r of rows; key r.id) {\n\t\t<li>{r.id}</li>\n\t}\n}\n`,
    )

    expect(group('keyword').filter(t => t === 'key')).toEqual(['key'])
  })
})
