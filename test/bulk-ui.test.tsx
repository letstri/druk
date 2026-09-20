import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

function project(packages: number) {
  const dir = tempDir('druk-bulkui-')
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  for (let index = 0; index < packages; index++) {
    mkdirSync(join(dir, 'node_modules', `pkg-${index}`), { recursive: true })
    writeFileSync(join(dir, 'node_modules', `pkg-${index}`, 'index.js'), 'x\n')
  }
  return dir
}

const bar = (t: Harness) => t.captureCharFrame().split('\n').at(-2) ?? ''

describe('deleting a large folder', () => {
  test('shows progress while it runs instead of freezing', async () => {
    const dir = project(400)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('d'))
    await press(t, input => input.pressEnter())

    await settle(t, 60)
    const during = bar(t)
    expect(during).toContain('Deleting')

    await press(t, input => input.pressArrow('down'))
    expect(t.captureCharFrame()).toContain('EXPLORER')
  }, 30000)

  test('finishes, reports it, and the folder is gone', async () => {
    const dir = project(25)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('d'))
    await press(t, input => input.pressEnter())
    for (let waited = 0; waited < 5000 && !bar(t).includes('Deleted'); waited += 100) {
      await settle(t, 100)
    }

    expect(bar(t)).toContain('Deleted')
    expect(bar(t)).not.toContain('Deleting')
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)
  }, 30000)
})
