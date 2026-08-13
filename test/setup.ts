import { afterAll, afterEach } from 'bun:test'
import { rmSync } from 'node:fs'

// Static, unlike the imports below: `temp.ts` is `node:fs`/`node:os`/`node:path`
// and nothing else, so hoisting it above the env assignments captures nothing.
import { fixtures, tempDir } from './temp'

/**
 * Give every test process its own config home, before anything reads it.
 *
 * Two reasons, and the second is what makes `--parallel` safe. `src/core/config.ts`
 * resolves `CONFIG_FILE` from this at module load, and `sessions.json` is a single
 * file rewritten whole on every tab change — so without this the suite wrote to the
 * developer's real `~/.config/druk`, and parallel workers would clobber each other's
 * sessions mid-write.
 *
 * A preload, not a `beforeAll`: the path is captured when the module is first
 * imported, which happens before any hook runs.
 */
process.env.XDG_CONFIG_HOME = tempDir('druk-test-config-')

/**
 * OSC 9;4 would light the developer's terminal tab for every busy operation the
 * suite drives. `src/core/progress.ts` honours this the way appearance honours
 * `DRUK_OS_APPEARANCE`.
 */
process.env.DRUK_PROGRESS = '0'

/**
 * Same idea for the data home, which is where `src/lsp/install.ts` puts servers
 * druk installed. Without it a developer who once accepted an install would have
 * `installedCommand` answer for a real binary, and the suite would spawn it.
 */
process.env.XDG_DATA_HOME = tempDir('druk-test-data-')

/**
 * And the cache home, where `src/core/market.ts` keeps the extension catalog. A
 * developer who has run druk would otherwise have a real catalog on disk, and
 * the market tests would be asserting against whatever the registry published
 * that day.
 */
process.env.XDG_CACHE_HOME = tempDir('druk-test-cache-')

/**
 * Register the extensions druk ships inside the binary — its languages, and so the
 * highlighting almost every test depends on.
 *
 * `main.tsx` does this before rendering; a test that mounts `<App/>` never goes
 * through it, so without this a test process starts with an empty language
 * registry and every file renders plain. A market extension is a test's own to
 * install (`loadMarketExtensions`, or a manifest written into the extensions folder).
 *
 * Dynamically imported on purpose: a static import hoists above the environment
 * assignments up there, and `src/core/config` captures `CONFIG_FILE` when it is
 * first evaluated.
 */
const { loadExtensions } = await import('../src/extensions')
// The config home, not a directory of its own: `loadExtensions` only reads
// `<rootDir>/.druk/extensions` off this argument, and the suite already leaves
// enough behind in the temp folder — a stray directory per test process is how
// a run ends up walking tens of thousands of them.
loadExtensions(process.env.XDG_CONFIG_HOME!)

/**
 * Destroy every harness a test `launch()`ed and didn't clean up itself.
 *
 * `renderer.destroy()` is what runs Solid's `onCleanup` — closing `App`'s fs
 * watchers and stopping its git-polling timers. Without this sweep those stay
 * open for the rest of the worker process's life, so a file with many `launch()`
 * calls compounds watchers/timers test over test until the process stalls or
 * gets OOM-killed.
 */
afterEach(async () => {
  // Imported lazily, on purpose: a static import would hoist `helpers` — and,
  // through <App/>, `src/core/config.ts` — above the env assignment, capturing
  // the developer's real ~/.config/druk as CONFIG_FILE for the whole process.
  const { liveHarnesses } = await import('./helpers')
  for (const t of liveHarnesses) t.renderer.destroy()
  liveHarnesses.clear()
})

/**
 * Delete the temp directories this file made.
 *
 * A full run creates some three thousand temp projects, and nothing used to
 * remove them: after a few dozen runs the temp folder held ~100k directories,
 * every `mkdtemp` in it slowed down, and whole test files began timing out and
 * being killed — failures that look like flaky tests and are not. `afterAll`
 * rather than `afterEach`, since a file may hand one fixture to several tests.
 *
 * Only what `tempDir()` made: a raw `mkdtempSync` is invisible here and leaks.
 */
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true })
  fixtures.clear()
})
