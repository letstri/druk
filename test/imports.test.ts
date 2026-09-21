import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { hasPathAt, pathTokenAt, resolveImportPath } from '../src/core/imports'
import { normalizeDefinition } from '../src/lsp/definition'
import { fixture } from './helpers'

describe('the token under the cursor', () => {
  test('a quoted specifier wins wherever in it the cursor sits', () => {
    const line = "import { a } from './core/fs'"
    for (const col of [19, 22, 28]) {
      expect(pathTokenAt(line, col)).toBe('./core/fs')
    }
    expect(pathTokenAt(line, 18)).toBe('./core/fs')
  })

  test('an unquoted path is read out of prose', () => {
    const line = 'see src/core/fs.ts for the guard.'
    expect(pathTokenAt(line, 8)).toBe('src/core/fs.ts')
    expect(pathTokenAt('read src/app/lsp.ts.', 12)).toBe('src/app/lsp.ts')
  })

  test('nothing under the cursor is nothing', () => {
    expect(pathTokenAt('   ', 1)).toBeNull()
    expect(pathTokenAt('', 0)).toBeNull()
  })
})

describe('whether the footer offers to follow it', () => {
  test('a bare specifier counts on an import line, a plain string does not', () => {
    expect(hasPathAt("import { a } from 'bun'", 20)).toBe(true)
    expect(hasPathAt("say('warn')", 6)).toBe(false)
  })

  test('a path counts wherever it sits, a word never does', () => {
    expect(hasPathAt('see src/core/fs.ts for the guard.', 8)).toBe(true)
    expect(hasPathAt('const a = 1', 2)).toBe(false)
    expect(hasPathAt("import { a } from 'bun'", 2)).toBe(false)
  })
})

describe('where a specifier resolves', () => {
  const project = () =>
    fixture({
      'notes.md': 'see src/a.ts\n',
      'src/a.ts': 'export const a = 1\n',
      'src/deep/index.ts': 'export const deep = 3\n',
      'src/lib/index.ts': 'export const lib = 4\n',
      'src/nested/b.tsx': 'export const b = 2\n',
      'tsconfig.json': `{
        // A comment and a trailing comma: what a real tsconfig holds.
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "@/*": ["src/*"], "~lib": ["src/lib/index.ts"], },
        },
      }`,
    })

  test('relative, extensionless and index specifiers', () => {
    const root = project()
    const from = join(root, 'src')
    expect(resolveImportPath('./nested/b', from, root)).toBe(
      join(root, 'src/nested/b.tsx')
    )
    expect(resolveImportPath('./a.ts', from, root)).toBe(join(root, 'src/a.ts'))
    expect(resolveImportPath('../src/deep', from, root)).toBe(
      join(root, 'src/deep/index.ts')
    )
    expect(resolveImportPath('./missing', from, root)).toBeNull()
  })

  test('a path written against the project root', () => {
    const root = project()
    expect(resolveImportPath('src/a.ts', root, root)).toBe(
      join(root, 'src/a.ts')
    )
  })

  test('tsconfig aliases, comments and trailing commas included', () => {
    const root = project()
    const from = join(root, 'src/nested')
    expect(resolveImportPath('@/a', from, root)).toBe(join(root, 'src/a.ts'))
    expect(resolveImportPath('@/deep', from, root)).toBe(
      join(root, 'src/deep/index.ts')
    )
    expect(resolveImportPath('~lib', from, root)).toBe(
      join(root, 'src/lib/index.ts')
    )
    expect(resolveImportPath('src/nested/b', from, root)).toBe(
      join(root, 'src/nested/b.tsx')
    )
    expect(resolveImportPath('@/nope', from, root)).toBeNull()
  })

  test('an alias declared in an extended config still resolves', () => {
    const root = fixture({
      'lib/thing.ts': 'export const thing = 1\n',
      'tsconfig.base.json':
        '{ "compilerOptions": { "paths": { "#/*": ["./lib/*"] } } }',
      'tsconfig.json': '{ "extends": "./tsconfig.base" }',
    })
    expect(resolveImportPath('#/thing', root, root)).toBe(
      join(root, 'lib/thing.ts')
    )
  })

  test('what is not a file on disk', () => {
    const root = project()
    expect(resolveImportPath('https://example.com/x.ts', root, root)).toBeNull()
    expect(resolveImportPath('solid-js', root, root)).toBeNull()
    expect(resolveImportPath('   ', root, root)).toBeNull()
  })
})

describe('a definition reply', () => {
  const uri = 'file:///tmp/druk/def.ts'
  const range = {
    end: { character: 9, line: 3 },
    start: { character: 5, line: 3 },
  }

  test('every shape the spec allows becomes one target', () => {
    const target = { col: 5, line: 3, path: '/tmp/druk/def.ts' }
    expect(normalizeDefinition({ range, uri })).toEqual(target)
    expect(normalizeDefinition([{ range, uri }])).toEqual(target)
    expect(
      normalizeDefinition([
        { targetRange: range, targetSelectionRange: range, targetUri: uri },
      ])
    ).toEqual(target)
  })

  test('the selection range wins over the declaration range', () => {
    const declaration = {
      end: { character: 1, line: 6 },
      start: { character: 0, line: 1 },
    }
    expect(
      normalizeDefinition([
        {
          targetRange: declaration,
          targetSelectionRange: range,
          targetUri: uri,
        },
      ])
    ).toEqual({ col: 5, line: 3, path: '/tmp/druk/def.ts' })
  })

  test('nothing, an empty answer, and a scheme that is not a file', () => {
    expect(normalizeDefinition(null)).toBeNull()
    expect(normalizeDefinition([])).toBeNull()
    expect(
      normalizeDefinition({ range, uri: 'jdt://contents/rt.jar' })
    ).toBeNull()
    expect(normalizeDefinition({ range })).toBeNull()
  })
})
