import { createSignal } from 'solid-js'

export interface IconEntry {
  // One cell wide: a wider glyph shifts every name in the tree.
  glyph: string
  color?: string
}

export interface IconTheme {
  id: string
  name: string
  patchedFont?: boolean
  file: IconEntry
  folder: IconEntry
  folderOpen: IconEntry
  names: Record<string, IconEntry>
  // Without the dot, lowercase.
  extensions: Record<string, IconEntry>
  folders: Record<string, IconEntry>
  foldersOpen: Record<string, IconEntry>
}

export const NO_ICONS = 'none'

const entry = (glyph: string, color?: string): IconEntry =>
  color ? { color, glyph } : { glyph }

// BMP geometric and punctuation characters only: one cell wide, present in any font.
const unicode: IconTheme = {
  extensions: {
    bash: entry('▷'),
    c: entry('◇'),
    cjs: entry('◇'),
    cpp: entry('◇'),
    css: entry('◈'),
    gif: entry('▣'),
    go: entry('◆'),
    gz: entry('▦'),
    h: entry('◇'),
    html: entry('◈'),
    java: entry('◆'),
    jpeg: entry('▣'),
    jpg: entry('▣'),
    js: entry('◇'),
    json: entry('▤'),
    jsonc: entry('▤'),
    jsx: entry('◇'),
    lock: entry('▪'),
    lua: entry('◆'),
    md: entry('¶'),
    mjs: entry('◇'),
    php: entry('◆'),
    png: entry('▣'),
    py: entry('◆'),
    rb: entry('◆'),
    rs: entry('◆'),
    scss: entry('◈'),
    sh: entry('▷'),
    svg: entry('▣'),
    swift: entry('◆'),
    tar: entry('▦'),
    toml: entry('▤'),
    ts: entry('◆'),
    tsx: entry('◆'),
    txt: entry('¶'),
    yaml: entry('▤'),
    yml: entry('▤'),
    zig: entry('◆'),
    zip: entry('▦'),
    zsh: entry('▷'),
  },
  file: entry('·'),
  folder: entry('▸'),
  folderOpen: entry('▾'),
  folders: {},
  foldersOpen: {},
  id: 'unicode',
  name: 'Unicode shapes',
  names: {
    'bun.lock': entry('▤'),
    dockerfile: entry('▦'),
    license: entry('¶'),
    makefile: entry('▦'),
    'package-lock.json': entry('▤'),
    'package.json': entry('▤'),
    'readme.md': entry('¶'),
  },
}

const BUILTIN_ICON_THEMES: IconTheme[] = [unicode]

const registry: Record<string, IconTheme> = Object.fromEntries(
  BUILTIN_ICON_THEMES.map((theme) => [theme.id, theme])
)

const fromExtensions = new Set<string>()

// A signal: the settings list is reactive, and a mutated object would repaint nothing.
const [names, setNames] = createSignal<string[]>(Object.keys(registry))

export function registerIconTheme(theme: IconTheme): void {
  registry[theme.id] = theme
  fromExtensions.add(theme.id)
  setNames(Object.keys(registry))
}

export function clearExtensionIconThemes(): void {
  for (const id of fromExtensions) {
    // An extension may have registered over a shipped id; put the shipped theme back.
    const shipped = BUILTIN_ICON_THEMES.find((theme) => theme.id === id)
    if (shipped) {
      registry[id] = shipped
    } else {
      Reflect.deleteProperty(registry, id)
    }
  }
  fromExtensions.clear()
  setNames(Object.keys(registry))
}

export const iconThemeNames = (): string[] => [NO_ICONS, ...names()]

export const iconThemeLabel = (id: string): string =>
  id === NO_ICONS ? 'none' : (registry[id]?.name ?? id)

export const iconThemeNeedsFont = (id: string): boolean =>
  registry[id]?.patchedFont === true

export const isIconThemeName = (value: unknown): value is string =>
  typeof value === 'string' && (value === NO_ICONS || value in registry)

// `.github`, `_test` and `__tests__` are the folder a theme spells `github` and `test`.
const folderKey = (name: string): string =>
  name.replace(/^__(.+)__$/u, '$1').replace(/^[._-]+/u, '')

export function iconFor(
  themeId: string,
  node: { name: string; isDir: boolean; expanded?: boolean }
): IconEntry | null {
  if (themeId === NO_ICONS) {
    return null
  }
  const theme = registry[themeId]
  if (!theme) {
    return null
  }
  const name = node.name.toLowerCase()
  if (node.isDir) {
    const key = folderKey(name)
    const named = node.expanded
      ? (theme.foldersOpen[name] ??
        theme.foldersOpen[key] ??
        theme.folders[name] ??
        theme.folders[key])
      : (theme.folders[name] ?? theme.folders[key])
    return named ?? (node.expanded ? theme.folderOpen : theme.folder)
  }
  const byName = theme.names[name]
  if (byName) {
    return byName
  }
  // Left to right, so a compound extension (`d.ts`) is tried before `ts`.
  for (let at = name.indexOf('.'); at !== -1; at = name.indexOf('.', at + 1)) {
    const found = theme.extensions[name.slice(at + 1)]
    if (found) {
      return found
    }
  }
  return theme.file
}

export const ICON_FALLBACK_ENV = 'DRUK_ICON_FALLBACK'

const CONSOLE_TERM = /^(dumb|linux|vt\d|ansi|xterm-mono)/u

// Never written back to the config: one `config.json` is read from both machines.
export function usableIconTheme(
  id: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const forced = env[ICON_FALLBACK_ENV]
  if (forced === '0' || forced === 'off') {
    return id
  }
  if (id === NO_ICONS) {
    return id
  }
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG
  // Unset is not the C locale: a terminal that inherited no LANG still draws UTF-8.
  if (locale && !/utf-?8/iu.test(locale)) {
    return NO_ICONS
  }
  const bare =
    forced === '1' || forced === 'on' || CONSOLE_TERM.test(env.TERM ?? '')
  return bare && iconThemeNeedsFont(id) ? 'unicode' : id
}
