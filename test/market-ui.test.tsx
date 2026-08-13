/**
 * The market from the editor's side: the offer a file raises, the update notice
 * on startup, and what accepting one actually writes.
 *
 * `fetch` is replaced for the whole file. Nothing here may reach the network —
 * and the global is the seam because that is exactly what production uses:
 * `core/market.ts` reads it at call time, so a stub is the registry.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadExtensions, EXTENSIONS_DIR } from '../src/extensions'
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

/** A language druk knows nothing about: no grammar, no extension, no server. */
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
      provides: { themes: [], icons: [], filetypes: ['nim'] },
    },
  ],
}

const realFetch = globalThis.fetch
/** Every url the editor asked for, so a test can assert it asked for nothing. */
let requested: string[] = []
/** What the stubbed registry serves as its index; a test may swap it. */
let catalog: unknown = INDEX

beforeEach(() => {
  requested = []
  catalog = INDEX
  globalThis.fetch = ((url: string) => {
    requested.push(String(url))
    const body = String(url).endsWith('index.json')
      ? catalog
      : String(url).endsWith('go/extension.json')
        ? GO_EXTENSION
        : String(url).endsWith('nim/extension.json')
          ? NIM_EXTENSION
          : null
    return Promise.resolve(
      body ? new Response(JSON.stringify(body)) : new Response('no', { status: 404 }),
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  rmSync(join(process.env.XDG_CACHE_HOME!, 'druk', 'market.json'), { force: true })
  // The registries are module state: an extension left registered would follow this
  // file's tests into every one after them.
  loadExtensions(process.env.XDG_CONFIG_HOME!)
})

/** An installed extension, at whatever version. */
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
  // The command is on the modal because it is the part that is not inert: a
  // manifest runs nothing, but this is what druk will spawn once it is there.
  expect(frame).toContain('druk-no-such-gopls')
  expect(frame).toContain('Extension available')

  await settle(t)
  t.mockInput.pressEnter()
  // The servers the extension brought are restarted, which is what makes the
  // open file try the new one without a relaunch. "Installed Go 1.1.0" is said
  // first and is not what is waited for: a server the extension brought and the
  // machine lacks is the more useful thing to leave on the status bar, so with
  // this fixture the install line is replaced before a frame carries it.
  await untilFrame(t, 'druk-no-such-gopls is not installed, or not on PATH')
  expect(JSON.parse(readFileSync(join(EXTENSIONS_DIR, 'go', 'extension.json'), 'utf8'))).toEqual(
    GO_EXTENSION,
  )
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

test('an installed extension with a newer version in the market is reported at startup', async () => {
  install({ ...GO_EXTENSION, version: '1.0.0' })
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, { extensionUpdates: true }, {}, { checkUpdates: true })

  await untilFrame(t, 'Go 1.1.0 is out')
})

test('a built-in is never an update, however new the market copy', async () => {
  // typescript ships inside the binary and updates with druk itself, so a newer
  // catalog version of it must not count as an extension update.
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
  // The second pass is the assertion: with a catalog already in hand it answers
  // about updates, and "1 extension update available" is the failure this pins.
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

/**
 * Install `name` from the sidebar's extensions panel. Available starts folded,
 * so the search is the way to one — and it lands the cursor on the first hit,
 * which is what makes the Enter after it an install.
 */
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
  // On screen without having to guess a name first.
  expect(idle).toContain('AVAILABLE')
  expect(idle).toContain('Go')

  // The search still narrows it rather than raising it.
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('gopls'))
  const searched = t.captureCharFrame()
  expect(searched).toContain('AVAILABLE')
  expect(searched).toContain('Go')

  await pressEscape(t)
  expect(t.captureCharFrame()).toContain('AVAILABLE')
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

  // The cap is 50, and the row that says so is the whole point: a list that
  // stopped at fifty in silence would read as a market that has fifty.
  const frame = t.captureCharFrame()
  expect(frame).toContain('AVAILABLE')
  expect(frame).toContain('Pack 0')
  await pressTimes(t, 60, input => input.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('+70 more matches')
})

test('installing a language extension teaches druk the language, extension and all', async () => {
  const dir = fixture({ 'a.nim': 'proc main = discard\n' })
  const t = await launch(dir, { extensionUpdates: true })

  // Before: nothing claims .nim, so the status bar has no language to name.
  await openFile(t, 'a.nim')
  expect(t.captureCharFrame()).not.toContain(' nim ')

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market')
  await openMarketRow(t, 'Nim')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'Installed Nim 1.0.0')

  // The extension is the whole point: OpenTUI resolves nothing for .nim, so the
  // status bar naming the language means the extension's own claim is what routed it.
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

  // Nothing in Dracula's name or blurb says "theme" — the contribution does.
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('theme'))
  const themes = t.captureCharFrame()
  expect(themes).toContain('Dracula')
  expect(themes).not.toContain('Go 1.1.0')

  // And "lsp" is the other question: a language extension with no server must
  // not answer it, which is why the catalog carries the server ids apart from
  // the filetypes.
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
  // The preinstalled set: typescript and html carry servers, markdown does not.
  expect(frame).toContain('TypeScript')
  expect(frame).not.toContain('Markdown')
})
