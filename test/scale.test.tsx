/**
 * Guards against unbounded rendering. OpenTUI builds a native renderable per JSX
 * element and the Zig core stops handing them out a few thousand in — a `<For>`
 * over a whole data set does not merely get slow, it comes back empty. Every test
 * here feeds in more rows than that ceiling and asserts the view still renders, so
 * each one fails outright if its window is removed.
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { statusMap } from '../src/core/git'
import { launch, press, settle } from './helpers'
import { tempDir } from './temp'

/** Past the point where an unwindowed view exhausts the core's renderables. */
const OVER_THE_CEILING = 6000

function wideDir(count: number) {
  const dir = tempDir('druk-scale-tree-')
  mkdirSync(join(dir, 'many'))
  for (let i = 0; i < count; i++) writeFileSync(join(dir, 'many', `f${i}.ts`), 'x\n')
  return dir
}

/** The tree sorts with localeCompare, so row 60 is not `f60.ts`. */
const nthEntry = (count: number, index: number) =>
  Array.from({ length: count }, (_, i) => `f${i}.ts`).toSorted((a, b) => a.localeCompare(b))[index]!

describe('the file tree', () => {
  // Not shared between tests: the session is keyed by project path, so a second
  // launch of the same directory restores the first test's expanded state.
  test('expands a directory far larger than the renderable ceiling', async () => {
    const t = await launch(wideDir(OVER_THE_CEILING))
    await press(t, input => input.pressArrow('down')) // select many/
    await press(t, input => input.pressEnter())
    await settle(t)

    // Unwindowed, the core runs out of renderables and the tree paints nothing.
    const frame = t.captureCharFrame()
    expect(frame).toContain('many')
    expect(frame).toContain(nthEntry(OVER_THE_CEILING, 0))
  }, 120000)

  test('the selection still scrolls into view deep inside a big directory', async () => {
    const t = await launch(wideDir(OVER_THE_CEILING))
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressEnter())
    for (let step = 0; step < 60; step++) await press(t, input => input.pressArrow('down'))

    // Row 60 is well past the first screen, so the window had to move with it.
    const frame = t.captureCharFrame()
    expect(frame).toContain(nthEntry(OVER_THE_CEILING, 59))
    expect(frame).not.toContain(` ${nthEntry(OVER_THE_CEILING, 0)} `)
  }, 120000)
})

describe('git output size', () => {
  test('a status listing past the default pipe buffer is not read as "no changes"', () => {
    // spawnSync truncates at 1 MB and reports ENOBUFS, which every caller in
    // core/git.ts reads as empty output — the tree would show no marks at all in a
    // repository with a lot of changed files. `statusMap` is the caller with the
    // largest output now that druk runs no diffs of its own.
    const dir = tempDir('druk-scale-status-')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })

    // ~130 bytes of porcelain per entry, so this clears 1 MB comfortably.
    const name = (i: number) => `f${String(i).padStart(6, '0')}-${'n'.repeat(100)}.ts`
    const count = 9000
    mkdirSync(join(dir, 'many'))
    // One tracked file inside it, or git folds the whole untracked directory into a
    // single `?? many/` line and there is nothing large to read.
    writeFileSync(join(dir, 'many', '.keep'), '')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'init'],
      {
        cwd: dir,
      },
    )
    for (let i = 0; i < count; i++) writeFileSync(join(dir, 'many', name(i)), 'x\n')

    const statuses = statusMap(dir)
    expect(statuses.size).toBe(count)
    expect(statuses.get(join(dir, 'many', name(count - 1)))).toBe('untracked')
  }, 120000)
})
