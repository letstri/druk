/**
 * Extensions — languages, language servers, themes and icon themes. Nearly
 * everything extensible druk can do arrives through here, including what it
 * ships itself.
 *
 * An extension is a JSON manifest and the files it names: `extension.json` in a folder
 * under `$XDG_CONFIG_HOME/druk/extensions/`, or a bare `<name>.json` in that folder
 * for one that needs no files at all. A project may carry its own in
 * `<project>/.druk/extensions/`, the way it carries its own settings. `./builtin.ts`
 * holds the manifests compiled into the binary; those always win over a disk copy
 * of the same id, because a built-in updates with druk itself, never through the
 * market.
 *
 * Data, deliberately. Installing an extension runs no code, so a shared theme pack
 * is as safe to drop in as a config file, and the compiled binary needs no
 * module loader — `bun build --compile` embeds what it can see at build time,
 * which an extension by definition is not.
 *
 * Load order matters: the registries here back the config validators
 * (`isThemeName`, `isIconThemeName`), so `loadExtensions` has to run before the
 * config is read or an extension theme in the config would be rejected as unknown.
 * `main.tsx` is where that order lives.
 */
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
export { CATEGORIES } from './types'
export { categoriesOf, contributionSummary, parseManifest } from './manifest'

/** Beside `config.json`, so one folder holds everything druk reads. */
export const EXTENSIONS_DIR = join(dirname(CONFIG_FILE), 'extensions')

export const projectExtensionsDir = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'extensions')

const MANIFEST = 'extension.json'

/** Every manifest in one extensions folder: `<id>.json`, and `<id>/extension.json`. */
function manifestsIn(dir: string): string[] {
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      isDir: entry.isDirectory(),
    }))
  } catch {
    return [] // no extensions folder is the normal case, not a problem to report
  }
  return entries
    .filter(entry =>
      // `index.json` is the market's catalog, not an extension. It only turns up in a
      // extensions folder someone copied the market into, and reading it as a
      // one-file extension reports a problem about a file that is doing its job.
      entry.isDir ? true : entry.name.endsWith('.json') && entry.name !== 'index.json',
    )
    .map(entry => (entry.isDir ? join(dir, entry.name, MANIFEST) : join(dir, entry.name)))
    .toSorted()
}

// A signal: the settings page lists these, so a reload has to repaint it.
const [loaded, setLoaded] = createSignal<ExtensionLoad>({ extensions: [], problems: [] })

/** What the last load found — the palette's list and the settings page read this. */
export const extensions = (): Extension[] => loaded().extensions

/** Manifests that were wrong about something. `App` reports one on startup. */
export const extensionProblems = (): ExtensionProblem[] => loaded().problems

/**
 * Read every manifest and register what it contributes, replacing whatever the
 * previous load registered — this is also the reload path, so it must leave no
 * theme or server behind from an extension that has since been deleted.
 *
 * A disabled extension is still read and listed: the settings page needs its name
 * and its contributions to offer it back, and reading a manifest costs one small
 * file.
 */
export function loadExtensions(
  rootDir: string,
  disabled: string[] = [],
  /** The user's extensions folder. A parameter only so a test can point elsewhere. */
  userDir = EXTENSIONS_DIR,
): ExtensionLoad {
  clearExtensionThemes()
  clearExtensionIconThemes()
  clearExtensionLanguages()
  clearExtensionServers()

  const off = new Set(disabled)
  const problems: ExtensionProblem[] = []
  /** By id, so a copy on disk replaces the one baked into the binary. */
  const found = new Map<string, Extension>()

  for (const extension of builtinExtensions()) found.set(extension.id, extension)

  for (const source of [...manifestsIn(userDir), ...manifestsIn(projectExtensionsDir(rootDir))]) {
    // A folder without a manifest is someone's stray directory, not an extension —
    // checked before the read so a manifest that *is* there and is malformed
    // still gets reported rather than looking like an absent one.
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
    // A built-in updates with druk itself, so a copy on disk can only be stale —
    // loading it would pin the extension at whatever version was once fetched,
    // and every druk update after that would silently not apply. Skipped and
    // named, so the leftover (druk used to update built-ins through the market)
    // can be deleted. Two market copies stay a mistake to report, since which
    // one wins is a directory listing.
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
