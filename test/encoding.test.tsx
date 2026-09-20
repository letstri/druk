import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeText, encodeText } from '../src/core/fs'
import { fixture, launch, openFile, press } from './helpers'
import type { Harness } from './helpers'

const save = (t: Harness) => press(t, i => i.pressKey('s', { ctrl: true }))
// Node keeps a leading BOM as `\uFEFF` here, so the whole spelling is assertable.
const onDisk = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8')

describe('decoding a file into a buffer', () => {
  test('CRLF comes off and goes back on', () => {
    const { text, encoding } = decodeText('line1\r\nline2\r\n')
    expect(text).toBe('line1\nline2\n')
    expect(encoding).toEqual({ eol: '\r\n', bom: false })
    expect(encodeText(text, encoding)).toBe('line1\r\nline2\r\n')
  })

  test('a BOM comes off and goes back on', () => {
    const { text, encoding } = decodeText('\uFEFFclass A { }\n')
    expect(text).toBe('class A { }\n')
    expect(encoding).toEqual({ eol: '\n', bom: true })
    expect(encodeText(text, encoding)).toBe('\uFEFFclass A { }\n')
  })

  test('an LF file is left alone', () => {
    const { text, encoding } = decodeText('a\nb\n')
    expect(text).toBe('a\nb\n')
    expect(encoding).toEqual({ eol: '\n', bom: false })
    expect(encodeText(text, encoding)).toBe('a\nb\n')
  })

  test('a mixed file takes the majority ending', () => {
    expect(decodeText('a\nb\nc\r\n').encoding.eol).toBe('\n')
    expect(decodeText('a\r\nb\r\nc\n').encoding.eol).toBe('\r\n')
  })

  test('text that already carries CRLF is not written back doubled', () => {
    expect(encodeText('a\r\nb', { eol: '\r\n', bom: false })).toBe('a\r\nb')
    expect(encodeText('a\r\nb', { eol: '\n', bom: false })).toBe('a\nb')
  })
})

describe('opening a file druk has to normalize', () => {
  test('a CRLF file is not dirty on open, and saving keeps its endings', async () => {
    const dir = fixture({ 'crlf.ts': 'const a = 1\r\nconst b = 2\r\n' })
    const t = await launch(dir)
    await openFile(t, 'crlf.ts')

    expect(t.captureCharFrame()).toContain('const a = 1')
    expect(t.captureCharFrame()).toContain('×')
    expect(t.captureCharFrame()).not.toContain('●')

    await save(t)
    expect(onDisk(dir, 'crlf.ts')).toBe('const a = 1\r\nconst b = 2\r\n')
  })

  test('editing one marks it dirty and writes the new text CRLF too', async () => {
    const dir = fixture({ 'crlf.ts': 'const a = 1\r\n' })
    const t = await launch(dir)
    await openFile(t, 'crlf.ts')
    await press(t, i => void i.typeText('X'))

    expect(t.captureCharFrame()).toContain('●')

    await save(t)
    expect(onDisk(dir, 'crlf.ts')).toBe('Xconst a = 1\r\n')
  })

  test('a BOM file is not dirty on open, and saving keeps the BOM', async () => {
    const dir = fixture({ 'bom.ts': '\uFEFFclass A {}\n' })
    const t = await launch(dir)
    await openFile(t, 'bom.ts')

    expect(t.captureCharFrame()).not.toContain('●')

    await save(t)
    expect(onDisk(dir, 'bom.ts')).toBe('\uFEFFclass A {}\n')
  })
})
