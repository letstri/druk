import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fetchCatalog,
  fetchExtension,
  isStale,
  MARKET_URL,
  parseCatalog,
  readCachedCatalog,
  removeFromDisk,
  updatesFor,
  writeCachedCatalog,
  writeExtension,
} from '../src/core/market'
import type { Fetcher, MarketEntry } from '../src/core/market'
import { isNewer } from '../src/core/update'
import { loadExtensions } from '../src/extensions'
import { tempDir } from './temp'

const REGISTRY = 'https://example.test/extensions/'

const MANIFEST = {
  id: 'nim',
  name: 'Nim',
  version: '1.2.0',
  description: 'nimlangserver',
  languageServers: [{ id: 'nim', command: ['nimlangserver'], filetypes: ['nim'] }],
}

const INDEX = {
  extensions: [
    {
      id: 'nim',
      name: 'Nim',
      version: '1.2.0',
      description: 'nimlangserver',
      provides: { themes: [], icons: [], filetypes: ['nim'] },
      categories: ['language', 'lsp'],
    },
  ],
}

/** A fetcher answering from a fixed url → body map; anything else 404s. */
const serving = (bodies: Record<string, unknown>, seen: string[] = []): Fetcher =>
  (url => {
    seen.push(url)
    const body = bodies[url]
    return Promise.resolve(
      body === undefined
        ? new Response('nope', { status: 404 })
        : new Response(typeof body === 'string' ? body : JSON.stringify(body)),
    )
  }) as Fetcher

const temp = (name: string) => tempDir(`druk-${name}-`)

test('a malformed catalog row is dropped, not fatal', () => {
  const parsed = parseCatalog({
    extensions: [
      { id: 'ok', version: '1.0.0' },
      { id: 'no version' },
      { id: 'sp ace', version: '1.0.0' },
      'not an object',
    ],
  })
  expect(parsed.map(entry => entry.id)).toEqual(['ok'])
  // The gaps are filled rather than left undefined: every reader shows these.
  expect(parsed[0]).toEqual({
    id: 'ok',
    name: 'ok',
    version: '1.0.0',
    description: '',
    provides: { themes: [], icons: [], filetypes: [] },
    categories: [],
  })
})

test('the catalog is read from the registry directory', async () => {
  const seen: string[] = []
  const catalog = await fetchCatalog(REGISTRY, serving({ [`${REGISTRY}index.json`]: INDEX }, seen))
  expect(seen).toEqual([`${REGISTRY}index.json`])
  expect(catalog?.map(entry => entry.id)).toEqual(['nim'])
})

test('a registry that answers with nothing usable leaves no catalog', async () => {
  expect(await fetchCatalog(REGISTRY, serving({}))).toBeNull()
  expect(
    await fetchCatalog(REGISTRY, serving({ [`${REGISTRY}index.json`]: '{ not json' })),
  ).toBeNull()
})

test("druk's own registry is the default, and it is https", () => {
  expect(MARKET_URL.startsWith('https://')).toBe(true)
  expect(MARKET_URL.endsWith('/')).toBe(true)
})

test('a manifest is fetched from <registry><id>/extension.json and validated', async () => {
  const seen: string[] = []
  const result = await fetchExtension('nim', {
    registry: REGISTRY,
    fetcher: serving({ [`${REGISTRY}nim/extension.json`]: MANIFEST }, seen),
  })
  expect(seen).toEqual([`${REGISTRY}nim/extension.json`])
  expect(result.ok && result.extension.servers[0]?.command).toEqual(['nimlangserver'])
})

test('a manifest druk would reject is refused before anything is written', async () => {
  for (const body of [
    { id: 'nim' }, // contributes nothing
    { id: 'other', languageServers: [{ id: 'nim', command: ['x'], filetypes: ['nim'] }] }, // wrong id
    'not json at all',
  ]) {
    const result = await fetchExtension('nim', {
      registry: REGISTRY,
      fetcher: serving({ [`${REGISTRY}nim/extension.json`]: body }),
    })
    expect(result.ok).toBe(false)
  }
})

/** `fetchExtension`'s answer for a manifest, without going through a fetch. */
async function fetchedOk(manifest: unknown, id = 'nim') {
  const result = await fetchExtension(id, {
    registry: REGISTRY,
    fetcher: serving({ [`${REGISTRY}${id}/extension.json`]: manifest }),
  })
  if (!result.ok) throw new Error(result.error)
  return result
}

test('a fetched manifest is written where loadExtensions finds it', async () => {
  const root = temp('extensions')
  const project = temp('project')
  expect(await writeExtension('nim', await fetchedOk(MANIFEST), root)).toBeNull()
  expect(JSON.parse(readFileSync(join(root, 'nim', 'extension.json'), 'utf8'))).toEqual(MANIFEST)

  // The folder shape is the one the loader walks — that is the whole contract
  // between an install and the next startup.
  const load = loadExtensions(project, [], root)
  expect(load.problems).toEqual([])
  // Beside the extensions druk ships inside the binary, which are always loaded.
  expect(
    load.extensions.filter(extension => !extension.builtin).map(extension => extension.id),
  ).toEqual(['nim'])

  expect(removeFromDisk('nim', root)).toBeNull()
  expect(existsSync(join(root, 'nim'))).toBe(false)
  // Removing one that is already gone is not an error: the palette and the
  // filesystem can disagree, and the answer to both is the same.
  expect(removeFromDisk('nim', root)).toBeNull()
})

test('the cache survives a round trip and knows when it is old', () => {
  const file = join(temp('cache'), 'market.json')
  expect(readCachedCatalog(file)).toBeNull()
  expect(isStale(null, 1000)).toBe(true)

  writeCachedCatalog(INDEX.extensions as MarketEntry[], 1000, file)
  const cached = readCachedCatalog(file)
  expect(cached?.extensions.map(entry => entry.id)).toEqual(['nim'])
  expect(isStale(cached, 1000 + 60_000)).toBe(false)
  expect(isStale(cached, 1000 + 7 * 60 * 60 * 1000)).toBe(true)
})

test('only an installed extension with a lower version is an update', () => {
  const catalog = INDEX.extensions as MarketEntry[]
  expect(updatesFor([{ id: 'nim', version: '1.1.0' }], catalog, isNewer)).toHaveLength(1)
  expect(updatesFor([{ id: 'nim', version: '1.2.0' }], catalog, isNewer)).toEqual([])
  expect(updatesFor([{ id: 'nim', version: '2.0.0' }], catalog, isNewer)).toEqual([])
  // Not installed is not an update — it is an offer, and a different question.
  expect(updatesFor([], catalog, isNewer)).toEqual([])
})
