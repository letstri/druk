import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { parseManifest } from '../extensions/manifest'
import { CATEGORIES } from '../extensions/types'
import type { Extension, ExtensionCategory } from '../extensions/types'
// Never import `../extensions` here: it reads `core/config`, which reads MARKET_URL from this file.
import { errorMessage } from './errors'

// A manifest URL is always `<registry><id>/extension.json`: the index carries ids, nothing fetchable.
export const MARKET_URL = 'https://raw.githubusercontent.com/letstri/druk/main/extensions/'

const TIMEOUT_MS = 2500

const MAX_MANIFEST_BYTES = 512 * 1024

const MAX_ASSET_BYTES = 8 * 1024 * 1024

const ASSET_TIMEOUT_MS = 30_000

const CATALOG_MAX_AGE_MS = 30 * 60 * 1000

export interface MarketEntry {
  id: string
  name: string
  version: string
  description: string
  provides: {
    themes: string[]
    icons: string[]
    filetypes: string[]
    extensions: string[]
  }
  categories: ExtensionCategory[]
}

export interface CachedCatalog {
  at: number
  extensions: MarketEntry[]
}

const CACHE_FILE = join(
  process.env.XDG_CACHE_HOME ?? join(os.homedir(), '.cache'),
  'druk',
  'market.json',
)

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
      extensions: [...new Set(extension.languages.flatMap(language => language.extensions ?? []))],
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
  // The id names a directory in the registry and a folder on disk: hold it to a file name's shape.
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
      extensions: ids(provides.extensions),
    },
    categories: ids(raw.categories).filter((word): word is ExtensionCategory =>
      (CATEGORIES as string[]).includes(word),
    ),
  }
}

export function parseCatalog(raw: unknown): MarketEntry[] {
  const list = isRecord(raw) && Array.isArray(raw.extensions) ? raw.extensions : []
  return list.map(parseEntry).filter(entry => entry !== null)
}

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
    return null
  }
}

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

const dir = (registry: string): string => (registry.endsWith('/') ? registry : `${registry}/`)

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
    // best-effort
  }
}

export const isStale = (cached: CachedCatalog | null, now: number): boolean =>
  !cached || now - cached.at > CATALOG_MAX_AGE_MS

const extensionDir = (id: string, root: string): string => join(root, id)

export type Fetched =
  | { ok: true; extension: Extension; body: string }
  | { ok: false; error: string }

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
  // Validated before anything is written: druk never stores a manifest it would reject at load.
  if (!extension || problems.length > 0) {
    return { ok: false, error: problems[0]?.reason ?? `${id} is not an extension druk can use` }
  }
  // The id decides the folder: one naming itself otherwise installs where druk cannot find it.
  if (extension.id !== id) return { ok: false, error: `${id} declares itself "${extension.id}"` }
  return { ok: true, extension, body }
}

// Safe only while `parseManifest` collects paths inside the extension's own folder.
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
    // Bytes, not text: decoding a grammar wasm as UTF-8 rewrites it.
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

export function removeFromDisk(id: string, root: string): string | null {
  try {
    rmSync(extensionDir(id, root), { recursive: true, force: true })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

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
