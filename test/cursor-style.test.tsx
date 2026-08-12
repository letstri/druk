import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { TextareaRenderable } from '@opentui/core'
import type { Renderable } from '@opentui/core'

import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, openFile, press, pressEscape, runCommand } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

/** One flush per key — a burst in one chunk parses as fewer keys than were sent. */
async function down(t: Harness, times: number) {
  for (let step = 0; step < times; step++) await press(t, i => i.pressArrow('down'))
}

/**
 * The caret's shape is a terminal property rather than a glyph, so a captured frame
 * cannot show it — but the textarea it was set on is reachable from the harness, and
 * that is the value OpenTUI hands the terminal.
 */
function caretStyle(t: Harness) {
  const find = (node: Renderable): TextareaRenderable | undefined => {
    if (node instanceof TextareaRenderable) return node
    for (const child of node.getChildren()) {
      const found = find(child)
      if (found) return found
    }
    return undefined
  }
  return find(t.renderer.root)?.cursorStyle.style
}

/** What the settings row says, which is the only place the vim rule is explained. */
const cursorRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('Cursor'))!
    .trimEnd()

const savedStyle = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).cursorStyle

/** Theme, Follow OS, Light, Dark, Transparent, File icons, File icons in tabs, Vim → Cursor. */
const CURSOR_ROW = 8

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

  await press(t, i => i.pressArrow('right'))
  expect(cursorRow(t).endsWith('line')).toBe(true)
  expect(savedStyle()).toBe('line')

  await press(t, i => i.pressArrow('right'))
  expect(cursorRow(t).endsWith('underline')).toBe(true)

  await press(t, i => i.pressArrow('left'))
  expect(cursorRow(t).endsWith('line')).toBe(true)
  expect(savedStyle()).toBe('line')

  // Wraps past the first entry rather than sticking.
  await press(t, i => i.pressArrow('left'))
  expect(cursorRow(t).endsWith('block')).toBe(true)
  await press(t, i => i.pressArrow('left'))
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
  const t = await launch(fixture(PROJECT), { vim: true, cursorStyle: 'line' })
  await openFile(t, 'a.ts')
  expect(caretStyle(t)).toBe('block')

  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW - 1) // Vim mode
  await press(t, i => i.pressEnter())
  await pressEscape(t)
  expect(caretStyle(t)).toBe('line')
})

test('editing the setting while vim sits in insert mode leaves the insert caret alone', async () => {
  const t = await launch(fixture(PROJECT), { vim: true })
  await openFile(t, 'a.ts')
  await press(t, i => i.pressKey('i'))
  expect(caretStyle(t)).toBe('line')

  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  await press(t, i => i.pressArrow('right'))
  await pressEscape(t)
  // The mode never changed, so neither may the caret: the shape is what says which
  // mode you are in, and nothing puts it back until the next mode swap.
  expect(caretStyle(t)).toBe('line')
})

test('vim mode says on the row that it has taken the caret over', async () => {
  const t = await launch(fixture(PROJECT), { vim: true, cursorStyle: 'line' })
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  // The setting is still the user's, and still saved — it is only not in effect,
  // which the row has to say or the caret looks broken.
  expect(cursorRow(t)).toContain('line')
  expect(cursorRow(t)).toContain('vim overrides')
})

test('the shape is still editable while vim holds the caret', async () => {
  const t = await launch(fixture(PROJECT), { vim: true })
  await runCommand(t, 'Settings')
  await down(t, CURSOR_ROW)
  await press(t, i => i.pressArrow('right'))
  // Written for when vim is turned back off, not swallowed.
  expect(savedStyle()).toBe('line')
  expect(cursorRow(t)).toContain('vim overrides')
})
