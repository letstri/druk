import { describe, expect, test } from 'bun:test'

import { commentPrefix } from '../src/languages'
import { filetypeForPath, getSyntaxStyle } from '../src/languages/highlight'
import { resolveServer } from '../src/lsp/servers'
import { allSegments } from './syntax'

describe('recognising jsonc files', () => {
  test('by extension, and without stealing plain json', () => {
    expect(filetypeForPath('wrangler.jsonc')).toBe('jsonc')
    expect(filetypeForPath('app/tsconfig.jsonc')).toBe('jsonc')
    expect(filetypeForPath('bun.lock')).toBe('jsonc')
    expect(filetypeForPath('package.json')).toBe('json')
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
        .filter(
          (segment) =>
            segment.line === line &&
            segment.styleId === style.getStyleId('comment')
        )
        .map((segment) =>
          SAMPLE.split('\n')[line]?.slice(segment.start, segment.end)
        )
    expect(commented(1)).toEqual(['// a line comment'])
    expect(commented(2)).toEqual(['/* and a block one */'])
    expect(
      segments.some((segment) => segment.styleId === style.getStyleId('error'))
    ).toBe(false)
  })
})

test('the json server serves jsonc too', () => {
  expect(resolveServer('jsonc', {})?.command).toEqual(
    resolveServer('json', {})!.command
  )
})

test('bun.lock is excused its trailing commas by schema, not languageId', () => {
  // `validate.enable` must ride along in every settings push: the server resets it otherwise.
  const settings = resolveServer('json', {})?.settings as {
    json: {
      validate: { enable: boolean }
      schemas: { fileMatch: string[]; schema: Record<string, boolean> }[]
    }
  }
  expect(settings.json.validate.enable).toBe(true)
  const lockfile = settings.json.schemas.find((entry) =>
    entry.fileMatch.includes('bun.lock')
  )
  expect(lockfile?.schema).toEqual({
    allowComments: true,
    allowTrailingCommas: true,
  })
})
