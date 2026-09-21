import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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

const themeColors = (color: string) =>
  Object.fromEntries(
    Object.keys(themeFor('dark').ui).map((key) => [key, color])
  )

const MANIFEST = {
  icons: [
    {
      extensions: { ts: { color: '#3178c6', glyph: '▲' } },
      file: '■',
      folder: '□',
      id: 'blocks',
      name: 'Blocks',
    },
  ],
  id: 'pack',
  name: 'Test Pack',
  themes: [
    {
      id: 'neon',
      name: 'Neon',
      syntax: { keyword: { bold: true, fg: '#ff00ff' } },
      ui: themeColors('#123456'),
    },
  ],
  version: '2.1.0',
}

const LANGUAGE = {
  id: 'nim',
  languageServers: [
    {
      command: ['nimlangserver'],
      filetypes: ['nim'],
      id: 'nim',
      install: { command: 'nimble install nimlangserver', kind: 'manual' },
    },
  ],
  languages: [
    {
      extensions: ['.nim'],
      id: 'nim',
      lineComment: '#',
      patterns: [
        { flags: 'g', group: 'keyword', re: '\\b(?:proc|let|var)\\b' },
      ],
    },
  ],
  name: 'Nim',
  version: '1.0.0',
}

function install(manifest: unknown, id = 'pack') {
  const dir = join(EXTENSIONS_DIR, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest))
  return dir
}

afterEach(() => {
  rmSync(EXTENSIONS_DIR, { force: true, recursive: true })
  // The registries are module state; an extension left registered leaks into the next test.
  loadExtensions(process.env.XDG_CONFIG_HOME!)
})

test('an appearance manifest contributes a theme and an icon theme', () => {
  install(MANIFEST)
  const { extensions, problems } = loadExtensions(fixture({}))

  expect(problems).toEqual([])
  expect(
    extensions
      .filter((p) => !p.builtin)
      .map((extension) => `${extension.name} ${extension.version}`)
  ).toEqual(['Test Pack 2.1.0'])

  expect(isThemeName('neon')).toBe(true)
  expect(themeNames()).toContain('neon')
  expect(themeFor('neon').ui.bg).toBe('#123456')
  expect(themeFor('neon').syntax.keyword).toEqual({ bold: true, fg: '#ff00ff' })

  expect(isIconThemeName('blocks')).toBe(true)
  expect(iconFor('blocks', { isDir: false, name: 'a.ts' })).toEqual({
    color: '#3178c6',
    glyph: '▲',
  })
  expect(iconFor('blocks', { isDir: false, name: 'notes.txt' })?.glyph).toBe(
    '■'
  )
  expect(iconFor('blocks', { isDir: true, name: 'src' })?.glyph).toBe('□')
})

test('a language manifest contributes the language and its server', () => {
  install(LANGUAGE, 'nim')
  const { problems } = loadExtensions(fixture({}))
  expect(problems).toEqual([])

  const language = languageFor('nim')
  expect(language?.lineComment).toBe('#')
  expect(language?.patterns?.[0]?.re.flags).toContain('g')
  expect(language?.patterns?.[0]?.re.test('proc f')).toBe(true)
  expect(filetypeForPath('/tmp/a.nim')).toBe('nim')

  const server = resolveServer('nim', {})
  expect(server?.command).toEqual(['nimlangserver'])
  expect(server?.install).toEqual({
    command: 'nimble install nimlangserver',
    kind: 'manual',
  })
})

test('what an extension is comes from what it contributes, never from a field', () => {
  const appearance = parseManifest(
    { ...MANIFEST, categories: ['lsp'] },
    '/p.json'
  )
  expect(appearance.extension?.categories).toEqual(['theme', 'icons'])

  const language = parseManifest(LANGUAGE, '/l.json')
  expect(language.extension?.categories).toEqual(['language', 'lsp'])

  const { extensions: loaded } = loadExtensions(fixture({}))
  const markdown = loaded.find((extension) => extension.id === 'markdown')
  expect(markdown?.categories).toEqual(['language'])
})

test('a manifest that is both a theme pack and a language is refused', () => {
  const { extension, problems } = parseManifest(
    { ...MANIFEST, ...LANGUAGE, id: 'both' },
    '/p.json'
  )
  expect(extension).toBeNull()
  expect(problems[0]?.reason).toContain('one or the other')
})

test('a built-in wins over an extension on disk of the same id', () => {
  install({
    id: 'typescript',
    languageServers: [
      { command: ['deno', 'lsp'], filetypes: ['typescript'], id: 'typescript' },
    ],
    version: '9.0.0',
  })
  const { extensions: found, problems } = loadExtensions(fixture({}))
  expect(problems[0]?.reason).toContain('ships with druk')
  expect(resolveServer('typescript', {})?.command).toEqual([
    'typescript-language-server',
    '--stdio',
  ])
  const shipped = found.filter((extension) => extension.id === 'typescript')
  expect(shipped).toHaveLength(1)
  expect(shipped[0]?.builtin).toBe(true)
})

test('a project carries its own extensions', () => {
  const dir = fixture({})
  mkdirSync(projectExtensionsDir(dir), { recursive: true })
  writeFileSync(
    join(projectExtensionsDir(dir), 'local.json'),
    JSON.stringify(MANIFEST)
  )

  expect(
    loadExtensions(dir).extensions.filter((extension) => !extension.builtin)
  ).toHaveLength(1)
  expect(isThemeName('neon')).toBe(true)
})

test('a disabled extension is listed but registers nothing', () => {
  install(MANIFEST)
  install(LANGUAGE, 'nim')
  const { extensions: found } = loadExtensions(fixture({}), ['pack', 'nim'])
  expect(
    found.filter((p) => !p.builtin).every((extension) => extension.disabled)
  ).toBe(true)
  expect(isThemeName('neon')).toBe(false)
  expect(resolveServer('nim', {})).toBeNull()
  expect(languageFor('nim')).toBeUndefined()
})

test('a disabled built-in takes its language with it', () => {
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

  rmSync(dir, { force: true, recursive: true })
  loadExtensions(project)
  expect(isThemeName('neon')).toBe(false)
  expect(themeNames()).not.toContain('neon')
})

test('an extension may register over a shipped id, and dropping it puts that back', () => {
  install({
    icons: [{ file: '#', id: 'unicode', name: 'Mine' }],
    id: 'over',
    themes: [
      { id: 'dark', name: 'My Dark', syntax: {}, ui: themeColors('#010203') },
    ],
  })
  const project = fixture({})
  loadExtensions(project)
  expect(themeFor('dark').ui.bg).toBe('#010203')
  expect(iconFor('unicode', { isDir: false, name: 'a.ts' })?.glyph).toBe('#')

  rmSync(EXTENSIONS_DIR, { force: true, recursive: true })
  loadExtensions(project)
  expect(themeFor('dark').name).toBe('GitHub Dark')
  expect(themeNames()).toContain('dark')
  expect(iconFor('unicode', { isDir: false, name: 'a.ts' })?.glyph).toBe('◆')
})

test('an icon map points at definitions, and a folder gets its open form', () => {
  const { extension, problems } = parseManifest(
    {
      icons: [
        {
          definitions: {
            'folder-src': { color: '#4caf50', glyph: '◈', open: '◇' },
            typescript: { color: '#3178c6', glyph: '◆' },
          },
          extensions: { '.tsx': 'typescript', ts: 'typescript' },
          folders: { src: 'folder-src' },
          id: 'named',
          names: { '.gitignore': 'typescript' },
        },
      ],
      id: 'defs',
    },
    '/extensions/defs/extension.json'
  )
  expect(problems).toEqual([])
  const icons = extension!.icons[0]!
  expect(icons.extensions).toEqual({
    ts: { color: '#3178c6', glyph: '◆' },
    tsx: { color: '#3178c6', glyph: '◆' },
  })
  expect(icons.names['.gitignore']?.glyph).toBe('◆')
  expect(icons.folders.src?.glyph).toBe('◈')
  expect(icons.foldersOpen.src).toEqual({ color: '#4caf50', glyph: '◇' })
})

test('a named folder is found however the project spelled it', () => {
  install({
    icons: [
      {
        definitions: { 'folder-github': { glyph: '◉', open: '◎' } },
        folder: '□',
        folderOpen: '▽',
        folders: { github: 'folder-github' },
        id: 'dirs',
      },
    ],
    id: 'dirs',
  })
  loadExtensions(fixture({}))
  for (const name of ['github', '.github', '_github', '__github__']) {
    expect(`${name}:${iconFor('dirs', { isDir: true, name })?.glyph}`).toBe(
      `${name}:◉`
    )
  }
  expect(
    iconFor('dirs', { expanded: true, isDir: true, name: '.github' })?.glyph
  ).toBe('◎')
  expect(
    iconFor('dirs', { expanded: true, isDir: true, name: 'whatever' })?.glyph
  ).toBe('▽')
})

test('a Nerd Font glyph above the BMP is one cell, and still not an emoji', () => {
  const { extension } = parseManifest(
    {
      icons: [
        { extensions: { ts: '\u{1F600}' }, file: '\u{F07D3}', id: 'nerd' },
      ],
      id: 'nerd',
    },
    '/extensions/nerd/extension.json'
  )
  expect(extension?.icons[0]?.file.glyph).toBe('\u{F07D3}')
  expect(extension?.icons[0]?.extensions).toEqual({})
})

test('a bad contribution is reported and costs the extension only that entry', () => {
  const { extension, problems } = parseManifest(
    {
      icons: [
        { file: '👍', id: 'wide' },
        { file: '#', id: 'ok' },
      ],
      id: 'half',
      languageServers: [{ filetypes: ['nim'], id: 'nocmd' }],
      themes: [{ id: 'broken', syntax: {}, ui: { bg: 'red' } }],
    },
    '/extensions/half/extension.json'
  )

  expect(extension?.themes).toEqual([])
  expect(extension?.servers).toEqual([])
  expect(extension?.icons.map((icons) => icons.id)).toEqual(['wide', 'ok'])
  expect(extension?.icons[0]?.file.glyph).not.toBe('👍')
  expect(problems.map((problem) => problem.reason)).toEqual([
    // The first ui key the theme is missing, in the order `THEMES.dark.ui` lists them.
    'theme "broken" needs a #rrggbb accent',
    'server "nocmd" needs a command, e.g. ["nimlangserver"]',
  ])
})

test('a manifest that is not JSON is a reported problem, not a crash', () => {
  const dir = join(EXTENSIONS_DIR, 'bad')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'extension.json'), '{ not json')

  const { extensions: found, problems } = loadExtensions(fixture({}))
  expect(found.filter((extension) => !extension.builtin)).toEqual([])
  expect(problems).toHaveLength(1)
})

test('the config takes an extension theme, and drops one no extension registers', () => {
  install(MANIFEST)
  loadExtensions(fixture({}))
  expect(parsePartial({ iconTheme: 'blocks', theme: 'neon' })).toEqual({
    iconTheme: 'blocks',
    theme: 'neon',
  })

  rmSync(EXTENSIONS_DIR, { force: true, recursive: true })
  loadExtensions(fixture({}))
  expect(parsePartial({ iconTheme: 'blocks', theme: 'neon' })).toEqual({})
})

test('startup order: extensions load, then the config keeps their theme', () => {
  install(MANIFEST)
  const dir = fixture({})
  mkdirSync(join(dir, PROJECT_CONFIG_DIR), { recursive: true })
  writeFileSync(
    projectConfigFile(dir),
    JSON.stringify({ disabledExtensions: [] })
  )
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ disabledExtensions: ['pack'], theme: 'neon' })
  )

  expect(readDisabledExtensions(dir)).toEqual([])
  loadExtensions(dir, readDisabledExtensions(dir))
  expect(loadConfig().theme).toBe('neon')

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
  expect(frame).not.toContain('   a.ts')
})

test('an extension icon theme is a value of the setting', async () => {
  install(MANIFEST)
  loadExtensions(fixture({}))
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    iconTheme: 'blocks',
  })
  expect(t.captureCharFrame()).toContain('▲ a.ts')
})

test('the material set draws the tree it is installed for', async () => {
  install(
    JSON.parse(
      readFileSync(
        join(MARKET_DIR, 'material-icons', 'extension.json'),
        'utf-8'
      )
    ),
    'material-icons'
  )
  const dir = fixture({
    'a.ts': 'const a = 1\n',
    'src/b.rs': 'fn main() {}\n',
  })
  loadExtensions(dir)
  const t = await launch(dir, { iconTheme: 'material' })

  const glyph = (name: string, isDir: boolean) =>
    iconFor('material', { expanded: false, isDir, name })!.glyph
  const frame = t.captureCharFrame()
  expect(frame).toContain(`${glyph('a.ts', false)} a.ts`)
  expect(frame).toContain(`${glyph('src', true)} src`)
  const widths = frame
    .split('\n')
    .filter(Boolean)
    .map((line) => [...line].length)
  expect(new Set(widths).size).toBe(1)
})

test('an extension theme is in the palette and the settings page', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir)

  await openPalette(t)
  await press(t, (input) => input.typeText('Neon'))
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

  await press(t, (input) => input.typeText('/'))
  await press(t, (input) => input.typeText('Test Pack'))
  await press(t, (input) => input.pressEnter())
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
  await press(t, (input) => input.typeText('/'))
  await press(t, (input) => input.typeText('Test Pack'))
  await pressEscape(t)
  await press(t, (input) => input.pressBackspace())
  expect(t.captureCharFrame()).toContain('Uninstall extension')
  expect(existsSync(folder)).toBe(true)

  await press(t, (input) => input.pressEnter())
  await until(t, () => !existsSync(folder))
})

test('a built-in has no folder to delete, so Backspace says so instead', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Extensions panel')
  await settle(t)
  await press(t, (input) => input.typeText('/'))
  await press(t, (input) => input.typeText('TypeScript'))
  await pressEscape(t)
  await press(t, (input) => input.pressBackspace())
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
  expect(panel).toContain('EXTENSIONS')
  expect(panel).toContain('INSTALLED')
})

test('every icon glyph druk ships is one cell wide', () => {
  for (const theme of ['unicode']) {
    for (const name of [
      'a.ts',
      'a.js',
      'readme.md',
      'package.json',
      'photo.png',
      'x.unknown',
    ]) {
      const glyph = iconFor(theme, { isDir: false, name })?.glyph ?? ''
      expect(`${theme}/${name}:${[...glyph].length}`).toBe(`${theme}/${name}:1`)
    }
  }
})

test('the default config draws no icons at all', () => {
  expect(DEFAULTS.iconTheme).toBe('none')
  expect(iconFor('none', { isDir: false, name: 'a.ts' })).toBeNull()
})

test('the palette picks an icon set, as it picks a theme', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, {}, { height: 40 })

  await openPalette(t)
  await press(t, (input) => input.typeText('File icons'))
  expect(t.captureCharFrame()).toContain('File icons')
  await pressEscape(t)

  await runCommand(t, 'Blocks')
  await settle(t)
  expect(t.captureCharFrame()).toContain('▲ a.ts')
})
