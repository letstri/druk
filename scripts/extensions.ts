import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { entryFor } from '../src/core/market'
import type { MarketEntry } from '../src/core/market'
import { parseManifest } from '../src/extensions/manifest'
import type { Extension } from '../src/extensions/types'

export const MARKET_DIR = join(import.meta.dirname, '..', 'extensions')
export const INDEX_FILE = join(MARKET_DIR, 'index.json')

export function marketIds(dir = MARKET_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}

export function readMarket(dir = MARKET_DIR): Extension[] {
  return marketIds(dir).map((id) => {
    const source = join(dir, id, 'extension.json')
    const { extension, problems } = parseManifest(
      JSON.parse(readFileSync(source, 'utf-8')),
      source
    )
    if (!extension) {
      throw new Error(`${id}: ${problems[0]?.reason ?? 'not an extension'}`)
    }
    if (problems.length > 0) {
      throw new Error(`${id}: ${problems[0]!.reason}`)
    }
    if (extension.id !== id) {
      throw new Error(`${id}: manifest declares itself "${extension.id}"`)
    }
    return extension
  })
}

export function buildIndex(dir = MARKET_DIR): { extensions: MarketEntry[] } {
  return { extensions: readMarket(dir).map(entryFor) }
}

const serialize = (index: { extensions: MarketEntry[] }): string =>
  `${JSON.stringify(index, null, 2)}\n`

if (import.meta.main) {
  const index = buildIndex()
  writeFileSync(INDEX_FILE, serialize(index))
  process.stdout.write(
    `wrote extensions/index.json — ${index.extensions.length} extensions\n`
  )
}
