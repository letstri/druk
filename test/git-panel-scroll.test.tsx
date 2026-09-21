import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ctrlOpt, fixture, launch, press, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const TOGGLE = ctrlOpt('g')

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString())
  }
}

const NAMES = Array.from(
  { length: 120 },
  (_, index) => `f${String(index).padStart(3, '0')}.ts`
)

function repo() {
  const dir = fixture(
    Object.fromEntries(NAMES.map((name) => [name, 'before\n']))
  )
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  for (const name of NAMES) {
    writeFileSync(join(dir, name), 'after\n')
  }
  return dir
}

const sidebar = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3, -1)
    .map((row) => row.slice(0, 30))
    .join('\n')

async function openPanel() {
  const t = await launch(repo(), {}, { height: 24, width: 100 })
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await settle(t, 200)
  return t
}

async function scrollDown(t: Harness, ticks: number) {
  for (let n = 0; n < ticks; n += 1) {
    await t.mockMouse.scroll(4, 8, 'down')
  }
  await settle(t)
}

describe('the source-control panel scrolls', () => {
  test('the wheel moves the change list', async () => {
    const t = await openPanel()
    expect(sidebar(t)).toContain('f000.ts')

    await scrollDown(t, 20)

    const scrolled = sidebar(t)
    expect(scrolled).not.toContain('f000.ts')
    expect(scrolled).toContain('f0')
  })

  test('a cursor driven past the fold comes back into view', async () => {
    const t = await openPanel()

    await pressTimes(t, 40, (i) => i.pressArrow('down'))
    await settle(t, 50)

    expect(sidebar(t)).toContain('f040.ts')
  }, 30_000)

  test('a scrolled panel is not yanked back by a git refresh', async () => {
    const t = await openPanel()
    await scrollDown(t, 20)
    const scrolled = sidebar(t)

    // Fixed wait: the watcher's rebuild of the row array must not snap the view to the top.
    await settle(t, 600)

    expect(sidebar(t)).toBe(scrolled)
  })

  test('a save elsewhere in the repo leaves the scrolled panel where it was', async () => {
    const dir = repo()
    const t = await launch(dir, {}, { height: 24, width: 100 })
    await press(t, (i) => i.pressKeys([TOGGLE]))
    await settle(t, 200)
    await scrollDown(t, 20)
    const scrolled = sidebar(t)
    expect(scrolled).not.toContain('f000.ts')

    writeFileSync(join(dir, NAMES[0]!), 'changed again\n')
    for (let n = 0; n < 6; n += 1) {
      await settle(t, 250)
      expect(sidebar(t)).toBe(scrolled)
    }
  }, 30_000)
})
