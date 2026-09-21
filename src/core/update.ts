import fs from 'node:fs'
import { dirname, join } from 'node:path'

const REGISTRY = 'https://registry.npmjs.org/druk/latest'
const TIMEOUT_MS = 2500

export interface UpdateInfo {
  current: string
  latest: string
}

// Defined by build.ts; absent from source, hence the typeof guard below.
declare const __DRUK_VERSION__: string

export function currentVersion(): string {
  if (typeof __DRUK_VERSION__ === 'string') {
    return __DRUK_VERSION__
  }

  let dir = import.meta.dirname
  for (let i = 0; i < 5; i += 1) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(join(dir, 'package.json'), 'utf-8')
      )
      if (pkg?.name === 'druk' && typeof pkg.version === 'string') {
        return pkg.version
      }
    } catch {
      // No package.json here; the parent may have it.
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
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

export async function checkForUpdate(
  current = currentVersion()
): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(REGISTRY, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return null
    }
    const latest = ((await res.json()) as { version?: unknown }).version
    if (typeof latest !== 'string' || !isNewer(latest, current)) {
      return null
    }
    return { current, latest }
  } catch {
    return null
  }
}
