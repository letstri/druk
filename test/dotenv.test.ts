import { describe, expect, test } from 'bun:test'

import { filetypeForPath, getSyntaxStyle } from '../src/languages/highlight'
import { allSegments } from './syntax'

async function painted(source: string) {
  const segments = await allSegments(source, 'dotenv')
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

describe('recognising env files', () => {
  test('by name, wherever the name appears', () => {
    expect(filetypeForPath('.env')).toBe('dotenv')
    expect(filetypeForPath('.env.local')).toBe('dotenv')
    expect(filetypeForPath('.env.production')).toBe('dotenv')
    expect(filetypeForPath('app/config/.env.test')).toBe('dotenv')
    expect(filetypeForPath('staging.env')).toBe('dotenv')
  })

  test('without stealing files that merely start with env', () => {
    expect(filetypeForPath('envoy.ts')).toBe('typescript')
    expect(filetypeForPath('environment.md')).toBe('markdown')
    expect(filetypeForPath('a.ts')).toBe('typescript')
  })
})

describe('files named after what they are', () => {
  test('bun.lock is jsonc, wherever it sits', () => {
    expect(filetypeForPath('bun.lock')).toBe('jsonc')
    expect(filetypeForPath('packages/api/bun.lock')).toBe('jsonc')
  })

  test('and only that name', () => {
    expect(filetypeForPath('bun.lockb')).toBeUndefined()
    expect(filetypeForPath('my-bun.lock')).toBeUndefined()
  })
})

describe('painting env files', () => {
  const SAMPLE = `# a comment
export API_URL="https://example.dev"
PORT=3000
DEBUG=true
GREETING=hello $USER \${HOME}
EMPTY=
`

  test('keys, values and comments each read differently', async () => {
    const group = await painted(SAMPLE)

    expect(group('comment')).toContain('# a comment')
    expect(group('property')).toContain('API_URL')
    expect(group('property')).toContain('PORT')
    expect(group('string')).toContain('"https://example.dev"')
    expect(group('number')).toContain('3000')
    expect(group('boolean')).toContain('true')
    expect(group('punctuation')).toContain('=')
  })

  test('export stays a keyword rather than part of the key', async () => {
    const group = await painted(SAMPLE)
    expect(group('keyword')).toContain('export')
  })

  test('interpolation is lit, in both spellings', async () => {
    const group = await painted(SAMPLE)
    expect(group('variable')).toContain('$USER')
    // Split so the linter does not read a literal `${` as a botched template.
    expect(group('variable')).toContain(`$${'{HOME}'}`)
  })

  test('a # inside a value does not grey out the rest of the line', async () => {
    const group = await painted('SECRET=abc#123\nPORT=8080\n')

    expect(group('comment')).toEqual([])
    expect(group('number')).toContain('8080')
  })
})
