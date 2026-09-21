import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  buildIndex,
  INDEX_FILE,
  marketIds,
  readMarket,
} from '../scripts/extensions'
import { builtinExtensions } from '../src/extensions/builtin'

const market = readMarket()

const rgb = (hex: string) =>
  [0, 2, 4].map((i) =>
    Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16)
  )

const themes = market.flatMap((extension) =>
  extension.themes.map((entry) => ({ ...entry, from: extension.id }))
)

test('every manifest in the market is one druk can use', () => {
  expect(market.map((extension) => extension.id)).toEqual(marketIds())
  expect(market.every((extension) => extension.version !== '0.0.0')).toBe(true)
  expect(market.every((extension) => extension.description.length > 0)).toBe(
    true
  )
})

test('the committed index is what the generator writes', () => {
  // Fails when the index is stale. Compared parsed, not as text: the formatter owns whitespace.
  expect(JSON.parse(readFileSync(INDEX_FILE, 'utf-8'))).toEqual(buildIndex())
})

test('no two extensions claim the same id', () => {
  const claimed = [
    ...themes.map((theme) => `theme:${theme.id}`),
    ...market.flatMap((extension) =>
      extension.icons.map((icons) => `icons:${icons.id}`)
    ),
    ...market.flatMap((extension) =>
      extension.servers.map((server) => `server:${server.id}`)
    ),
    ...market.flatMap((extension) =>
      extension.languages.map((language) => `lang:${language.id}`)
    ),
  ]
  expect(new Set(claimed).size).toBe(claimed.length)
})

test('an extension is about a language or about how the editor looks, never both', () => {
  for (const extension of market) {
    const appearance = extension.themes.length + extension.icons.length > 0
    const language = extension.languages.length + extension.servers.length > 0
    expect(`${extension.id}:${appearance && language}`).toBe(
      `${extension.id}:false`
    )
  }
})

test('every language has something to highlight with, and a way to be reached', () => {
  for (const extension of market) {
    for (const language of extension.languages) {
      const usable =
        language.bundled ||
        (language.wasm && language.query) ||
        language.patterns
      expect(`${language.id}:${usable ? 'ok' : 'unusable'}`).toBe(
        `${language.id}:ok`
      )
      if (language.wasm) {
        expect(language.wasm.startsWith('/')).toBe(true)
      }
    }
    expect(extension.assets).toEqual([])
  }
})

test('what ships in the binary is the market folder, and needs no files beside it', () => {
  const shipped = builtinExtensions()
  const ids = new Set(market.map((extension) => extension.id))
  for (const extension of shipped) {
    expect(`${extension.id} in the market: ${ids.has(extension.id)}`).toBe(
      `${extension.id} in the market: true`
    )
    expect(extension.assets).toEqual([])
    expect(extension.builtin).toBe(true)
  }
  const languages = new Set(
    shipped.flatMap((extension) => extension.languages.map((l) => l.id))
  )
  for (const id of [
    'typescript',
    'javascript',
    'typescriptreact',
    'json',
    'markdown',
    'css',
    'dotenv',
  ]) {
    expect(`${id}:${languages.has(id)}`).toBe(`${id}:true`)
  }
})

test('every market theme tints the current line instead of filling it', () => {
  for (const theme of themes) {
    const [bg, line] = [rgb(theme.theme.ui.bg), rgb(theme.theme.ui.currentLine)]
    const delta = Math.max(...bg.map((value, i) => Math.abs(value - line[i]!)))
    expect(`${theme.id}:${delta > 0 && delta <= 20}`).toBe(`${theme.id}:true`)
  }
})

test('indent guides are visible in every market theme', () => {
  for (const theme of themes) {
    const [bg, guide] = [
      rgb(theme.theme.ui.bg),
      rgb(theme.theme.ui.indentGuide),
    ]
    const delta = Math.max(...bg.map((value, i) => Math.abs(value - guide[i]!)))
    expect(`${theme.id}:${delta >= 6}`).toBe(`${theme.id}:true`)
  }
})

test('every market theme colours the groups a file actually uses', () => {
  for (const theme of themes) {
    for (const group of ['comment', 'string', 'keyword', 'function', 'type']) {
      expect(`${theme.id}/${group}`).toBe(
        theme.theme.syntax[group]
          ? `${theme.id}/${group}`
          : `${theme.id}/${group} missing`
      )
    }
  }
})

test('every market icon glyph survives parsing and is one cell wide', () => {
  for (const extension of market) {
    for (const icons of extension.icons) {
      const raw = JSON.parse(readFileSync(extension.source, 'utf-8')) as {
        icons: Record<
          'extensions' | 'names' | 'folders',
          Record<string, unknown> | undefined
        >[]
      }
      const declared = raw.icons[0]!
      for (const map of ['extensions', 'names', 'folders'] as const) {
        expect(`${icons.id}/${map}:${Object.keys(icons[map]).length}`).toBe(
          `${icons.id}/${map}:${Object.keys(declared[map] ?? {}).length}`
        )
      }
      for (const entry of [
        icons.file,
        icons.folder,
        icons.folderOpen,
        ...Object.values(icons.extensions),
        ...Object.values(icons.names),
        ...Object.values(icons.folders),
        ...Object.values(icons.foldersOpen),
      ]) {
        expect([...entry.glyph]).toHaveLength(1)
      }
    }
  }
})

test('the material set has an icon for the files a project is made of', () => {
  const icons = market.find((extension) => extension.id === 'material-icons')!
    .icons[0]!
  for (const [name, color] of [
    ['a.ts', '#0288d1'],
    ['a.tsx', '#0288d1'],
    ['a.rs', '#ff7043'],
    ['a.go', '#00acc1'],
    ['a.py', '#0288d1'],
    ['package.json', '#8bc34a'],
    ['.gitignore', '#e64a19'],
    ['dockerfile', '#0288d1'],
  ] as const) {
    const entry = name.includes('.')
      ? (icons.names[name] ?? icons.extensions[name.split('.').pop()!])
      : icons.names[name]
    expect(`${name}:${entry?.color}`).toBe(`${name}:${color}`)
  }
  for (const folder of ['src', 'test', 'dist', 'node_modules', 'github']) {
    expect(
      `${folder}:${folder in icons.folders && folder in icons.foldersOpen}`
    ).toBe(`${folder}:true`)
  }
})

test('the languages druk used to serve are all still one install away', () => {
  const served = new Set(
    market.flatMap((p) => p.servers.flatMap((server) => server.filetypes))
  )
  for (const filetype of [
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'go',
    'rust',
    'python',
    'c',
    'cpp',
    'zig',
    'lua',
    'bash',
    'ruby',
    'php',
    'swift',
    'css',
    'html',
    'json',
  ]) {
    expect(`${filetype}:${served.has(filetype)}`).toBe(`${filetype}:true`)
  }
})
