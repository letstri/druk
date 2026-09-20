import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'https://registry.npmjs.org/druk/latest'
const TIMEOUT_MS = 2500

export interface UpdateInfo {
  current: string
  latest: string
}

// Defined by build.ts; absent from source, hence the typeof guard below.
declare const __DRUK_VERSION__: string

export function currentVersion(): string {
  if (typeof __DRUK_VERSION__ === 'string') return __DRUK_VERSION__

  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg?.name === 'druk' && typeof pkg.version === 'string') return pkg.version
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}

export function isNewer(latest: string, current: string): boolean {
  try {
    return Bun.semver.order(latest, current) === 1
  } catch {
    // `order` throws on anything unparseable, and `latest` comes off the network.
    return false
  }
}

export async function checkForUpdate(current = currentVersion()): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(REGISTRY, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const latest = ((await res.json()) as { version?: unknown }).version
    if (typeof latest !== 'string' || !isNewer(latest, current)) return null
    return { current, latest }
  } catch {
    return null
  }
}
