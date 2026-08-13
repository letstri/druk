import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Every temp directory this process made, deleted when it exits.
 *
 * A run of the suite creates some three thousand of these, and nothing used to
 * remove them: after a few dozen runs the temp folder held ~100k directories and
 * every `mkdtemp` in it slowed down, until whole test files started timing out
 * and being killed. `test/setup.ts` empties this in a global `afterAll` — once
 * per file rather than per test, since a file may hand one directory to several.
 */
export const fixtures = new Set<string>()

/**
 * A temp directory registered for that sweep. Every test that needs one goes
 * through this rather than calling `mkdtempSync` itself — a raw one leaks for
 * good, and the git tests, which each build a repository, once left 60k
 * directories behind and started failing with `ENOENT` on their own files.
 *
 * Register the *outermost* directory: a helper that builds a base holding
 * `origin.git`, `mine` and `theirs` makes one `tempDir` and joins onto it.
 *
 * This lives here rather than in `helpers.tsx` so a unit test can have it
 * without pulling in `<App/>`.
 */
export function tempDir(prefix = 'druk-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  fixtures.add(dir)
  return dir
}
