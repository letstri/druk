// `fetch` is stubbed for the whole file: `core/market.ts` reads the global at call time.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG_FILE } from '../src/core/config'
import { loadExtensions, EXTENSIONS_DIR } from '../src/extensions'
import { THEMES } from '../src/themes'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

const GO_EXTENSION = {
  id: 'go',
  name: 'Go',
  version: '1.1.0',
  description: 'gopls, the Go language server',
  languageServers: [{ id: 'go', command: ['druk-no-such-gopls'], filetypes: ['go'] }],
}

const GOLINT_EXTENSION = {
  id: 'golint',
  name: 'GoLint',
  version: '1.0.0',
  description: 'lint diagnostics beside whatever server is serving the file',
  languageServers: [{ id: 'golint', command: ['druk-no-such-golint'], filetypes: ['go'] }],
}

const NIM_EXTENSION = {
  id: 'nim',
  name: 'Nim',
  version: '1.0.0',
  description: 'Nim highlighting',
  languages: [
    {
      id: 'nim',
      lineComment: '#',
      extensions: ['.nim'],
      patterns: [{ group: 'keyword', re: '\\b(?:proc|let|var)\\b', flags: 'g' }],
    },
  ],
}

const paint = (color: string) =>
  Object.fromEntries(Object.keys(THEMES.dark.ui).map(key => [key, color]))

const theme = (id: string, name: string) => ({
  id,
  name,
  ui: paint('#101010'),
  syntax: { keyword: { fg: '#ffc799' } },
})

const VESPER_EXTENSION = {
  id: 'vesper',
  name: 'Vesper',
  version: '1.0.0',
  description: 'a dark palette',
  themes: [theme('vesper', 'Vesper')],
}

const CATPPUCCIN_EXTENSION = {
  id: 'catppuccin',
  name: 'Catppuccin',
  version: '1.0.0',
  description: 'four flavors',
  themes: [
    theme('catppuccin-mocha', 'Catppuccin Mocha'),
    theme('catppuccin-latte', 'Catppuccin Latte'),
  ],
  icons: [{ id: 'catppuccin-icons', name: 'Catppuccin Icons', file: '·' }],
}

const INDEX = {
  extensions: [
    {
      id: 'go',
      name: 'Go',
      version: '1.1.0',
      description: 'gopls, the Go language server',
      provides: { themes: [], icons: [], filetypes: ['go'] },
    },
    {
      id: 'nim',
      name: 'Nim',
      version: '1.0.0',
      description: 'Nim highlighting',
      provides: { themes: [], icons: [], filetypes: ['nim'], extensions: ['.nim'] },
    },
  ],
}

const THEME_INDEX = {
  extensions: [
    {
      id: 'vesper',
      name: 'Vesper',
      version: '1.0.0',
      description: 'a dark palette',
      provides: { themes: ['vesper'], icons: [], filetypes: [] },
    },
    {
      id: 'catppuccin',
      name: 'Catppuccin',
      version: '1.0.0',
      description: 'four flavors',
      provides: {
        themes: ['catppuccin-mocha', 'catppuccin-latte'],
        icons: ['catppuccin-icons'],
        filetypes: [],
      },
    },
  ],
}

const realFetch = globalThis.fetch
let requested: string[] = []
let catalog: unknown = INDEX

beforeEach(() => {
  requested = []
  catalog = INDEX
  globalThis.fetch = ((url: string) => {
    requested.push(String(url))
    const manifests: Record<string, unknown> = {
      go: GO_EXTENSION,
      golint: GOLINT_EXTENSION,
      nim: NIM_EXTENSION,
      vesper: VESPER_EXTENSION,
      catppuccin: CATPPUCCIN_EXTENSION,
    }
    const served = Object.entries(manifests).find(([id]) =>
      String(url).endsWith(`${id}/extension.json`),
    )
    const body = String(url).endsWith('index.json') ? catalog : (served?.[1] ?? null)
    return Promise.resolve(
      body ? new Response(JSON.stringify(body)) : new Response('no', { status: 404 }),
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  rmSync(join(process.env.XDG_CACHE_HOME!, 'druk', 'market.json'), { force: true })
  // The registries are module state; an extension left registered leaks into the next test.
  loadExtensions(process.env.XDG_CONFIG_HOME!)
})

function install(manifest: unknown, id = 'go') {
  mkdirSync(join(EXTENSIONS_DIR, id), { recursive: true })
  writeFileSync(join(EXTENSIONS_DIR, id, 'extension.json'), JSON.stringify(manifest))
}

test('a file whose language has no server offers the extension, and installs it', async () => {
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')

  await untilFrame(t, 'No language server')
  const frame = t.captureCharFrame()
  expect(frame).toContain('druk-no-such-gopls')
  expect(frame).toContain('Extension available')

  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'druk-no-such-gopls is not installed, or not on PATH')
  expect(JSON.parse(readFileSync(join(EXTENSIONS_DIR, 'go', 'extension.json'), 'utf8'))).toEqual(
    GO_EXTENSION,
  )
})

test('a linter serving the language is not the extension offered for it', async () => {
  catalog = {
    extensions: [
      {
        id: 'golint',
        name: 'GoLint',
        version: '1.0.0',
        description: 'lint diagnostics beside whatever server is serving the file',
        provides: { themes: [], icons: [], filetypes: ['go'] },
        categories: ['lsp'],
      },
      { ...INDEX.extensions[0], categories: ['language', 'lsp'] },
    ],
  }
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')

  await untilFrame(t, 'No language server')
  expect(t.captureCharFrame()).toContain('Install Go?')
})

test('a file no installed extension can name is matched by its extension', async () => {
  const dir = fixture({ 'main.nim': 'proc main() = discard\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.nim')

  await untilFrame(t, 'No language server for .nim')
  expect(t.captureCharFrame()).toContain('Install Nim?')
})

test('a linter serving the file alone still offers the language', async () => {
  install(GOLINT_EXTENSION, 'golint')
  const dir = fixture({ 'main.go': 'package main\n' })
  loadExtensions(dir)
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')

  await untilFrame(t, 'No language server for go')
  expect(t.captureCharFrame()).toContain('Install Go?')
})

test('a catalog that arrives later still gets the question', async () => {
  catalog = null
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')
  await settle(t, 200)
  expect(t.captureCharFrame()).not.toContain('No language server')

  catalog = INDEX
  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market')
  await press(t, input => void input.typeText('x'))
  await untilFrame(t, 'No language server for go')
})

test('a server the user turned off raises no offer', async () => {
  catalog = {
    extensions: [
      {
        id: 'golint',
        name: 'GoLint',
        version: '1.0.0',
        description: 'lint diagnostics',
        provides: { themes: [], icons: [], filetypes: ['go'] },
        categories: ['lsp'],
      },
    ],
  }
  install(GO_EXTENSION)
  const dir = fixture({ 'main.go': 'package main\n' })
  loadExtensions(dir)
  const t = await launch(dir, { lsp: true, extensionUpdates: true, lspServers: { go: [] } })
  await openFile(t, 'main.go')
  await settle(t, 200)

  expect(t.captureCharFrame()).not.toContain('No language server')
})

test('declining is remembered, and asks again for no other file of that language', async () => {
  const dir = fixture({ 'main.go': 'package main\n', 'other.go': 'package other\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')
  await untilFrame(t, 'No language server')

  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('No language server')

  await openFile(t, 'other.go')
  await settle(t, 200)
  expect(t.captureCharFrame()).not.toContain('No language server')
})

test('an installed extension with a newer version in the market updates itself at startup', async () => {
  install({ ...GO_EXTENSION, version: '1.0.0' })
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, { extensionUpdates: true }, {}, { checkUpdates: true })

  await untilFrame(t, 'Updated Go to 1.1.0')
  expect(JSON.parse(readFileSync(join(EXTENSIONS_DIR, 'go', 'extension.json'), 'utf8'))).toEqual(
    GO_EXTENSION,
  )
})

test('a built-in is never an update, however new the market copy', async () => {
  catalog = {
    extensions: [
      {
        id: 'typescript',
        name: 'TypeScript',
        version: '9.9.9',
        description: 'TypeScript and friends',
        provides: { themes: [], icons: [], filetypes: ['typescript'] },
      },
    ],
  }
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 1 extension')
  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Every extension is up to date')
})

test('the market is not touched when the setting is off', async () => {
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: false }, {}, { checkUpdates: true })
  await openFile(t, 'main.go')
  await settle(t, 200)

  expect(requested.filter(url => url.includes('extensions'))).toEqual([])
})

async function openMarketRow(t: Harness, name: string) {
  await runCommand(t, 'Extensions panel')
  await settle(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText(name))
  await press(t, input => input.pressEnter())
}

test('the extensions page lists the market and installs from it', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')

  await openMarketRow(t, 'gopls')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'Installed Go 1.1.0')
})

test('the panel lists the whole market, not only what was searched for', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')

  await runCommand(t, 'Extensions panel')
  await settle(t)
  const idle = t.captureCharFrame()
  expect(idle).toContain('INSTALLED')
  expect(idle).toContain('AVAILABLE')
  expect(idle).toContain('Go')

  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('gopls'))
  const searched = t.captureCharFrame()
  expect(searched).toContain('AVAILABLE')
  expect(searched).toContain('Go')

  await pressEscape(t)
  expect(t.captureCharFrame()).toContain('AVAILABLE')
})
test('opening the panel refetches a catalog the cache still calls fresh', async () => {
  const cache = join(process.env.XDG_CACHE_HOME!, 'druk', 'market.json')
  mkdirSync(join(cache, '..'), { recursive: true })
  writeFileSync(cache, JSON.stringify({ at: Date.now(), extensions: [] }))

  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: false }, { height: 40 })
  await settle(t)
  expect(requested).toEqual([])

  await runCommand(t, 'Extensions panel')
  await untilFrame(t, 'AVAILABLE')
  expect(t.captureCharFrame()).toContain('Go')
  expect(requested.filter(url => url.endsWith('index.json'))).toHaveLength(1)

  await runCommand(t, 'Extensions panel')
  await runCommand(t, 'Extensions panel')
  await settle(t)
  expect(requested.filter(url => url.endsWith('index.json'))).toHaveLength(1)
})

test('a search that matches most of a big market says what it left out', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })
  catalog = {
    extensions: Array.from({ length: 120 }, (_, at) => ({
      id: `pack${at}`,
      name: `Pack ${at}`,
      version: '1.0.0',
      description: 'a language pack',
      provides: { themes: [], icons: [], filetypes: [`x${at}`] },
    })),
  }

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 120 extensions')
  await runCommand(t, 'Extensions panel')
  await settle(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('pack'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('AVAILABLE')
  expect(frame).toContain('Pack 0')
  await pressTimes(t, 60, input => input.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('+70 more matches')
})

test('installing a language extension teaches druk the language, extension and all', async () => {
  const dir = fixture({ 'a.nim': 'proc main = discard\n' })
  const t = await launch(dir, { extensionUpdates: true })

  await openFile(t, 'a.nim')
  expect(t.captureCharFrame()).not.toContain(' nim ')

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market')
  await openMarketRow(t, 'Nim')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'Installed Nim 1.0.0')

  await openFile(t, 'a.nim')
  await untilFrame(t, ' nim ')
})

test('the search answers a kind, not only a name', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })
  catalog = {
    extensions: [
      {
        id: 'go',
        name: 'Go',
        version: '1.1.0',
        description: 'gopls',
        provides: { themes: [], icons: [], filetypes: ['go'] },
        categories: ['language', 'lsp'],
      },
      {
        id: 'dracula',
        name: 'Dracula',
        version: '1.0.0',
        description: 'a palette',
        provides: { themes: ['dracula'], icons: [], filetypes: [] },
        categories: ['theme'],
      },
    ],
  }
  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')
  await runCommand(t, 'Extensions panel')
  await settle(t)

  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('theme'))
  const themes = t.captureCharFrame()
  expect(themes).toContain('Dracula')
  expect(themes).not.toContain('Go 1.1.0')

  await pressEscape(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('lsp'))
  const servers = t.captureCharFrame()
  expect(servers).toContain('Go')
  expect(servers).not.toContain('Dracula')
})

test('a kind search reaches what is installed too', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Extensions panel')
  await settle(t)

  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('lsp'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('TypeScript')
  expect(frame).not.toContain('Markdown')
})

test('a theme extension offers to activate what it brought', async () => {
  catalog = THEME_INDEX
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')
  await openMarketRow(t, 'Vesper')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()

  await untilFrame(t, 'Extension installed')
  expect(t.captureCharFrame()).toContain('Use the Vesper theme?')
  await settle(t)
  t.mockInput.pressEnter()

  await untilFrame(t, 'Theme: Vesper')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).theme).toBe('vesper')
})

test('several appearances are a choice, and declining changes nothing', async () => {
  catalog = THEME_INDEX
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')
  await openMarketRow(t, 'Catppuccin')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()

  await untilFrame(t, 'Extension installed')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Catppuccin Mocha theme')
  expect(frame).toContain('Catppuccin Icons file icons')

  await pressEscape(t)
  await settle(t)
  expect(t.captureCharFrame()).not.toContain('Extension installed')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).theme).not.toBe('catppuccin-mocha')
})

test('a language extension raises no such offer', async () => {
  const dir = fixture({ 'a.nim': 'proc main = discard\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market')
  await openMarketRow(t, 'Nim')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()

  await untilFrame(t, 'Installed Nim 1.0.0')
  await settle(t, 200)
  expect(t.captureCharFrame()).not.toContain('Extension installed')
})
