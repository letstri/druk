import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openPalette, press } from './helpers'
import type { Harness } from './helpers'

// The mock's pressKey cannot spell these chords.
const CTRL_SLASH = ''
const ALT_DOWN = '[1;3B'
const ALT_UP = '[1;3A'
const ALT_SHIFT_DOWN = '[1;4B'
// Opt is an ESC prefix ahead of the Ctrl byte.
const CTRL_OPT_D = ''

async function open(content: string, name = 'a.ts') {
  const dir = fixture({ [name]: content })
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const saved = async () => {
    await press(t, i => i.pressKey('s', { ctrl: true }))
    return readFileSync(join(dir, name), 'utf8')
  }
  return { t, saved }
}

const undo = (t: Harness) => press(t, i => i.pressKey('z', { ctrl: true }))

test('Ctrl+/ comments the line and toggles it back', async () => {
  const { t, saved } = await open('const a = 1\n')
  await press(t, i => void i.pressKeys([CTRL_SLASH]))
  expect(await saved()).toBe('// const a = 1\n')

  await press(t, i => void i.pressKeys([CTRL_SLASH]))
  expect(await saved()).toBe('const a = 1\n')
})

test('Ctrl+L comments too, for terminals that cannot send Ctrl+/', async () => {
  const { t, saved } = await open('const a = 1\n')
  await press(t, i => i.pressKey('l', { ctrl: true }))
  expect(await saved()).toBe('// const a = 1\n')
})

test('Ctrl+/ uses the language’s own prefix', async () => {
  const { t, saved } = await open('x: 1\n', 'a.yaml')
  await press(t, i => void i.pressKeys([CTRL_SLASH]))
  expect(await saved()).toBe('# x: 1\n')
})

test('Ctrl+/ does nothing where the language has no line comment', async () => {
  const { t, saved } = await open('{ "a": 1 }\n', 'a.json')
  await press(t, i => void i.pressKeys([CTRL_SLASH]))
  expect(await saved()).toBe('{ "a": 1 }\n')
})

test('a comment toggle is one undo step', async () => {
  const { t, saved } = await open('const a = 1\n')
  await press(t, i => void i.pressKeys([CTRL_SLASH]))
  await undo(t)
  expect(await saved()).toBe('const a = 1\n')
})

test('Alt+↓ moves the line down, Alt+↑ back up', async () => {
  const { t, saved } = await open('one\ntwo\nthree\n')
  await press(t, i => void i.pressKeys([ALT_DOWN]))
  expect(await saved()).toBe('two\none\nthree\n')

  await press(t, i => void i.pressKeys([ALT_UP]))
  expect(await saved()).toBe('one\ntwo\nthree\n')
})

test('Alt+↑ at the top is a no-op, not a scramble', async () => {
  const { t, saved } = await open('one\ntwo\n')
  await press(t, i => void i.pressKeys([ALT_UP]))
  expect(await saved()).toBe('one\ntwo\n')
})

test('Alt+Shift+↓ duplicates the line and undo removes the copy', async () => {
  const { t, saved } = await open('one\ntwo\n')
  await press(t, i => void i.pressKeys([ALT_SHIFT_DOWN]))
  expect(await saved()).toBe('one\none\ntwo\n')

  await undo(t)
  expect(await saved()).toBe('one\ntwo\n')
})

test('the caret follows a moved line', async () => {
  const { t } = await open('one\ntwo\nthree\n')
  await press(t, i => void i.pressKeys([ALT_DOWN]))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 1')
})

test('Ctrl+Opt+D deletes the line under the cursor', async () => {
  const { t, saved } = await open('one\ntwo\nthree\n')
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  expect(await saved()).toBe('two\nthree\n')
})

test('the line below keeps its own indentation', async () => {
  const { t, saved } = await open('  a,\n  b,\n  c,\n')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  expect(await saved()).toBe('  a,\n  c,\n')
})

test('a selection takes every line it touches, whole', async () => {
  const { t, saved } = await open('one\ntwo\nthree\nfour\n')
  const col = t.captureCharFrame().split('\n')[2]!.indexOf('two')
  await t.mockMouse.drag(col + 1, 2, col + 2, 3)
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  expect(await saved()).toBe('one\nfour\n')
})

test('the caret lands on the line that took the deleted one’s place', async () => {
  const { t } = await open('one\ntwo\nthree\n')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 1')
})

test('deleting the last line leaves the caret on the new last one', async () => {
  const { t, saved } = await open('one\ntwo\n')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  expect(t.captureCharFrame()).toContain('Ln 1, Col 1')
  expect(await saved()).toBe('one\n')
})

test('a deleted line comes back with one undo', async () => {
  const { t, saved } = await open('one\ntwo\n')
  await press(t, i => void i.pressKeys([CTRL_OPT_D]))
  await undo(t)
  expect(await saved()).toBe('one\ntwo\n')
})

test('the palette can comment and move lines without any chord', async () => {
  const { t, saved } = await open('one\ntwo\n')

  await openPalette(t)
  await press(t, i => void i.typeText('Toggle comment'))
  await press(t, i => i.pressEnter())
  expect(await saved()).toBe('// one\ntwo\n')

  await openPalette(t)
  await press(t, i => void i.typeText('Move line down'))
  await press(t, i => i.pressEnter())
  expect(await saved()).toBe('two\n// one\n')

  await openPalette(t)
  await press(t, i => void i.typeText('Duplicate line'))
  await press(t, i => i.pressEnter())
  expect(await saved()).toBe('two\n// one\n// one\n')

  await openPalette(t)
  await press(t, i => void i.typeText('Delete line'))
  await press(t, i => i.pressEnter())
  expect(await saved()).toBe('two\n// one\n')
})
