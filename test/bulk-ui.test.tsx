import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** A folder with enough entries that the delete spans several frames. */
function project(packages: number) {
  const dir = tempDir('druk-bulkui-')
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  for (let index = 0; index < packages; index++) {
    mkdirSync(join(dir, 'node_modules', `pkg-${index}`), { recursive: true })
    writeFileSync(join(dir, 'node_modules', `pkg-${index}`, 'index.js'), 'x\n')
  }
  return dir
}

/** The status row: the frame ends with a trailing newline, so it is the last but one. */
const bar = (t: Harness) => t.captureCharFrame().split('\n').at(-2) ?? ''

describe('deleting a large folder', () => {
  test('shows progress while it runs instead of freezing', async () => {
    // Large enough that the delete spans many frames: with 40 entries it was
    // over before the first sample, which proved nothing either way.
    const dir = project(400)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down')) // a.ts? node_modules sorts first
    await press(t, input => void input.typeText('d'))
    await press(t, input => input.pressEnter())

    // Mid-flight: the bar is counting rather than showing the last message.
    await settle(t, 60)
    const during = bar(t)
    expect(during).toContain('Deleting')

    // And the editor is still answering keys while the work goes on.
    await press(t, input => input.pressArrow('down'))
    expect(t.captureCharFrame()).toContain('explorer')
  }, 30000)

  test('finishes, reports it, and the folder is gone', async () => {
    const dir = project(25)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('d'))
    await press(t, input => input.pressEnter())
    // Poll instead of one long sleep: the delete usually finishes much sooner.
    for (let waited = 0; waited < 5000 && !bar(t).includes('Deleted'); waited += 100) {
      await settle(t, 100)
    }

    expect(bar(t)).toContain('Deleted')
    expect(bar(t)).not.toContain('Deleting')
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)
  }, 30000)
})
