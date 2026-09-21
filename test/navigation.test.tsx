import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press } from './helpers'

const PROJECT = {
  'notes.md': 'one\ntwo\nthree\nfour\nfive\n',
  'src/deeply/nested/target.ts': 'const found = 1\n',
  'src/other.ts': 'const other = 2\n',
}

test('the file picker opens a file by fuzzy path', async () => {
  const t = await launch(fixture(PROJECT))
  await press(t, (i) => i.pressKey('o', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Open file')

  await press(t, (i) => i.typeText('target'))
  await press(t, (i) => i.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('const found = 1')
  expect(frame).toContain('target.ts')
})

test('go to line moves the cursor there', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir)
  await openFile(t, 'notes')

  await press(t, (i) => i.pressKey('g', { ctrl: true }))
  await press(t, (i) => i.typeText('4'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.typeText('X'))
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'notes.md'), 'utf-8')).toBe(
    'one\ntwo\nthree\nXfour\nfive\n'
  )
})

test('root-level and nested files start in the same column in the picker', async () => {
  const t = await launch(fixture(PROJECT))
  await press(t, (i) => i.pressKey('o', { ctrl: true }))

  const lines = t.captureCharFrame().split('\n')
  const startOf = (name: string) => {
    const row = lines.find((line) => line.includes(name))!
    expect(row).toBeDefined()
    return row.indexOf(name.includes('/') ? name.split('/')[0]! : name)
  }
  expect(startOf('notes.md')).toBe(startOf('src/other.ts'))
})
