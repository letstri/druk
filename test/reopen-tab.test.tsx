import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press } from './helpers'
import type { Harness } from './helpers'

// Opt is an ESC prefix ahead of Ctrl+T (0x14).
const REOPEN = `${String.fromCodePoint(27)}${String.fromCodePoint(20)}`

const PROJECT = { 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' }

async function openBoth() {
  const t = await launch(fixture(PROJECT))
  for (const name of ['a.ts', 'b.ts']) {
    await openFile(t, name)
  }
  return t
}

const tabRow = (t: Harness) => t.captureCharFrame().split('\n')[0]!

test('Ctrl+Opt+T brings back the closed tab with its content', async () => {
  const t = await openBoth()
  await press(t, (i) => i.pressKey('w', { ctrl: true }))
  expect(tabRow(t)).not.toContain('b.ts')

  await press(t, (i) => i.pressKeys([REOPEN]))
  expect(tabRow(t)).toContain('b.ts')
  expect(t.captureCharFrame()).toContain('const b = 2')
})

test('reopening twice walks back through the closed tabs', async () => {
  const t = await openBoth()
  await press(t, (i) => i.pressKey('w', { ctrl: true }))
  await press(t, (i) => i.pressKey('w', { ctrl: true }))
  expect(tabRow(t)).toContain('no open files')

  await press(t, (i) => i.pressKeys([REOPEN]))
  expect(tabRow(t)).toContain('a.ts')
  await press(t, (i) => i.pressKeys([REOPEN]))
  expect(tabRow(t)).toContain('b.ts')
})

test('a closed tab whose file is gone is skipped with a message', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir)
  await openFile(t, 'b.ts')
  await press(t, (i) => i.pressKey('w', { ctrl: true }))

  rmSync(join(dir, 'b.ts'))
  await press(t, (i) => i.pressKeys([REOPEN]))
  expect(tabRow(t)).not.toContain('b.ts')
  expect(t.captureCharFrame()).toContain('No closed tab to reopen')
})
