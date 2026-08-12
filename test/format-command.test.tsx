import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  openFile,
  openPalette,
  press,
  runCommand,
  settle,
  until,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

/** An in-place formatter, as `formatters` commands must be: uppercases the file. */
const UPPERCASE = `
const fs = require('fs')
const file = process.argv[2]
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').toUpperCase())
`

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+L: Opt is an ESC prefix ahead of the Ctrl byte (0x0c). */
const CTRL_OPT_L = `${ESC}${String.fromCharCode(12)}`
const F6 = `${ESC}[17~`

async function editA(t: Harness, text: string) {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText(text))
}

const save = (t: Harness) => press(t, i => i.pressKey('s', { ctrl: true }))

test('Format document runs without format-on-save', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await runCommand(t, 'Format document')

  await untilFrame(t, 'Formatted a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('EDIT CONST A = 1\n')
  expect(t.captureCharFrame()).toContain('EDIT CONST A = 1')
})

test('Ctrl+Opt+L formats the active document', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.pressKeys([CTRL_OPT_L]))

  await untilFrame(t, 'Formatted a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('CONST A = 1\n')
})

test('Format document warns when no formatter matches', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { formatOnSave: false, formatters: {} })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Format document')

  await untilFrame(t, 'No formatter for this file')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\n')
})

test('Format document includes unsaved edits', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await runCommand(t, 'Format document')

  await untilFrame(t, 'Formatted a.ts')
  expect(t.captureCharFrame()).not.toContain('Saved a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('EDIT CONST A = 1\n')
})

test('Format open files formats every matching tab', async () => {
  const dir = fixture({
    'a.ts': 'aaa\n',
    'b.ts': 'bbb\n',
    'c.go': 'ccc\n',
    'fmt.js': UPPERCASE,
  })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await openFile(t, 'a.ts')
  await openFile(t, 'b.ts')
  await openFile(t, 'c.go')
  await runCommand(t, 'Format open files')

  await untilFrame(t, 'Formatted 2 files')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('AAA\n')
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('BBB\n')
  expect(readFileSync(join(dir, 'c.go'), 'utf8')).toBe('ccc\n')
})

test('Format open files reports no changes when the formatter is a no-op', async () => {
  const identity = `
const fs = require('fs')
const file = process.argv[2]
fs.writeFileSync(file, fs.readFileSync(file, 'utf8'))
`
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': identity })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Format open files')

  await untilFrame(t, 'No formatting changes')
  expect(t.captureCharFrame()).not.toContain('Nothing to format')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\n')
})

test('Save without formatting writes even when format-on-save is on', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await runCommand(t, 'Save without formatting')

  await untilFrame(t, 'Saved a.ts')
  await settle(t, 300)
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('edit const a = 1\n')
  expect(t.captureCharFrame()).not.toContain('Formatted')
})

test('closing a tab still heals a late formatter flush after Save without formatting', async () => {
  const dir = fixture({
    'a.ts': 'const a = 1\n',
    // Stays alive until SIGKILL so formatWait is still pending when the tab closes.
    'fmt.js': 'setTimeout(() => {}, 5000)\n',
  })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)
  await untilFrame(t, 'Saved a.ts')

  await openPalette(t)
  await press(t, i => void i.typeText('Save without formatting'))
  // Enter, the late flush, and Ctrl+W in one turn: the child's close has not
  // fired yet, so reassertAfterFormat is still waiting. A flush between them
  // would let it run (or skip) before the tab closes.
  t.mockInput.pressEnter()
  writeFileSync(join(dir, 'a.ts'), 'EDIT CONST A = 1\n')
  t.mockInput.pressKey('w', { ctrl: true })
  await settle(t)

  await until(t, () => t.captureCharFrame().includes('no open files'))
  await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'edit const a = 1\n')
})

test('renaming does not recreate the old path from a pending format reassert', async () => {
  const dir = fixture({
    'a.ts': 'const a = 1\n',
    'fmt.js': 'setTimeout(() => {}, 5000)\n',
  })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
    keybindings: { 'file.saveWithoutFormatting': 'F6' },
  })
  await editA(t, 'edit ')
  await save(t)
  await untilFrame(t, 'Saved a.ts')

  await runCommand(t, 'Rename…')
  await untilFrame(t, 'Rename to')

  // Save without formatting, then confirm the rename, before the killed
  // child's close lets reassertAfterFormat write the captured path.
  t.mockInput.pressKeys([F6])
  for (let n = 0; n < 4; n++) t.mockInput.pressBackspace()
  t.mockInput.pressKey('b')
  t.mockInput.pressKey('.')
  t.mockInput.pressKey('t')
  t.mockInput.pressKey('s')
  t.mockInput.pressEnter()
  await settle(t)

  await until(t, () => existsSync(join(dir, 'b.ts')))
  await settle(t, 300)
  expect(existsSync(join(dir, 'a.ts'))).toBe(false)
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('edit const a = 1\n')
})

test('Ctrl+S still formats when format-on-save is on', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Formatted a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('EDIT CONST A = 1\n')
})

test('Format open files with nothing matching says so', async () => {
  const dir = fixture({ 'a.go': 'package main\n' })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: ['prettier', '--write'] },
  })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Format open files')

  await untilFrame(t, 'Nothing to format')
  await until(t, () => readFileSync(join(dir, 'a.go'), 'utf8') === 'package main\n')
})
