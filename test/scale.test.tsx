// The Zig core stops handing out renderables a few thousand in: an unwindowed `<For>` is empty.
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { statusMap } from '../src/core/git'
import { launch, press, settle } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

const OVER_THE_CEILING = 6000

function wideDir(count: number) {
  const dir = tempDir('druk-scale-tree-')
  mkdirSync(join(dir, 'many'))
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, 'many', `f${i}.ts`), 'x\n')
  }
  return dir
}

const nthEntry = (count: number, index: number) =>
  Array.from({ length: count }, (_, i) => `f${i}.ts`).toSorted((a, b) =>
    a.localeCompare(b)
  )[index]!

describe('the file tree', () => {
  // A fixture per test: the session is keyed by project path and restores the last one's state.
  test('expands a directory far larger than the renderable ceiling', async () => {
    const t = await launch(wideDir(OVER_THE_CEILING))
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())
    await settle(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('many')
    expect(frame).toContain(nthEntry(OVER_THE_CEILING, 0))
  }, 120_000)

  test('the selection still scrolls into view deep inside a big directory', async () => {
    const t = await launch(wideDir(OVER_THE_CEILING))
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())
    for (let step = 0; step < 60; step += 1) {
      await press(t, (input) => input.pressArrow('down'))
    }

    const frame = t.captureCharFrame()
    expect(frame).toContain(nthEntry(OVER_THE_CEILING, 59))
    expect(frame).not.toContain(` ${nthEntry(OVER_THE_CEILING, 0)} `)
  }, 120_000)
})

describe('git output size', () => {
  test('a status listing past the default pipe buffer is not read as "no changes"', () => {
    // spawnSync truncates at 1 MB with ENOBUFS, which core/git.ts reads as empty output.
    const dir = tempDir('druk-scale-status-')
    initRepo(dir)
    const name = (i: number) =>
      `f${String(i).padStart(6, '0')}-${'n'.repeat(100)}.ts`
    const count = 9000
    mkdirSync(join(dir, 'many'))
    writeFileSync(join(dir, 'many', '.keep'), '')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@e.com',
        '-c',
        'user.name=T',
        'commit',
        '-qm',
        'init',
      ],
      {
        cwd: dir,
      }
    )
    for (let i = 0; i < count; i += 1) {
      writeFileSync(join(dir, 'many', name(i)), 'x\n')
    }

    const statuses = statusMap(dir)
    expect(statuses.size).toBe(count)
    expect(statuses.get(join(dir, 'many', name(count - 1)))).toBe('untracked')
  }, 120_000)
})
