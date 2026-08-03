import { describe, expect, test } from 'bun:test'

import { commentPrefix } from '../src/languages'
import { filetypeForPath, getSyntaxStyle } from '../src/languages/highlight'
import { resolveServer } from '../src/lsp/servers'
import { allSegments } from './syntax'

describe('recognising jsonc files', () => {
  test('by extension, and without stealing plain json', () => {
    expect(filetypeForPath('wrangler.jsonc')).toBe('jsonc')
    expect(filetypeForPath('app/tsconfig.jsonc')).toBe('jsonc')
    expect(filetypeForPath('package.json')).toBe('json')
    expect(filetypeForPath('bun.lock')).toBe('json')
  })

  test('with a comment prefix json itself has no business having', () => {
    expect(commentPrefix('jsonc')).toBe('//')
    expect(commentPrefix('json')).toBeUndefined()
  })
})

describe('painting jsonc', () => {
  const SAMPLE = `{
  // a line comment
  /* and a block one */
  "port": 8080
}
`

  test('comments are comments, not errors', async () => {
    const style = getSyntaxStyle()
    const segments = await allSegments(SAMPLE, 'jsonc')
    const commented = (line: number) =>
      segments
        .filter(segment => segment.line === line && segment.styleId === style.getStyleId('comment'))
        .map(segment => SAMPLE.split('\n')[line]?.slice(segment.start, segment.end))
    expect(commented(1)).toEqual(['// a line comment'])
    expect(commented(2)).toEqual(['/* and a block one */'])
    // The whole point: a comment must not be parsed as a broken value.
    expect(segments.some(segment => segment.styleId === style.getStyleId('error'))).toBe(false)
  })
})

test('the json server serves jsonc too', () => {
  // Same process, but the languageId druk sends is the filetype — which is what
  // tells vscode-json-language-server to allow the comments rather than flag them.
  expect(resolveServer('jsonc', {})?.command).toEqual(resolveServer('json', {})!.command)
})
