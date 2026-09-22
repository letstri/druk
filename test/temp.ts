import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const fixtures = new Set<string>()

// Never `mkdtempSync` directly: a raw one is not in the sweep and leaks for good.
export function tempDir(prefix = 'druk-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  fixtures.add(dir)
  return dir
}

// An undestroyed harness keeps `App`'s fs watchers and git timers alive for the process.
// Here rather than in `helpers` so `setup.ts`'s afterEach need not import the app graph — 440ms
// in every file that never launches one.
export const liveHarnesses = new Set<{ renderer: { destroy: () => void } }>()
