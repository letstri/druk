import { afterAll, afterEach } from 'bun:test'
import { rmSync } from 'node:fs'

import { fixtures, liveHarnesses, tempDir } from './temp'

// A preload, not a `beforeAll`: `src/core/config.ts` captures `CONFIG_FILE` at module load.
process.env.XDG_CONFIG_HOME = tempDir('druk-test-config-')

process.env.DRUK_PROGRESS = '0'

process.env.DRUK_ICON_FALLBACK = '0'

// No test may touch the machine's real clipboard: the suite runs while someone is using it.
process.env.DRUK_CLIPBOARD = 'off'

// No test may hand a URL to the desktop: a fixture's commit is a 404 in a real browser tab.
process.env.DRUK_BROWSER = 'off'

process.env.XDG_DATA_HOME = tempDir('druk-test-data-')

process.env.XDG_CACHE_HOME = tempDir('druk-test-cache-')

// Dynamic on purpose: a static import hoists above the env assignments.
const { loadExtensions } = await import('../src/extensions')
loadExtensions(process.env.XDG_CONFIG_HOME!)

// `renderer.destroy()` is what runs Solid's `onCleanup`; without it watchers and timers pile up.
afterEach(() => {
  for (const t of liveHarnesses) {
    t.renderer.destroy()
  }
  liveHarnesses.clear()
})

// `afterAll`, not `afterEach`: a file may hand one fixture to several tests.
afterAll(() => {
  for (const dir of fixtures) {
    rmSync(dir, { force: true, recursive: true })
  }
  fixtures.clear()
})
