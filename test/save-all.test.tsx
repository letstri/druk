import { expect, test } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'a.ts': 'const a = 1\n',
  'b.ts': 'const b = 2\n',
  'c.ts': 'const c = 3\n',
}

const SIZE = { width: 100, height: 30 }

async function dirty(t: Harness, name: string) {
  await openFile(t, name)
  await press(t, i => void i.typeText('x'))
}

test('saves every dirty tab and counts them', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, { autoSaveOnBlur: false }, SIZE)
  await dirty(t, 'a.ts')
  await dirty(t, 'b.ts')
  await openFile(t, 'c.ts')

  await runCommand(t, 'Save all')
  await untilFrame(t, 'Saved 2 files')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('xconst a = 1\n')
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('xconst b = 2\n')
  expect(readFileSync(join(dir, 'c.ts'), 'utf8')).toBe('const c = 3\n')
})

test('with nothing unsaved it says so and writes nothing', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, { autoSaveOnBlur: false }, SIZE)
  await openFile(t, 'a.ts')

  await runCommand(t, 'Save all')
  await untilFrame(t, 'Nothing to save')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\n')
})

test('a file changed on disk underneath is skipped with the warning', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, { autoSaveOnBlur: false }, SIZE)
  await dirty(t, 'a.ts')

  writeFileSync(join(dir, 'a.ts'), 'someone else wrote this\n')
  await runCommand(t, 'Save all')
  await untilFrame(t, 'Changed on disk with unsaved edits: a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('someone else wrote this\n')
})

test('a write failure is named, the other files still land', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, { autoSaveOnBlur: false }, SIZE)
  await dirty(t, 'a.ts')
  await dirty(t, 'b.ts')

  chmodSync(join(dir, 'a.ts'), 0o444)
  await runCommand(t, 'Save all')
  // Root ignores file modes, so the failure branch is unobservable there.
  if (process.getuid?.() !== 0) {
    await untilFrame(t, 'Save failed: a.ts')
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\n')
  }
  chmodSync(join(dir, 'a.ts'), 0o644)
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('xconst b = 2\n')
})
