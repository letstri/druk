import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FILE_TOKEN, formatArgs, formatterFor, resolveBin, runFormatter } from '../src/core/format'
import { tempDir } from './temp'

/** A command whose script file sees the target path as argv[2], as real ones do. */
function script(code: string): { command: string[]; dir: string } {
  const dir = tempDir('druk-fmt-')
  const file = join(dir, 'tool.js')
  writeFileSync(file, code)
  return { command: [process.execPath, file], dir }
}

describe('formatterFor', () => {
  test('matches the extension in a comma-separated key', () => {
    const formatters = { 'ts,tsx': ['prettier', '--write'] }
    expect(formatterFor('/p/a.ts', formatters)).toEqual(['prettier', '--write'])
    expect(formatterFor('/p/a.tsx', formatters)).toEqual(['prettier', '--write'])
    expect(formatterFor('/p/a.go', formatters)).toBeNull()
  })

  test('matching is case-insensitive and tolerates spaces around commas', () => {
    const formatters = { 'TS, go': ['fmt'] }
    expect(formatterFor('/p/a.ts', formatters)).toEqual(['fmt'])
    expect(formatterFor('/p/A.GO', formatters)).toEqual(['fmt'])
  })

  test('a specific key beats the catch-all, which covers the rest', () => {
    const formatters = { '*': ['generic'], 'go': ['gofmt', '-w'] }
    expect(formatterFor('/p/a.go', formatters)).toEqual(['gofmt', '-w'])
    expect(formatterFor('/p/a.rb', formatters)).toEqual(['generic'])
  })

  test('an empty command disables its entry', () => {
    expect(formatterFor('/p/a.ts', { ts: [] })).toBeNull()
    expect(formatterFor('/p/a.ts', { '*': [] })).toBeNull()
  })

  test('a file with no extension only matches the catch-all', () => {
    expect(formatterFor('/p/Makefile', { '': ['fmt'], 'ts': ['fmt'] })).toBeNull()
    expect(formatterFor('/p/Makefile', { '*': ['generic'] })).toEqual(['generic'])
  })
})

describe('formatArgs', () => {
  test('the path is appended when the command never mentions it', () => {
    expect(formatArgs(['prettier', '--write'], '/p/a.ts')).toEqual(['--write', '/p/a.ts'])
  })

  test('the token puts the path where the tool wants it', () => {
    expect(formatArgs(['stylelint', '--fix', FILE_TOKEN, '--quiet'], '/p/a.css')).toEqual([
      '--fix',
      '/p/a.css',
      '--quiet',
    ])
  })

  test('a token inside an argument is substituted, not just a bare one', () => {
    expect(formatArgs(['tool', `--stdin-filepath=${FILE_TOKEN}`], '/p/a.ts')).toEqual([
      '--stdin-filepath=/p/a.ts',
    ])
  })

  test('every occurrence is replaced', () => {
    expect(formatArgs(['tool', FILE_TOKEN, '-o', FILE_TOKEN], '/p/a.ts')).toEqual([
      '/p/a.ts',
      '-o',
      '/p/a.ts',
    ])
  })

  test('a command of only a program still gets the path', () => {
    expect(formatArgs(['oxfmt'], '/p/a.ts')).toEqual(['/p/a.ts'])
  })
})

/** A project whose `node_modules/.bin` holds an executable `name`. */
function projectWithBin(name: string, code: string): string {
  const dir = tempDir('druk-proj-')
  const bin = join(dir, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  const file = join(bin, name)
  writeFileSync(file, `#!${process.execPath}\n${code}`)
  chmodSync(file, 0o755)
  return dir
}

describe('resolveBin', () => {
  test('the project copy wins over the bare name', () => {
    const dir = projectWithBin('prettier', '')
    expect(resolveBin('prettier', dir)).toBe(join(dir, 'node_modules', '.bin', 'prettier'))
  })

  test('a name the project did not install is left to PATH', () => {
    const dir = tempDir('druk-proj-')
    expect(resolveBin('gofmt', dir)).toBe('gofmt')
  })

  test('a command that spells out a path is left alone', () => {
    const dir = projectWithBin('prettier', '')
    expect(resolveBin('./node_modules/.bin/prettier', dir)).toBe('./node_modules/.bin/prettier')
    expect(resolveBin('/usr/bin/prettier', dir)).toBe('/usr/bin/prettier')
  })
})

describe('runFormatter', () => {
  test('a locally installed formatter runs without being on PATH', async () => {
    const dir = projectWithBin('druk-local-fmt', 'process.exit(0)')
    expect(await runFormatter(['druk-local-fmt'], '/p/a.ts', dir)).toBeNull()
  })

  test('a missing binary reports name and PATH, not a stack', async () => {
    const error = await runFormatter(['druk-no-such-formatter'], '/p/a.ts', '/tmp')
    expect(error).toBe('druk-no-such-formatter is not installed, or not on PATH')
  })

  test('a failing command reports the first stderr line', async () => {
    const { command, dir } = script('console.error("boom\\nmore"); process.exit(2)')
    const error = await runFormatter(command, '/p/a.ts', dir)
    expect(error).toBe('boom')
  })

  test('success resolves null', async () => {
    const { command, dir } = script('process.exit(0)')
    const error = await runFormatter(command, '/p/a.ts', dir)
    expect(error).toBeNull()
  })
})
