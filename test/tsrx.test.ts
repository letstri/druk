import { describe, expect, test } from 'bun:test'

import { filetypeForPath } from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { painted } from './syntax'

loadMarketExtensions()

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

  // A grammar that names a node it does not have matches nothing, silently.
  test('the body inside @{ … } highlights as ordinary tsx', async () => {
    const group = await painted(SAMPLE, 'tsrx')

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
      const group = await painted(SAMPLE, 'tsrx')
      expect(group('keyword')).toContain(directive)
    })
  }

  test('the @ of the body marker, and key, are keywords too', async () => {
    const group = await painted(SAMPLE, 'tsrx')
    expect(group('keyword')).toContain('@')
    expect(group('keyword')).toContain('key')
  })

  test('a directive named in a comment stays a comment', async () => {
    const group = await painted(SAMPLE, 'tsrx')
    expect(group('comment')).toContain(
      '// Prose naming @for and @try and @{ stays prose.'
    )
  })

  test('a directive named in a string stays a string', async () => {
    const group = await painted(`const help = '@if needs a block';\n`, 'tsrx')

    expect(group('keyword')).not.toContain('@if')
    expect(group('string')).toContain(`'@if needs a block'`)
  })

  test('key is only the @for clause, not any identifier after a semicolon', async () => {
    const group = await painted(
      `export function A() @{\n\tlet x = 1;\n\n\tkey = 2;\n\t<p>x</p>\n}\n`,
      'tsrx'
    )

    expect(group('keyword')).not.toContain('key')
  })

  test('key in an ordinary statement on one line stays plain', async () => {
    const group = await painted(
      `export function A() @{\n\trun(); key.press(); key = 2;\n\t@for (const r of rows; key r.id) {\n\t\t<li>{r.id}</li>\n\t}\n}\n`,
      'tsrx'
    )

    expect(group('keyword').filter((t) => t === 'key')).toEqual(['key'])
  })
})
