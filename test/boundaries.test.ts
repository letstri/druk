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
