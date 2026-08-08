import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

const NAMES = Array.from({ length: 120 }, (_, index) => `f${String(index).padStart(3, '0')}.ts`)

/** A repository where every file is modified, so the change list outruns the panel. */
function repo() {
  const dir = fixture(Object.fromEntries(NAMES.map(name => [name, 'before\n'])))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  for (const name of NAMES) writeFileSync(join(dir, name), 'after\n')
  return dir
}

/** The sidebar's rows, below the tab strip and the panel header. */
const sidebar = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3, -1)
    .map(row => row.slice(0, 30))
    .join('\n')

async function openPanel() {
  const t = await launch(repo(), {}, { width: 100, height: 24 })
  await press(t, i => void i.pressKeys([TOGGLE]))
  await settle(t, 200)
  return t
}

/** Wheel the panel down, flushing once at the end rather than per tick. */
async function scrollDown(t: Harness, ticks: number) {
  for (let n = 0; n < ticks; n++) await t.mockMouse.scroll(4, 8, 'down')
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

    await pressTimes(t, 40, i => i.pressArrow('down'))
    await settle(t, 50)

    expect(sidebar(t)).toContain('f040.ts')
  }, 30000)

  test('a scrolled panel is not yanked back by a git refresh', async () => {
    const t = await openPanel()
    await scrollDown(t, 20)
    const scrolled = sidebar(t)

    // The watcher re-reads `git status` on a timer; the rows are a fresh array
    // every time, and tracking that array used to snap the view to the top.
    await settle(t, 600)

    expect(sidebar(t)).toBe(scrolled)
  })

  test('a save elsewhere in the repo leaves the scrolled panel where it was', async () => {
    const dir = repo()
    const t = await launch(dir, {}, { width: 100, height: 24 })
    await press(t, i => void i.pressKeys([TOGGLE]))
    await settle(t, 200)
    await scrollDown(t, 20)
    const scrolled = sidebar(t)
    expect(scrolled).not.toContain('f000.ts')

    // A real revision: the watcher sees the write, every row is rebuilt, and the
    // panel's cursor — still row 0 — used to drag the view back to the top with
    // it, once per save. With a lot of changes that is most of the session.
    writeFileSync(join(dir, NAMES[0]!), 'changed again\n')
    for (let n = 0; n < 6; n++) {
      await settle(t, 250)
      expect(sidebar(t)).toBe(scrolled)
    }
  }, 30000)
})
