import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MARKET_DIR } from '../scripts/extensions'
import {
  CONFIG_FILE,
  DEFAULTS,
  loadConfig,
  parsePartial,
  PROJECT_CONFIG_DIR,
  projectConfigFile,
  readDisabledExtensions,
} from '../src/core/config'
import {
  loadExtensions,
  parseManifest,
  EXTENSIONS_DIR,
  projectExtensionsDir,
} from '../src/extensions'
import { iconFor, isIconThemeName } from '../src/icons'
import { languageFor } from '../src/languages'
import { filetypeForPath } from '../src/languages/highlight'
import { resolveServer } from '../src/lsp/servers'
import { isThemeName, themeFor, themeNames } from '../src/themes'
import {
  fixture,
  launch,
  openPalette,
  press,
  pressEscape,
  runCommand,
  settle,
  until,
} from './helpers'

/** The smallest theme a manifest can carry: every ui color, one syntax group. */
const themeColors = (color: string) =>
  Object.fromEntries(Object.keys(themeFor('dark').ui).map(key => [key, color]))

/** An appearance extension: how the editor looks, and nothing about a language. */
const MANIFEST = {
  id: 'pack',
  name: 'Test Pack',
  version: '2.1.0',
  themes: [
    {
      id: 'neon',
      name: 'Neon',
      ui: themeColors('#123456'),
      syntax: { keyword: { fg: '#ff00ff', bold: true } },
    },
  ],
  icons: [
    {
      id: 'blocks',
      name: 'Blocks',
      file: '■',
      folder: '□',
      extensions: { ts: { glyph: '▲', color: '#3178c6' } },
    },
  ],
}

/** A language extension: one language, and the server that serves it. */
const LANGUAGE = {
  id: 'nim',
  name: 'Nim',
  version: '1.0.0',
  languages: [
    {
      id: 'nim',
      lineComment: '#',
      extensions: ['.nim'],
      patterns: [{ group: 'keyword', re: '\\b(?:proc|let|var)\\b', flags: 'g' }],
    },
  ],
  languageServers: [
    {
      id: 'nim',
      command: ['nimlangserver'],
      filetypes: ['nim'],
      install: { kind: 'manual', command: 'nimble install nimlangserver' },
    },
  ],
}

/** Write a manifest into the user extensions folder and load it. */
function install(manifest: unknown, id = 'pack') {
  const dir = join(EXTENSIONS_DIR, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest))
  return dir
}

afterEach(() => {
  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  // The registries are module state, so an extension left registered would leak
  // into every test after this one — and into the frames they capture.
  loadExtensions(process.env.XDG_CONFIG_HOME!)
})

test('an appearance manifest contributes a theme and an icon theme', () => {
  install(MANIFEST)
  const { extensions, problems } = loadExtensions(fixture({}))

  expect(problems).toEqual([])
  expect(
    extensions.filter(p => !p.builtin).map(extension => `${extension.name} ${extension.version}`),
  ).toEqual(['Test Pack 2.1.0'])

  expect(isThemeName('neon')).toBe(true)
  expect(themeNames()).toContain('neon')
  expect(themeFor('neon').ui.bg).toBe('#123456')
  expect(themeFor('neon').syntax.keyword).toEqual({ fg: '#ff00ff', bold: true })

  expect(isIconThemeName('blocks')).toBe(true)
  expect(iconFor('blocks', { name: 'a.ts', isDir: false })).toEqual({
    glyph: '▲',
    color: '#3178c6',
  })
  expect(iconFor('blocks', { name: 'notes.txt', isDir: false })?.glyph).toBe('■')
  expect(iconFor('blocks', { name: 'src', isDir: true })?.glyph).toBe('□')
})

test('a language manifest contributes the language and its server', () => {
  install(LANGUAGE, 'nim')
  const { problems } = loadExtensions(fixture({}))
  expect(problems).toEqual([])

  const language = languageFor('nim')
  expect(language?.lineComment).toBe('#')
  // The regex arrives as a string and has to come back out as a working one,
  // with `g` whatever the manifest said — the pattern walker loops without it.
  expect(language?.patterns?.[0]?.re.flags).toContain('g')
  expect(language?.patterns?.[0]?.re.test('proc f')).toBe(true)
  // The extension is the only thing that routes a .nim file to this language:
  // OpenTUI has never heard of it.
  expect(filetypeForPath('/tmp/a.nim')).toBe('nim')

  const server = resolveServer('nim', {})
  expect(server?.command).toEqual(['nimlangserver'])
  expect(server?.install).toEqual({ kind: 'manual', command: 'nimble install nimlangserver' })
})

test('what an extension is comes from what it contributes, never from a field', () => {
  // Derived, so a manifest cannot claim to be a theme pack and ship a server.
  const appearance = parseManifest({ ...MANIFEST, categories: ['lsp'] }, '/p.json')
  expect(appearance.extension?.categories).toEqual(['theme', 'icons'])

  const language = parseManifest(LANGUAGE, '/l.json')
  expect(language.extension?.categories).toEqual(['language', 'lsp'])

  // Markdown ships no server, so `lsp` is not one of its words — the whole point
  // of keeping the categories apart from the filetypes.
  const { extensions: loaded } = loadExtensions(fixture({}))
  const markdown = loaded.find(extension => extension.id === 'markdown')
  expect(markdown?.categories).toEqual(['language'])
})

test('a manifest that is both a theme pack and a language is refused', () => {
  // The two families are installed for different reasons and updated on
  // different schedules; one extension doing both is not something to allow.
  const { extension, problems } = parseManifest({ ...MANIFEST, ...LANGUAGE, id: 'both' }, '/p.json')
  expect(extension).toBeNull()
  expect(problems[0]?.reason).toContain('one or the other')
})

test('a built-in wins over an extension on disk of the same id', () => {
  // A built-in updates with druk itself, so a disk copy — a leftover from when
  // the market updated built-ins, or a hand-written one — can only be stale.
  // Loading it would pin the extension at that version through every druk update.
  install({
    id: 'typescript',
    version: '9.0.0',
    languageServers: [{ id: 'typescript', command: ['deno', 'lsp'], filetypes: ['typescript'] }],
  })
  const { extensions: found, problems } = loadExtensions(fixture({}))
  // Named rather than silently skipped: deleting the copy is on whoever owns it.
  expect(problems[0]?.reason).toContain('ships with druk')
  expect(resolveServer('typescript', {})?.command).toEqual([
    'typescript-language-server',
    '--stdio',
  ])
  const shipped = found.filter(extension => extension.id === 'typescript')
  expect(shipped).toHaveLength(1)
  expect(shipped[0]?.builtin).toBe(true)
})

test('a project carries its own extensions', () => {
  const dir = fixture({})
  mkdirSync(projectExtensionsDir(dir), { recursive: true })
  writeFileSync(join(projectExtensionsDir(dir), 'local.json'), JSON.stringify(MANIFEST))

  expect(loadExtensions(dir).extensions.filter(extension => !extension.builtin)).toHaveLength(1)
  expect(isThemeName('neon')).toBe(true)
})

test('a disabled extension is listed but registers nothing', () => {
  install(MANIFEST)
  install(LANGUAGE, 'nim')
  const { extensions: found } = loadExtensions(fixture({}), ['pack', 'nim'])
  expect(found.filter(p => !p.builtin).every(extension => extension.disabled)).toBe(true)
  expect(isThemeName('neon')).toBe(false)
  expect(resolveServer('nim', {})).toBeNull()
  expect(languageFor('nim')).toBeUndefined()
})

test('a disabled built-in takes its language with it', () => {
  // The one thing disabling a shipped extension has to do: druk stops knowing that
  // language at all, rather than half-registering it.
  loadExtensions(fixture({}), ['typescript'])
  expect(languageFor('typescript')).toBeUndefined()
  loadExtensions(fixture({}))
  expect(languageFor('typescript')).toBeDefined()
})

test('reloading drops what an uninstalled extension contributed', () => {
  const dir = install(MANIFEST)
  const project = fixture({})
  loadExtensions(project)
  expect(isThemeName('neon')).toBe(true)

  rmSync(dir, { recursive: true, force: true })
  loadExtensions(project)
  expect(isThemeName('neon')).toBe(false)
  expect(themeNames()).not.toContain('neon')
})

test('an extension may register over a shipped id, and dropping it puts that back', () => {
  install({
    id: 'over',
    themes: [{ id: 'dark', name: 'My Dark', ui: themeColors('#010203'), syntax: {} }],
    icons: [{ id: 'unicode', name: 'Mine', file: '#' }],
  })
  const project = fixture({})
  loadExtensions(project)
  expect(themeFor('dark').ui.bg).toBe('#010203')
  expect(iconFor('unicode', { name: 'a.ts', isDir: false })?.glyph).toBe('#')

  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  loadExtensions(project)
  // Not deleted with the extension: `dark` is the fallback every other lookup ends
  // at, so losing it would leave the editor with no colors at all.
  expect(themeFor('dark').name).toBe('GitHub Dark')
  expect(themeNames()).toContain('dark')
  expect(iconFor('unicode', { name: 'a.ts', isDir: false })?.glyph).toBe('◆')
})

test('an icon map points at definitions, and a folder gets its open form', () => {
  const { extension, problems } = parseManifest(
    {
      id: 'defs',
      icons: [
        {
          id: 'named',
          definitions: {
            'typescript': { glyph: '◆', color: '#3178c6' },
            'folder-src': { glyph: '◈', color: '#4caf50', open: '◇' },
          },
          extensions: { 'ts': 'typescript', '.tsx': 'typescript' },
          names: { '.gitignore': 'typescript' },
          folders: { src: 'folder-src' },
        },
      ],
    },
    '/extensions/defs/extension.json',
  )
  expect(problems).toEqual([])
  const icons = extension!.icons[0]!
  expect(icons.extensions).toEqual({
    ts: { glyph: '◆', color: '#3178c6' },
    tsx: { glyph: '◆', color: '#3178c6' },
  })
  // Kept whole, dot and all: `.gitignore` is the file's name, and stripping the
  // dot here would leave a key `iconFor` can never look up.
  expect(icons.names['.gitignore']?.glyph).toBe('◆')
  expect(icons.folders.src?.glyph).toBe('◈')
  expect(icons.foldersOpen.src).toEqual({ glyph: '◇', color: '#4caf50' })
})

test('a named folder is found however the project spelled it', () => {
  install({
    id: 'dirs',
    icons: [
      {
        id: 'dirs',
        folder: '□',
        folderOpen: '▽',
        definitions: { 'folder-github': { glyph: '◉', open: '◎' } },
        folders: { github: 'folder-github' },
      },
    ],
  })
  loadExtensions(fixture({}))
  for (const name of ['github', '.github', '_github', '__github__']) {
    expect(`${name}:${iconFor('dirs', { name, isDir: true })?.glyph}`).toBe(`${name}:◉`)
  }
  expect(iconFor('dirs', { name: '.github', isDir: true, expanded: true })?.glyph).toBe('◎')
  // A folder the theme never named still says whether it is open.
  expect(iconFor('dirs', { name: 'whatever', isDir: true, expanded: true })?.glyph).toBe('▽')
})

test('a Nerd Font glyph above the BMP is one cell, and still not an emoji', () => {
  const { extension } = parseManifest(
    {
      id: 'nerd',
      // U+F07D3 is Nerd Fonts' Material Design Icons range, which a patched font
      // draws one cell wide; U+1F600 is an emoji and is two.
      icons: [{ id: 'nerd', file: '\u{F07D3}', extensions: { ts: '\u{1F600}' } }],
    },
    '/extensions/nerd/extension.json',
  )
  expect(extension?.icons[0]?.file.glyph).toBe('\u{F07D3}')
  expect(extension?.icons[0]?.extensions).toEqual({})
})

test('a bad contribution is reported and costs the extension only that entry', () => {
  const { extension, problems } = parseManifest(
    {
      id: 'half',
      themes: [{ id: 'broken', ui: { bg: 'red' }, syntax: {} }],
      icons: [
        { id: 'wide', file: '👍' },
        { id: 'ok', file: '#' },
      ],
      languageServers: [{ id: 'nocmd', filetypes: ['nim'] }],
    },
    '/extensions/half/extension.json',
  )

  expect(extension?.themes).toEqual([])
  expect(extension?.servers).toEqual([])
  // The two-cell glyph is refused, not drawn: it would shift every name in the
  // tree by a column. The theme it belongs to keeps its other icons.
  expect(extension?.icons.map(icons => icons.id)).toEqual(['wide', 'ok'])
  expect(extension?.icons[0]?.file.glyph).not.toBe('👍')
  expect(problems.map(problem => problem.reason)).toEqual([
    'theme "broken" needs a #rrggbb bg',
    'server "nocmd" needs a command, e.g. ["nimlangserver"]',
  ])
})

test('a manifest that is not JSON is a reported problem, not a crash', () => {
  const dir = join(EXTENSIONS_DIR, 'bad')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'extension.json'), '{ not json')

  const { extensions: found, problems } = loadExtensions(fixture({}))
  expect(found.filter(extension => !extension.builtin)).toEqual([])
  expect(problems).toHaveLength(1)
})

test('the config takes an extension theme, and drops one no extension registers', () => {
  install(MANIFEST)
  loadExtensions(fixture({}))
  expect(parsePartial({ theme: 'neon', iconTheme: 'blocks' })).toEqual({
    theme: 'neon',
    iconTheme: 'blocks',
  })

  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  loadExtensions(fixture({}))
  expect(parsePartial({ theme: 'neon', iconTheme: 'blocks' })).toEqual({})
})

test('startup order: extensions load, then the config keeps their theme', () => {
  // What main.tsx does, in the order it does it — the one arrangement no UI test
  // covers, and the one that decides whether an extension theme survives a restart.
  install(MANIFEST)
  const dir = fixture({})
  mkdirSync(join(dir, PROJECT_CONFIG_DIR), { recursive: true })
  writeFileSync(projectConfigFile(dir), JSON.stringify({ disabledExtensions: [] }))
  writeFileSync(CONFIG_FILE, JSON.stringify({ theme: 'neon', disabledExtensions: ['pack'] }))

  // The project's empty list wins over the user's, so nothing is disabled.
  expect(readDisabledExtensions(dir)).toEqual([])
  loadExtensions(dir, readDisabledExtensions(dir))
  expect(loadConfig().theme).toBe('neon')

  // And with the project file gone, the user's own list shelves the extension —
  // which takes its theme with it, so the config falls back.
  rmSync(projectConfigFile(dir))
  expect(readDisabledExtensions(dir)).toEqual(['pack'])
  loadExtensions(dir, readDisabledExtensions(dir))
  expect(loadConfig().theme).toBe(DEFAULTS.theme)
})

test('icons take the arrow column in the tree', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'notes.md': '# hi\n' })
  const t = await launch(dir, { iconTheme: 'unicode' })

  const frame = t.captureCharFrame()
  expect(frame).toContain('◆ a.ts')
  expect(frame).toContain('¶ notes.md')
  // The row is no wider than it was: the glyph replaced the arrow.
  expect(frame).not.toContain('· a.ts')
})

test('an extension icon theme is a value of the setting', async () => {
  install(MANIFEST)
  loadExtensions(fixture({}))
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { iconTheme: 'blocks' })
  expect(t.captureCharFrame()).toContain('▲ a.ts')
})

test('the material set draws the tree it is installed for', async () => {
  install(
    JSON.parse(readFileSync(join(MARKET_DIR, 'material-icons', 'extension.json'), 'utf8')),
    'material-icons',
  )
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'src/b.rs': 'fn main() {}\n' })
  loadExtensions(dir)
  const t = await launch(dir, { iconTheme: 'material' })

  const glyph = (name: string, isDir: boolean) =>
    iconFor('material', { name, isDir, expanded: false })!.glyph
  const frame = t.captureCharFrame()
  expect(frame).toContain(`${glyph('a.ts', false)} a.ts`)
  expect(frame).toContain(`${glyph('src', true)} src`)
  // Every row is still the same number of cells: a Nerd Font glyph above the
  // BMP takes one, and the tree would drift a column if it were counted as two.
  const widths = frame
    .split('\n')
    .filter(Boolean)
    .map(line => [...line].length)
  expect(new Set(widths).size).toBe(1)
})

test('an extension theme is in the palette and the settings page', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir)

  await openPalette(t)
  await press(t, input => void input.typeText('Neon'))
  expect(t.captureCharFrame()).toContain('Neon')
})

test('the sidebar panel lists what is installed and turns one off', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Extensions panel')
  await settle(t)
  expect(t.captureCharFrame()).toContain('Test Pack')
  expect(t.captureCharFrame()).toContain('✓ Test Pack')

  // The search is how a test reaches one row without counting the preinstalled
  // ones, which adding a shipped extension would silently change — and it lands
  // the cursor on the hit, so the Enter after it is the toggle.
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('Test Pack'))
  await press(t, input => input.pressEnter())
  await settle(t)
  expect(t.captureCharFrame()).toContain('✗ Test Pack')
})

test('Backspace asks before it deletes an extension, and deleting is what it does', async () => {
  const folder = install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Extensions panel')
  await settle(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('Test Pack'))
  // Esc leaves the field but keeps the row it found — Backspace is the field's
  // while it is up, so this is the only way to reach the row with it.
  await pressEscape(t)
  await press(t, input => input.pressBackspace())
  // Asked, not done: the folder is still there while the question is up.
  expect(t.captureCharFrame()).toContain('Uninstall extension')
  expect(existsSync(folder)).toBe(true)

  await press(t, input => input.pressEnter())
  await until(t, () => !existsSync(folder))
})

test('a built-in has no folder to delete, so Backspace says so instead', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Extensions panel')
  await settle(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('TypeScript'))
  await pressEscape(t)
  await press(t, input => input.pressBackspace())
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Uninstall extension')
  expect(frame).toContain('ships with druk')
})

test("the panel is the sidebar's third view, beside files and git", async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 })

  const tabs = t.captureCharFrame()
  expect(tabs).toContain('Files')
  expect(tabs).toContain('Git')
  expect(tabs).toContain('Ext')

  await runCommand(t, 'Extensions panel')
  await settle(t)
  const panel = t.captureCharFrame()
  expect(panel).toContain('extensions')
  expect(panel).toContain('INSTALLED')
})

test('every icon glyph druk ships is one cell wide', () => {
  // A two-cell glyph shifts every name in the tree, and the frame captures in
  // these tests would drift with it.
  for (const theme of ['unicode']) {
    for (const name of ['a.ts', 'a.js', 'readme.md', 'package.json', 'photo.png', 'x.unknown']) {
      const glyph = iconFor(theme, { name, isDir: false })?.glyph ?? ''
      expect(`${theme}/${name}:${[...glyph].length}`).toBe(`${theme}/${name}:1`)
    }
  }
})

test('the default config draws no icons at all', () => {
  expect(DEFAULTS.iconTheme).toBe('none')
  expect(iconFor('none', { name: 'a.ts', isDir: false })).toBeNull()
})

test('the palette picks an icon set, as it picks a theme', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, {}, { height: 40 })

  await openPalette(t)
  await press(t, input => void input.typeText('File icons'))
  expect(t.captureCharFrame()).toContain('File icons')
  await pressEscape(t)

  await runCommand(t, 'Blocks')
  await settle(t)
  expect(t.captureCharFrame()).toContain('▲ a.ts')
})
