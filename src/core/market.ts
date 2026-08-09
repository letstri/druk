/**
 * The extension market: the catalog druk reads, and installing an entry from it.
 *
 * The market is a folder in druk's own repository — `extensions/<id>/extension.json`,
 * with a generated `extensions/index.json` beside them — served raw from `main`.
 * A merged pull request is therefore installable straight away, without waiting
 * for a druk release, which is the whole reason extensions live there rather than
 * in `src/`.
 *
 * Two things this module is careful about, since it is the one place druk reads
 * something a stranger wrote:
 *
 * - **The registry is a directory, not a list of URLs.** The index carries extension
 *   ids and nothing else fetchable; a manifest is always `<registry><id>/extension.json`.
 *   So an index cannot aim a request at another host however it is written.
 * - **A manifest is validated before it is written.** `parseManifest` is the same
 *   check the editor applies at load, so druk never stores a file it would itself
 *   reject — and an extension that contributes nothing usable is refused at install
 *   rather than sitting silently in the extensions folder.
 *
 * Installing still runs nothing (a manifest is data), but a language-server
 * contribution is a command druk will spawn later. Naming that command in the
 * confirm prompt is `app/market.ts`'s job, and it is why the offer exists at all.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { parseManifest } from '../extensions/manifest'
import { CATEGORIES } from '../extensions/types'
import type { Extension, ExtensionCategory } from '../extensions/types'
// `../extensions` itself is deliberately not imported: it reads `core/config`, which
// reads `MARKET_URL` from here for its default — so the extensions folder is passed
// in by the caller rather than closing that cycle.
import { errorMessage } from './errors'

/** druk's own market. `extensionRegistry` points elsewhere for a fork or a test. */
export const MARKET_URL = 'https://raw.githubusercontent.com/letstri/druk/main/extensions/'

/** As short as the version check's, and for the same reason: nothing waits on it. */
const TIMEOUT_MS = 2500

/**
 * A manifest is a few hundred lines of colors at worst. The cap is here so a
 * registry that answers with something enormous cannot be read into memory.
 */
const MAX_MANIFEST_BYTES = 512 * 1024

/** A grammar wasm is the big one, and the biggest druk vendors is under 3 MB. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024

/** Assets are megabytes where a manifest is kilobytes; the wait is deliberate. */
const ASSET_TIMEOUT_MS = 30_000

/** How old the cached catalog may be before it is fetched again. */
const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** One extension as the catalog lists it — enough to show and to match, never to run. */
export interface MarketEntry {
  id: string
  name: string
  version: string
  description: string
  provides: {
    /** Theme ids, so a config naming a theme can be traced to its extension. */
    themes: string[]
    icons: string[]
    /**
     * Every filetype the extension covers — the languages it highlights and the
     * ones its servers claim. This is what answers "the file just opened has no
     * extension, which one is it?", so a language with no server counts too.
     */
    filetypes: string[]
  }
  /**
   * What it is, in one word each. In the catalog rather than derived from
   * `provides`, which merges languages and servers into one `filetypes` list:
   * from that alone nothing can tell a syntax-only extension from one that
   * spawns a program, and a search for `lsp` would answer with every language
   * druk knows.
   */
  categories: ExtensionCategory[]
}

export interface CachedCatalog {
  /** Epoch milliseconds of the fetch, so staleness is decidable offline. */
  at: number
  extensions: MarketEntry[]
}

const CACHE_FILE = join(
  process.env.XDG_CACHE_HOME ?? join(os.homedir(), '.cache'),
  'druk',
  'market.json',
)

/** The catalog row for a parsed manifest — what `scripts/extensions.ts` writes. */
export function entryFor(extension: Extension): MarketEntry {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    description: extension.description,
    provides: {
      themes: extension.themes.map(entry => entry.id),
      icons: extension.icons.map(theme => theme.id),
      filetypes: [
        ...new Set([
          ...extension.languages.map(language => language.id),
          ...extension.servers.flatMap(server => server.filetypes),
        ]),
      ],
    },
    categories: extension.categories,
  }
}

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const ids = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter(entry => typeof entry === 'string' && entry) : []

function parseEntry(raw: unknown): MarketEntry | null {
  if (!isRecord(raw)) return null
  const { id, name, version, description } = raw
  // The id names a directory in the registry and a folder on disk, so it is held
  // to what a file name may be — the same rule `parseManifest` applies.
  if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) return null
  if (typeof version !== 'string' || !version) return null
  const provides = isRecord(raw.provides) ? raw.provides : {}
  return {
    id,
    name: typeof name === 'string' && name ? name : id,
    version,
    description: typeof description === 'string' ? description : '',
    provides: {
      themes: ids(provides.themes),
      icons: ids(provides.icons),
      filetypes: ids(provides.filetypes),
    },
    // Absent from a catalog written before this existed, and from a cache of
    // one: an empty list is the honest answer, not a reason to drop the row.
    categories: ids(raw.categories).filter((word): word is ExtensionCategory =>
      (CATEGORIES as string[]).includes(word),
    ),
  }
}

/** A fetched index as entries. A malformed row is dropped, never fatal. */
export function parseCatalog(raw: unknown): MarketEntry[] {
  const list = isRecord(raw) && Array.isArray(raw.extensions) ? raw.extensions : []
  return list.map(parseEntry).filter(entry => entry !== null)
}

/** `fetch`, narrowed to what this module uses so a test can pass a stub. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

async function get(url: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > MAX_MANIFEST_BYTES ? null : text
  } catch {
    return null // offline, slow, refused — every one of them means "no catalog"
  }
}

/** An asset, as bytes. A grammar wasm is the reason this is not `get`. */
async function getBytes(url: string, fetcher: Fetcher): Promise<Uint8Array | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.byteLength > MAX_ASSET_BYTES ? null : bytes
  } catch {
    return null
  }
}

/** The registry as a directory URL, whatever the setting's spelling. */
const dir = (registry: string): string => (registry.endsWith('/') ? registry : `${registry}/`)

/** The published catalog, or null when it could not be read. Best-effort throughout. */
export async function fetchCatalog(
  registry = MARKET_URL,
  fetcher: Fetcher = fetch,
): Promise<MarketEntry[] | null> {
  const body = await get(`${dir(registry)}index.json`, fetcher)
  if (body === null) return null
  try {
    return parseCatalog(JSON.parse(body))
  } catch {
    return null
  }
}

export function readCachedCatalog(file = CACHE_FILE): CachedCatalog | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isRecord(raw) || typeof raw.at !== 'number') return null
    return { at: raw.at, extensions: parseCatalog(raw) }
  } catch {
    return null
  }
}

export function writeCachedCatalog(extensions: MarketEntry[], at: number, file = CACHE_FILE): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ at, extensions }))
  } catch {
    // A cache that cannot be written costs one fetch per launch, not correctness.
  }
}

export const isStale = (cached: CachedCatalog | null, now: number): boolean =>
  !cached || now - cached.at > CATALOG_MAX_AGE_MS

/** Where an installed market extension lives. One folder, so removing it is a delete. */
export const extensionDir = (id: string, root: string): string => join(root, id)

/** A manifest that has been fetched and validated, but not yet written. */
export type Fetched =
  | { ok: true; extension: Extension; body: string }
  | { ok: false; error: string }

/**
 * Fetch and validate `id`'s manifest without installing it.
 *
 * Split from the write on purpose: the confirm prompt names the commands the
 * extension would have druk spawn, and those are only knowable from the manifest
 * itself. Asking first and fetching after would mean asking about a claim the
 * catalog makes rather than about the file that is going to be installed.
 */
export async function fetchExtension(
  id: string,
  options: { registry?: string; fetcher?: Fetcher } = {},
): Promise<Fetched> {
  const { registry = MARKET_URL, fetcher = fetch } = options
  const source = `${dir(registry)}${id}/extension.json`
  const body = await get(source, fetcher)
  if (body === null) return { ok: false, error: `could not fetch ${source}` }
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (error) {
    const reason = errorMessage(error)
    return { ok: false, error: `${id} is not valid JSON: ${reason}` }
  }
  const { extension, problems } = parseManifest(raw, source)
  // Stricter than the loader, which lets an extension keep its good contributions
  // and reports the rest: a manifest from the market is validated before it is
  // merged, so anything wrong with one arriving here means the registry served
  // something other than what was reviewed.
  if (!extension || problems.length > 0) {
    return { ok: false, error: problems[0]?.reason ?? `${id} is not an extension druk can use` }
  }
  // The id decides the folder, so a manifest naming itself something else would
  // install where druk could never find it again.
  if (extension.id !== id) return { ok: false, error: `${id} declares itself "${extension.id}"` }
  return { ok: true, extension, body }
}

/**
 * Write a fetched manifest and the files it refers to. Null when it is on disk.
 *
 * Assets come down after the manifest is validated, and the manifest is what
 * says which files exist — `parseManifest` only ever collects paths inside the
 * extension's own folder, so this cannot be made to write anywhere else. A missing
 * asset fails the install rather than leaving an extension whose grammar is a path
 * to nothing.
 */
export async function writeExtension(
  id: string,
  fetched: Fetched & { ok: true },
  root: string,
  options: { registry?: string; fetcher?: Fetcher } = {},
): Promise<string | null> {
  const { registry = MARKET_URL, fetcher = fetch } = options
  const folder = extensionDir(id, root)
  const files: [string, string | Uint8Array][] = [['extension.json', fetched.body]]
  for (const asset of fetched.extension.assets) {
    // Bytes, not text: the asset that makes this worth having is a grammar
    // wasm, and decoding one as UTF-8 rewrites every byte tree-sitter needs.
    const body = await getBytes(`${dir(registry)}${id}/${asset}`, fetcher)
    if (body === null) return `${id}: could not fetch ${asset}`
    files.push([asset, body])
  }
  try {
    for (const [name, body] of files) {
      const path = join(folder, name)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, body)
    }
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

/** Delete an installed extension's folder. Null when it is gone. */
export function removeFromDisk(id: string, root: string): string | null {
  try {
    rmSync(extensionDir(id, root), { recursive: true, force: true })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

/**
 * Installed extensions the catalog has a newer version of. Ordered by the catalog,
 * so the status line and the palette agree about which one is "first".
 */
export function updatesFor(
  installed: { id: string; version: string }[],
  catalog: MarketEntry[],
  newer: (latest: string, current: string) => boolean,
): { entry: MarketEntry; current: string }[] {
  const have = new Map(installed.map(extension => [extension.id, extension.version]))
  const updates: { entry: MarketEntry; current: string }[] = []
  for (const entry of catalog) {
    const current = have.get(entry.id)
    if (current !== undefined && newer(entry.version, current)) updates.push({ entry, current })
  }
  return updates
}
