import { join } from 'node:path'

import type { StyleDefinitionInput } from '@opentui/core'

import { countList } from '../core/text'
import type { IconEntry, IconTheme } from '../icons'
import type { Language } from '../languages'
import { GRAMMARS } from '../languages/grammars'
import type { ServerInstall, ServerSpec } from '../lsp/servers'
import { THEMES } from '../themes'
import type { Theme, ThemeUi } from '../themes'
import type { Extension, ExtensionCategory, ExtensionProblem } from './types'

const UI_KEYS = Object.keys(THEMES.dark.ui) as (keyof ThemeUi)[]

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const text = (raw: unknown): string | null =>
  typeof raw === 'string' && raw ? raw : null

const isColor = (raw: unknown): raw is string =>
  typeof raw === 'string' && /^#[0-9a-f]{6}$/iu.test(raw)

const stringList = (raw: unknown): string[] | null =>
  Array.isArray(raw) &&
  raw.length > 0 &&
  raw.every((part) => typeof part === 'string' && part)
    ? (raw as string[])
    : null

// Ids name files and config keys: held to what a file name may be. The leading character may not
// be a dot, or `".."` is a directory an install writes to and an uninstall recursively deletes.
export const isId = (raw: unknown): raw is string =>
  typeof raw === 'string' && /^[\w-][\w.-]*$/u.test(raw)

function parseTheme(
  raw: unknown,
  fail: (reason: string) => void
): { id: string; theme: Theme } | null {
  if (!isRecord(raw)) {
    fail('a theme must be an object')
    return null
  }
  const { id } = raw
  if (!isId(id)) {
    fail(`theme id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  if (!isRecord(raw.ui)) {
    fail(`theme "${id}" has no ui colors`)
    return null
  }
  const ui = {} as ThemeUi
  for (const key of UI_KEYS) {
    const color = raw.ui[key]
    if (!isColor(color)) {
      fail(`theme "${id}" needs a #rrggbb ${key}`)
      return null
    }
    ui[key] = color
  }
  if (!isRecord(raw.syntax)) {
    fail(`theme "${id}" has no syntax groups`)
    return null
  }
  const syntax: Theme['syntax'] = {}
  for (const [group, style] of Object.entries(raw.syntax)) {
    if (!isRecord(style)) {
      fail(`theme "${id}": syntax group "${group}" is not an object`)
      continue
    }
    const parsed: StyleDefinitionInput = {}
    if (isColor(style.fg)) {
      parsed.fg = style.fg
    }
    if (isColor(style.bg)) {
      parsed.bg = style.bg
    }
    if (typeof style.bold === 'boolean') {
      parsed.bold = style.bold
    }
    if (typeof style.italic === 'boolean') {
      parsed.italic = style.italic
    }
    if (typeof style.underline === 'boolean') {
      parsed.underline = style.underline
    }
    if (typeof style.dim === 'boolean') {
      parsed.dim = style.dim
    }
    syntax[group] = parsed
  }
  return { id, theme: { name: text(raw.name) ?? id, syntax, ui } }
}

// Stops short of U+F0000: Nerd Fonts put one-cell Material icons at U+F0001 and up.
// The East Asian Wide ranges plus the emoji-presentation symbols: any of them draws two cells,
// and one in a tree row shifts every name after it.
const WIDE =
  /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F000}-\u{EFFFF}]/u

function parseIcon(raw: unknown): IconEntry | null {
  const glyph = typeof raw === 'string' ? raw : isRecord(raw) ? raw.glyph : null
  if (typeof glyph !== 'string') {
    return null
  }
  if ([...glyph].length !== 1 || WIDE.test(glyph)) {
    return null
  }
  const color = isRecord(raw) && isColor(raw.color) ? raw.color : undefined
  return color ? { color, glyph } : { glyph }
}

interface IconDefinition {
  icon: IconEntry
  open?: IconEntry
}

function parseDefinitions(raw: unknown): Record<string, IconDefinition> {
  const map: Record<string, IconDefinition> = {}
  if (!isRecord(raw)) {
    return map
  }
  for (const [name, value] of Object.entries(raw)) {
    const icon = parseIcon(value)
    if (!icon) {
      continue
    }
    const open = isRecord(value)
      ? parseIcon({ ...value, glyph: value.open })
      : null
    map[name] = open ? { icon, open } : { icon }
  }
  return map
}

// A glyph is one character and a definition name is not, so the two never collide.
const resolveIcon = (
  value: unknown,
  definitions: Record<string, IconDefinition>
): IconEntry | null =>
  parseIcon(value) ??
  (typeof value === 'string' ? (definitions[value]?.icon ?? null) : null)

function parseIconMap(
  raw: unknown,
  definitions: Record<string, IconDefinition>,
  key: (name: string) => string
): Record<string, IconEntry> {
  const map: Record<string, IconEntry> = {}
  if (!isRecord(raw)) {
    return map
  }
  for (const [name, value] of Object.entries(raw)) {
    const icon = resolveIcon(value, definitions)
    if (icon) {
      map[key(name)] = icon
    }
  }
  return map
}

const wholeName = (name: string): string => name.toLowerCase()

const extensionName = (name: string): string =>
  name.toLowerCase().replace(/^\./u, '')

const FALLBACK: Record<'file' | 'folder' | 'folderOpen', IconEntry> = {
  file: { glyph: '·' },
  folder: { glyph: '▸' },
  folderOpen: { glyph: '▾' },
}

function parseIconTheme(
  raw: unknown,
  fail: (reason: string) => void
): IconTheme | null {
  if (!isRecord(raw)) {
    fail('an icon theme must be an object')
    return null
  }
  const { id } = raw
  if (!isId(id)) {
    fail(`icon theme id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  const definitions = parseDefinitions(raw.definitions)
  const folders = parseIconMap(raw.folders, definitions, wholeName)
  const foldersOpen = parseIconMap(raw.foldersOpen, definitions, wholeName)
  // A folder's open form comes from the definition it names, so a name is listed once.
  if (isRecord(raw.folders)) {
    for (const [name, value] of Object.entries(raw.folders)) {
      const open =
        typeof value === 'string' ? definitions[value]?.open : undefined
      const key = wholeName(name)
      if (open && !(key in foldersOpen)) {
        foldersOpen[key] = open
      }
    }
  }
  return {
    extensions: parseIconMap(raw.extensions, definitions, extensionName),
    file: resolveIcon(raw.file, definitions) ?? FALLBACK.file,
    folder: resolveIcon(raw.folder, definitions) ?? FALLBACK.folder,
    folderOpen:
      resolveIcon(raw.folderOpen, definitions) ??
      resolveIcon(raw.folder, definitions) ??
      FALLBACK.folderOpen,
    folders,
    foldersOpen,
    id,
    name: text(raw.name) ?? id,
    names: parseIconMap(raw.names, definitions, wholeName),
    patchedFont: raw.patchedFont === true,
  }
}

// Machine resolved here, not at install time: no build for it falls back to `command`.
function parseInstall(raw: unknown): ServerInstall | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const command = text(raw.command)
  if (raw.kind === 'npm') {
    const packages = stringList(raw.packages)
    return packages ? { kind: 'npm', packages } : undefined
  }
  if (raw.kind === 'download') {
    const url = text(raw.url)
    if (url) {
      return { kind: 'download', url }
    }
    const forMachine = isRecord(raw.urls)
      ? text(raw.urls[`${process.platform}-${process.arch}`])
      : null
    if (forMachine) {
      return { kind: 'download', url: forMachine }
    }
    return command ? { command, kind: 'manual' } : undefined
  }
  if (raw.kind === 'manual' && command) {
    return { command, kind: 'manual' }
  }
  return undefined
}

function parseServer(
  raw: unknown,
  fail: (reason: string) => void
): ServerSpec | null {
  if (!isRecord(raw)) {
    fail('a language server must be an object')
    return null
  }
  const { id } = raw
  if (!isId(id)) {
    fail(`server id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  const command = stringList(raw.command)
  if (!command) {
    fail(`server "${id}" needs a command, e.g. ["nimlangserver"]`)
    return null
  }
  const filetypes = stringList(raw.filetypes)
  if (!filetypes) {
    fail(`server "${id}" needs the filetypes it serves`)
    return null
  }
  const install = parseInstall(raw.install)
  // Unvalidated: the server's own settings shape, not druk's.
  const settings = isRecord(raw.settings) ? raw.settings : undefined
  return {
    command,
    filetypes,
    id,
    ...(install ? { install } : null),
    ...(settings ? { settings } : null),
  }
}

// Relative to the extension's own folder — never an escape from it.
function assetPath(raw: unknown): string | null {
  const value = text(raw)
  if (!value) {
    return null
  }
  if (
    value.startsWith('/') ||
    value.includes('..') ||
    /^[a-z]+:/iu.test(value)
  ) {
    return null
  }
  return value
}

function parseLanguage(
  raw: unknown,
  fail: (reason: string) => void,
  ctx: { dir?: string; collect: (path: string) => void }
): Language | null {
  if (!isRecord(raw)) {
    fail('a language must be an object')
    return null
  }
  const { id } = raw
  if (!isId(id)) {
    fail(`language id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  const language: Language = { id }
  const label = text(raw.label)
  if (label) {
    language.label = label
  }
  const lineComment = text(raw.lineComment)
  if (lineComment) {
    language.lineComment = lineComment
  }

  const grammar = isRecord(raw.grammar) ? raw.grammar : null
  if (grammar) {
    const vendored = text(grammar.vendored)
    if (vendored) {
      const known = GRAMMARS[vendored as keyof typeof GRAMMARS]
      if (!known) {
        fail(`language "${id}": druk ships no "${vendored}" grammar`)
        return null
      }
      language.wasm = known.wasm
      language.query = known.query
    } else if (grammar.bundled === true) {
      language.bundled = true
    } else {
      const wasm = assetPath(grammar.wasm)
      const query = assetPath(grammar.query)
      if (!wasm || !query) {
        fail(
          `language "${id}": a grammar needs "vendored", "bundled", or wasm + query`
        )
        return null
      }
      ctx.collect(wasm)
      ctx.collect(query)
      // Left relative for a manifest off the wire: the market resolves those when writing it.
      language.wasm = ctx.dir ? join(ctx.dir, wasm) : wasm
      language.query = ctx.dir ? join(ctx.dir, query) : query
    }
  }

  if (Array.isArray(raw.patterns)) {
    const patterns: NonNullable<Language['patterns']> = []
    for (const entry of raw.patterns) {
      if (!isRecord(entry)) {
        continue
      }
      const group = text(entry.group)
      const source = text(entry.re)
      if (!group || !source) {
        fail(`language "${id}": a pattern needs a group and a regex`)
        return null
      }
      try {
        // `g` always: `highlightWithPatterns` walks with lastIndex and loops forever without it.
        const flags = text(entry.flags) ?? ''
        patterns.push({
          group,
          re: new RegExp(source, flags.includes('g') ? flags : `${flags}g`),
        })
      } catch (error) {
        fail(
          `language "${id}": ${error instanceof Error ? error.message : String(error)}`
        )
        return null
      }
    }
    if (patterns.length > 0) {
      language.patterns = patterns
    }
  }

  if (!language.wasm && !language.bundled && !language.patterns) {
    fail(`language "${id}" has neither a grammar nor patterns`)
    return null
  }

  const extensions = stringList(raw.extensions)
  if (extensions) {
    // `filetypeForName` matches with `endsWith`, so a dotless "ts" would also claim `cats`.
    language.extensions = extensions.map((entry) =>
      entry.startsWith('.') ? entry : `.${entry}`
    )
  }
  const filenames = stringList(raw.filenames)
  if (filenames) {
    language.filenames = filenames
  }
  const pattern = text(raw.filenamePattern)
  if (pattern) {
    try {
      language.filenamePattern = new RegExp(pattern, 'u')
    } catch (error) {
      fail(
        `language "${id}": ${error instanceof Error ? error.message : String(error)}`
      )
      return null
    }
  }
  return language
}

export function parseManifest(
  raw: unknown,
  source: string,
  dir?: string
): { extension: Extension | null; problems: ExtensionProblem[] } {
  const problems: ExtensionProblem[] = []
  const fail = (reason: string) => {
    problems.push({ reason, source })
  }
  if (!isRecord(raw)) {
    fail('not a JSON object')
    return { extension: null, problems }
  }
  const { id } = raw
  if (!isId(id)) {
    fail(`id ${JSON.stringify(raw.id)} is missing, or is not a name`)
    return { extension: null, problems }
  }
  const assets: string[] = []
  const collect = (path: string) => {
    if (!assets.includes(path)) {
      assets.push(path)
    }
  }
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const themes = list(raw.themes)
    .map((entry) => parseTheme(entry, fail))
    .filter((entry) => entry !== null)
  const icons = list(raw.icons)
    .map((entry) => parseIconTheme(entry, fail))
    .filter((entry) => entry !== null)
  const languages = list(raw.languages)
    .map((entry) => parseLanguage(entry, fail, { collect, dir }))
    .filter((entry) => entry !== null)
  const servers = list(raw.languageServers)
    .map((entry) => parseServer(entry, fail))
    .filter((entry) => entry !== null)
  if (
    themes.length + icons.length > 0 &&
    languages.length + servers.length > 0
  ) {
    fail(
      `"${id}" mixes themes with languages — an extension is one or the other`
    )
    return { extension: null, problems }
  }
  if (
    themes.length === 0 &&
    icons.length === 0 &&
    languages.length === 0 &&
    servers.length === 0
  ) {
    fail(`"${id}" contributes nothing druk can use`)
  }
  return {
    extension: {
      assets,
      builtin: false,
      categories: categoriesOf({ icons, languages, servers, themes }),
      description: text(raw.description) ?? '',
      disabled: false,
      icons,
      id,
      languages,
      name: text(raw.name) ?? id,
      servers,
      source,
      themes,
      version: text(raw.version) ?? '0.0.0',
    },
    problems,
  }
}

function categoriesOf(parts: {
  languages: unknown[]
  servers: unknown[]
  themes: unknown[]
  icons: unknown[]
}): ExtensionCategory[] {
  const found: ExtensionCategory[] = []
  if (parts.languages.length > 0) {
    found.push('language')
  }
  if (parts.servers.length > 0) {
    found.push('lsp')
  }
  if (parts.themes.length > 0) {
    found.push('theme')
  }
  if (parts.icons.length > 0) {
    found.push('icons')
  }
  return found
}

export function contributionSummary(extension: Extension): string {
  return countList([
    [extension.themes.length, 'theme'],
    [extension.icons.length, 'icon theme'],
    [extension.languages.length, 'language'],
    [extension.servers.length, 'server'],
  ])
}
