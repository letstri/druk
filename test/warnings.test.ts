import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

// A subprocess: the default printer is process-wide, and this process's is the runner's.
test('a runtime warning goes to the log file and not to stderr', () => {
  const log = join(tempDir('druk-warn-'), 'state', 'druk.log')
  const result = Bun.spawnSync(['bun', 'test/fixtures/warn.ts', log])

  expect(result.stderr.toString()).toBe('')
  expect(existsSync(log)).toBe(true)
  const written = readFileSync(log, 'utf-8')
  expect(written).toContain('MaxListenersExceededWarning')
  expect(written).toContain('fixtures/warn.ts')
})
