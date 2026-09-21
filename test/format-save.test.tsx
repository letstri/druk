import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, settle, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

const UPPERCASE = `
const fs = require('fs')
const file = process.argv[2]
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').toUpperCase())
`

// Written to the stream rather than `console.error`, which Bun decorates with a source frame.
const FAIL = `
process.stderr.write('boom: bad syntax\\n')
process.exit(2)
`

async function editA(t: Harness, text: string) {
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.typeText(text))
}

const save = (t: Harness) => press(t, (i) => i.pressKey('s', { ctrl: true }))

test('Ctrl+S runs the matching formatter and the buffer follows the result', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Formatted a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('EDIT CONST A = 1\n')
  const frame = t.captureCharFrame()
  expect(frame).toContain('EDIT CONST A = 1')
  expect(frame).not.toContain('unsaved')
})

test('the save after a format is a plain save, not a conflict', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)
  await untilFrame(t, 'Formatted a.ts')

  await press(t, (i) => i.typeText('X'))
  await save(t)
  await untilFrame(t, 'Saved a.ts')
  expect(t.captureCharFrame()).not.toContain('Overwrite')
  await until(
    t,
    () => readFileSync(join(dir, 'a.ts'), 'utf-8') === 'EDIT XCONST A = 1\n'
  )
})

test('a failing formatter reports on the status bar and keeps the saved text', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': FAIL })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Format failed: boom: bad syntax')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('edit const a = 1\n')
})

test('the {} token puts the path mid-command instead of at the end', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: {
      ts: [process.execPath, join(dir, 'fmt.js'), '{}', '--ignored'],
    },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Formatted a.ts')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('EDIT CONST A = 1\n')
})

test('a file no formatter matches saves untouched', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: true,
    formatters: { go: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Saved a.ts')
  await settle(t, 300)
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('edit const a = 1\n')
})

test('off: the formatter never runs', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'fmt.js': UPPERCASE })
  const t = await launch(dir, {
    formatOnSave: false,
    formatters: { ts: [process.execPath, join(dir, 'fmt.js')] },
  })
  await editA(t, 'edit ')
  await save(t)

  await untilFrame(t, 'Saved a.ts')
  await settle(t, 300)
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('edit const a = 1\n')
})
