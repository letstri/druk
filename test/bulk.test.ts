import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { copyAll, moveAll, removeAll } from '../src/core/bulk'
import type { BulkProgress } from '../src/core/bulk'
import { tempDir } from './temp'

/** A directory of `count` packages, each with a file inside — a small node_modules. */
function heavyDir(count: number) {
  const base = tempDir('druk-bulk-')
  const dir = join(base, 'node_modules')
  for (let index = 0; index < count; index++) {
    mkdirSync(join(dir, `pkg-${index}`), { recursive: true })
    writeFileSync(join(dir, `pkg-${index}`, 'index.js'), 'module.exports = 1\n')
  }
  return { base, dir }
}

describe('deleting in the background', () => {
  test('reports progress as it goes, not once at the end', async () => {
    const { dir } = heavyDir(12)
    const seen: BulkProgress[] = []

    const { failed } = await removeAll([dir], progress => seen.push({ ...progress }))

    expect(failed).toEqual([])
    expect(existsSync(dir)).toBe(false)
    // One tick per entry: a single call at the end would be a frozen editor.
    expect(seen.length).toBe(12)
    expect(seen.at(-1)).toMatchObject({ done: 12, total: 12 })
  })

  test('several targets share one count — done never passes total', async () => {
    const a = heavyDir(3)
    const b = heavyDir(4)
    const seen: BulkProgress[] = []

    await removeAll([a.dir, b.dir], progress => seen.push({ ...progress }))

    // A per-target total read as "Deleting 5/4" the moment the second target began.
    for (const progress of seen) expect(progress.done).toBeLessThanOrEqual(progress.total)
    expect(seen.at(-1)).toMatchObject({ done: 7, total: 7 })
  })

  test('counts up one entry at a time', async () => {
    const { dir } = heavyDir(5)
    const seen: BulkProgress[] = []

    await removeAll([dir], progress => seen.push({ ...progress }))

    expect(seen.map(p => p.done)).toEqual([1, 2, 3, 4, 5])
  })

  test('hands the loop back between entries', async () => {
    const { dir } = heavyDir(8)
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)

    await removeAll([dir], () => {})
    clearInterval(timer)

    // A synchronous rm would starve the timer entirely, which is exactly what
    // made the editor look hung while a large folder was deleted.
    expect(ticks).toBeGreaterThan(0)
  })

  test('a file target is one unit, and still disappears', async () => {
    const { base } = heavyDir(1)
    const file = join(base, 'lonely.ts')
    writeFileSync(file, 'x\n')
    const seen: BulkProgress[] = []

    await removeAll([file], progress => seen.push({ ...progress }))

    expect(existsSync(file)).toBe(false)
    expect(seen).toHaveLength(1)
  })

  test('keeps going past something it cannot delete', async () => {
    const { base } = heavyDir(1)
    const { failed, done } = await removeAll([join(base, 'nothing-here')], () => {})

    // `force` makes a missing path a no-op rather than a failure.
    expect(failed).toEqual([])
    expect(done).toBe(1)
  })
})

describe('copying and moving in the background', () => {
  test('copy reports one tick per target and lands them all', async () => {
    const { base, dir } = heavyDir(3)
    const into = join(base, 'dest')
    const seen: BulkProgress[] = []

    const { done } = await copyAll(
      [join(dir, 'pkg-0'), join(dir, 'pkg-1')],
      into,
      (target, name) => join(target, name),
      progress => seen.push({ ...progress }),
    )

    expect(done).toBe(2)
    expect(seen.map(p => p.done)).toEqual([1, 2])
    expect(existsSync(join(into, 'pkg-0', 'index.js'))).toBe(true)
    expect(existsSync(join(into, 'pkg-1', 'index.js'))).toBe(true)
  })

  test('move takes the entries out of the old place', async () => {
    const { base, dir } = heavyDir(2)
    const into = join(base, 'dest')

    const { done, failed } = await moveAll(
      [join(dir, 'pkg-0')],
      into,
      (target, name) => join(target, name),
      () => {},
    )

    expect({ done, failed }).toEqual({ done: 1, failed: [] })
    expect(existsSync(join(dir, 'pkg-0'))).toBe(false)
    expect(existsSync(join(into, 'pkg-0', 'index.js'))).toBe(true)
  })

  test('one bad target does not abandon the rest', async () => {
    const { base, dir } = heavyDir(2)
    const into = join(base, 'dest')

    const { done, failed } = await copyAll(
      [join(dir, 'missing'), join(dir, 'pkg-1')],
      into,
      (target, name) => join(target, name),
      () => {},
    )

    expect(done).toBe(1)
    expect(failed).toEqual(['missing'])
  })
})
