import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', 'src')

/** Folders that must never import from app/ — the one-way dependency rule. */
const FEATURE_FOLDERS = [
  'ui',
  'core',
  'languages',
  'themes',
  'editor',
  'lsp',
  'extensions',
  'icons',
]

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.tsx?$/.test(name)) yield path
  }
}

test('ui/ and the feature folders never import from app/', () => {
  const offenders: string[] = []
  for (const folder of FEATURE_FOLDERS) {
    for (const file of walk(join(SRC, folder))) {
      const source = readFileSync(file, 'utf8')
      for (const [line, text] of source.split('\n').entries()) {
        if (/from '[^']*\/app\//.test(text)) offenders.push(`${file}:${line + 1}: ${text.trim()}`)
      }
    }
  }
  expect(offenders).toEqual([])
})

/**
 * A raw `mkdtempSync` is invisible to the sweep in `test/setup.ts` and leaks for
 * good: the git helpers each made one and left tens of thousands of directories
 * behind, until `mkdtemp` in that folder slowed down and files began failing with
 * `ENOENT` on their own fixtures.
 */
test('tests take their temp directories from tempDir()', () => {
  const dir = import.meta.dir
  const offenders: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'temp.ts' || !/\.tsx?$/.test(name)) continue
    const source = readFileSync(join(dir, name), 'utf8')
    for (const [line, text] of source.split('\n').entries()) {
      if (/\bmkdtempSync\s*\(/.test(text)) offenders.push(`${name}:${line + 1}: ${text.trim()}`)
    }
  }
  expect(offenders).toEqual([])
})
