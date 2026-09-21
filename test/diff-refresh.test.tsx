import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  openDiff,
  press,
  pressEscape,
  runCommand,
  settle,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const run = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
}

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

const FIRST_ROW = 6

test('Esc closes the diff opened from the panel, not the panel under it', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  await t.mockMouse.click(4, FIRST_ROW)
  await untilFrame(t, 'alpha changed')

  await pressEscape(t)
  const after = frame(t)
  expect(after).not.toContain('alpha changed')
  expect(after).toContain('▾ Changes')
})

test('a commit elsewhere closes the page for the file it committed', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', 'a.ts')
  run(dir, 'commit', '-qm', 'just a')
  await untilGone(t, 'alpha changed')

  expect(frame(t)).toContain('b.ts')
})

test('an edit elsewhere to the open file rebuilds the page against HEAD', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  writeFileSync(join(dir, 'a.ts'), 'alpha rewritten\n')
  await untilFrame(t, 'alpha rewritten')

  expect(frame(t)).not.toContain('alpha changed')
})

test('the diff closes itself once nothing is left to show', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'all of it')
  await untilGone(t, 'alpha changed')
})

function emptyPageRepo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  run(dir, 'add', 'a.ts')
  writeFileSync(join(dir, 'a.ts'), 'alpha\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')
  writeFileSync(join(dir, 'c.ts'), '')
  writeFileSync(join(dir, 'd.ts'), '')
  return dir
}

// Not an uncaughtException: OpenTUI's key dispatch catches and reports through console.error.
function watchErrors() {
  const original = console.error
  const seen: string[] = []
  console.error = (...args: unknown[]) => {
    seen.push(
      args
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(' ')
    )
  }
  return {
    seen,
    stop: () => {
      console.error = original
    },
  }
}

test('paging between changes with nothing to show keeps drawing them', async () => {
  const t = await launch(emptyPageRepo())
  const errors = watchErrors()
  try {
    await openDiff(t, 1)
    await untilFrame(t, 'beta changed')

    await press(t, (i) => i.pressArrow('down'))
    await untilFrame(t, 'No changes in this file')
    await press(t, (i) => i.pressArrow('down'))
    await untilFrame(t, 'd.ts')

    await press(t, (i) => i.pressArrow('up'))
    await press(t, (i) => i.pressArrow('up'))
    await untilFrame(t, 'beta changed')
  } finally {
    errors.stop()
  }
  expect(errors.seen.join('\n')).not.toContain('TextBufferView is destroyed')
})

const body = (word: string) =>
  `${Array.from({ length: 20 }, (_, n) => `${word} ${n}`).join('\n')}\n`

function bigRepo() {
  const names = Array.from({ length: 6 }, (_, n) => `f${n}.ts`)
  const dir = fixture(Object.fromEntries(names.map((n) => [n, body('before')])))
  initRepo(dir)
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  for (const name of names) {
    writeFileSync(join(dir, name), body('after'))
  }
  return dir
}

test('a git refresh leaves a scrolled changes page where it was', async () => {
  const dir = bigRepo()
  const t = await launch(dir, {}, { height: 24, width: 120 })
  await openDiff(t)
  await untilFrame(t, 'before 0')
  for (let n = 0; n < 30; n += 1) {
    await t.mockMouse.scroll(80, 10, 'down')
  }
  await settle(t)
  const scrolled = frame(t)

  writeFileSync(join(dir, 'f0.ts'), body('again'))
  for (let n = 0; n < 6; n += 1) {
    await settle(t, 250)
  }

  expect(frame(t)).toBe(scrolled)
}, 30_000)
