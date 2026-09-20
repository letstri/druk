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
