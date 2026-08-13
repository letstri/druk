import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { searchProject } from '../src/core/search'
import { fixture, launch, openFile, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** A project big enough that one scan is unmistakably slower than one keystroke. */
function corpus(count: number) {
  const dir = tempDir('druk-corpus-')
  for (let i = 0; i < count; i++) {
    const sub = join(dir, `pkg${i % 40}`)
    mkdirSync(sub, { recursive: true })
    writeFileSync(
      join(sub, `f${i}.ts`),
      Array.from({ length: 40 }, (_, l) => `export const value${l} = ${l}`).join('\n'),
    )
  }
  return dir
}

const summaryRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .find(row => row.includes('Searching') || / of \d/.test(row) || row.includes('No matches')) ??
  ''

describe('project search waits for the typing to settle', () => {
  test('says so while the scan is pending, then shows the count', async () => {
    const t = await launch(fixture({ 'a.ts': 'hello world\n', 'b.ts': 'hello again\n' }))
    await runCommand(t, 'In project')

    await press(t, input => void input.typeText('hello'))
    expect(summaryRow(t)).toContain('Searching')

    await settle(t, 300)
    expect(summaryRow(t)).toMatch(/1 of \d/)
    expect(t.captureCharFrame()).toContain('a.ts')
  })

  test('a whole query costs one scan, not one per character', async () => {
    const dir = corpus(2000)

    // What a single scan of this tree costs, measured the same way the panel does it.
    const started = performance.now()
    searchProject(dir, 'zzzznomatch')
    const oneScan = performance.now() - started

    const t = await launch(dir)
    await runCommand(t, 'In project')

    const typing = performance.now()
    await press(t, input => void input.typeText('value7'))
    const elapsed = performance.now() - typing

    // Six characters used to mean six scans. Generous bound so a loaded CI box
    // cannot flake it, but far below the 6× a per-keystroke scan would cost.
    expect(elapsed).toBeLessThan(oneScan * 3)

    await settle(t, 400)
    expect(summaryRow(t)).toMatch(/of \d/)
  }, 120000)

  test('in-file search stays immediate — it only touches the open buffer', async () => {
    const t = await launch(fixture({ 'a.ts': 'alpha\nbeta alpha\n' }))
    await openFile(t, 'a.ts')

    await press(t, input => input.pressKey('f', { ctrl: true }))
    await press(t, input => void input.typeText('alpha'))

    // No waiting: a debounce here would be a regression, not a fix.
    expect(summaryRow(t)).toMatch(/1 of 2/)
  })
})
