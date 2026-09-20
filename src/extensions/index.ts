import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createSignal } from 'solid-js'

import { CONFIG_FILE, PROJECT_CONFIG_DIR } from '../core/config'
import { clearExtensionIconThemes, registerIconTheme } from '../icons'
import { clearExtensionLanguages, registerLanguage } from '../languages'
import { clearExtensionServers, registerServer } from '../lsp/servers'
import { clearExtensionThemes, registerTheme } from '../themes'
import { builtinExtensions } from './builtin'
import { parseManifest } from './manifest'
import type { Extension, ExtensionCategory, ExtensionLoad, ExtensionProblem } from './types'

export type { Extension, ExtensionCategory, ExtensionLoad, ExtensionProblem }
export { contributionSummary, parseManifest } from './manifest'

export const EXTENSIONS_DIR = join(dirname(CONFIG_FILE), 'extensions')

export const projectExtensionsDir = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'extensions')

const MANIFEST = 'extension.json'

function manifestsIn(dir: string): string[] {
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      isDir: entry.isDirectory(),
    }))
  } catch {
    return []
  }
  return entries
    .filter(entry =>
      // `index.json` is the market's catalog, not a one-file extension.
      entry.isDir ? true : entry.name.endsWith('.json') && entry.name !== 'index.json',
    )
    .map(entry => (entry.isDir ? join(dir, entry.name, MANIFEST) : join(dir, entry.name)))
    .toSorted()
}

// A signal: the settings page lists these, so a reload has to repaint it.
const [loaded, setLoaded] = createSignal<ExtensionLoad>({ extensions: [], problems: [] })

export const extensions = (): Extension[] => loaded().extensions

export const extensionProblems = (): ExtensionProblem[] => loaded().problems

export function loadExtensions(
  rootDir: string,
  disabled: string[] = [],
  userDir = EXTENSIONS_DIR,
): ExtensionLoad {
  clearExtensionThemes()
  clearExtensionIconThemes()
  clearExtensionLanguages()
  clearExtensionServers()

  const off = new Set(disabled)
  const problems: ExtensionProblem[] = []
  const found = new Map<string, Extension>()

  for (const extension of builtinExtensions()) found.set(extension.id, extension)

  for (const source of [...manifestsIn(userDir), ...manifestsIn(projectExtensionsDir(rootDir))]) {
    // Checked before the read, so a malformed manifest is still reported as one.
    if (!existsSync(source)) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(source, 'utf8'))
    } catch (error) {
      problems.push({ source, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    const parsed = parseManifest(raw, source, dirname(source))
    problems.push(...parsed.problems)
    const extension = parsed.extension
    if (!extension) continue
    const held = found.get(extension.id)
    // A built-in updates with druk itself; named rather than skipped, so the copy can be deleted.
    if (held) {
      problems.push({
        source,
        reason: held.builtin
          ? `"${extension.id}" ships with druk and updates with it — delete this copy`
          : `"${extension.id}" is already loaded from ${held.source}`,
      })
      continue
    }
    found.set(extension.id, extension)
  }

  const list = [...found.values()]
  for (const extension of list) {
    extension.disabled = off.has(extension.id)
    if (extension.disabled) continue
    for (const { id, theme } of extension.themes) registerTheme(id, theme)
    for (const icons of extension.icons) registerIconTheme(icons)
    for (const language of extension.languages) registerLanguage(language)
    for (const server of extension.servers) registerServer(server)
  }

  const load = { extensions: list, problems }
  setLoaded(load)
  return load
}
