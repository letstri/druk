import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { TextareaRenderable } from '@opentui/core'
import type { Renderable } from '@opentui/core'

import { CONFIG_FILE } from '../src/core/config'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  runCommand,
} from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

// One flush per key: a burst in one chunk parses as fewer keys than were sent.
async function down(t: Harness, times: number) {
  for (let step = 0; step < times; step += 1) {
    await press(t, (i) => i.pressArrow('down'))
  }
}

// The caret's shape is a terminal property, not a glyph: a captured frame cannot show it.
function caretStyle(t: Harness) {
  const find = (node: Renderable): TextareaRenderable | undefined => {
    if (node instanceof TextareaRenderable) {
      return node
    }
    for (const child of node.getChildren()) {
      const found = find(child)
      if (found) {
        return found
      }
    }
    return undefined
  }
  return find(t.renderer.root)?.cursorStyle.style
}

const cursorRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes('Cursor'))!
    .trimEnd()

const savedStyle = () =>
  JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).cursorStyle

const CURSOR_ROW = 14

test('the cursor row starts on the block druk has always drawn', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  expect(cursorRow(t).endsWith('block')).toBe(true)
})

test('arrows cycle the caret shape in both directions, and it persists', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)

  await press(t, (i) => i.pressArrow('right'))
  expect(cursorRow(t).endsWith('line')).toBe(true)
  expect(savedStyle()).toBe('line')

  await press(t, (i) => i.pressArrow('right'))
  expect(cursorRow(t).endsWith('underline')).toBe(true)

  await press(t, (i) => i.pressArrow('left'))
  expect(cursorRow(t).endsWith('line')).toBe(true)
  expect(savedStyle()).toBe('line')

  await press(t, (i) => i.pressArrow('left'))
  expect(cursorRow(t).endsWith('block')).toBe(true)
  await press(t, (i) => i.pressArrow('left'))
  expect(cursorRow(t).endsWith('underline')).toBe(true)
})

test('a saved shape is what the row comes back showing', async () => {
  const t = await launch(fixture(PROJECT), { cursorStyle: 'line' })
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  expect(cursorRow(t).endsWith('line')).toBe(true)
})

test('the shape the setting names is the one the editor draws', async () => {
  const t = await launch(fixture(PROJECT), { cursorStyle: 'underline' })
  await openFile(t, 'a.ts')
  expect(caretStyle(t)).toBe('underline')
})

test('vim takes the caret over, and gives it back in the shape the setting names', async () => {
  const t = await launch(fixture(PROJECT), { cursorStyle: 'line', vim: true })
  await openFile(t, 'a.ts')
  expect(caretStyle(t)).toBe('block')

  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW - 1)
  await press(t, (i) => i.pressEnter())
  await pressEscape(t)
  expect(caretStyle(t)).toBe('line')
})

test('editing the setting while vim sits in insert mode leaves the insert caret alone', async () => {
  const t = await launch(fixture(PROJECT), { vim: true })
  await openFile(t, 'a.ts')
  await press(t, (i) => i.pressKey('i'))
  expect(caretStyle(t)).toBe('line')

  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  await press(t, (i) => i.pressArrow('right'))
  await pressEscape(t)
  expect(caretStyle(t)).toBe('line')
})

test('vim mode says on the row that it has taken the caret over', async () => {
  const t = await launch(fixture(PROJECT), { cursorStyle: 'line', vim: true })
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  expect(cursorRow(t)).toContain('line')
  expect(cursorRow(t)).toContain('vim overrides')
})

test('the shape is still editable while vim holds the caret', async () => {
  const t = await launch(fixture(PROJECT), { vim: true })
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  await press(t, (i) => i.pressArrow('right'))
  expect(savedStyle()).toBe('line')
  expect(cursorRow(t)).toContain('vim overrides')
})
