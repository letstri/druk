import { afterAll, afterEach } from 'bun:test'
import { rmSync } from 'node:fs'

import { fixtures, tempDir } from './temp'

// A preload, not a `beforeAll`: `src/core/config.ts` captures `CONFIG_FILE` at module load.
process.env.XDG_CONFIG_HOME = tempDir('druk-test-config-')

process.env.DRUK_PROGRESS = '0'

process.env.DRUK_ICON_FALLBACK = '0'

process.env.XDG_DATA_HOME = tempDir('druk-test-data-')

process.env.XDG_CACHE_HOME = tempDir('druk-test-cache-')

// Dynamic on purpose: a static import hoists above the env assignments.
const { loadExtensions } = await import('../src/extensions')
loadExtensions(process.env.XDG_CONFIG_HOME!)

// `renderer.destroy()` is what runs Solid's `onCleanup`; without it watchers and timers pile up.
afterEach(async () => {
  const { liveHarnesses } = await import('./helpers')
  for (const t of liveHarnesses) t.renderer.destroy()
  liveHarnesses.clear()
})

// `afterAll`, not `afterEach`: a file may hand one fixture to several tests.
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true })
  fixtures.clear()
})
