import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { CONFIG_FILE } from '../src/core/config'
import {
  fixture,
  launch,
  loadMarketExtensions,
  openFile,
  press,
  pressEscape,
  runCommand,
} from './helpers'
import type { Harness } from './helpers'

// The themes these tests name are market extensions now.
loadMarketExtensions()

const PROJECT = { 'a.ts': 'const a = 1\n' }

/**
 * One flush per key: a burst of arrow sequences in one chunk is parsed as fewer
 * keys than were sent, which would leave the selection above the wanted row.
 */
async function down(t: Harness, times: number) {
  for (let step = 0; step < times; step++) await press(t, i => i.pressArrow('down'))
}

async function openA(t: Harness) {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
}

test('the palette opens the settings page over the editor slot', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Settings')
  expect(frame).toContain('Theme')
  expect(frame).toContain('Vim mode')
  expect(frame).toContain('Follow OS appearance')
  // The tree stays put beside the page.
  expect(frame).toContain('a.ts')
})

test('Enter flips a boolean, the row and the config file follow', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 7) // Theme, Follow OS, Light, Dark, Transparent, Icons, Tab icons → Vim mode
  await press(t, i => i.pressEnter())
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('Vim mode'))!
  expect(row.trimEnd().endsWith('on')).toBe(true)
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(true)
  // Flip it back: the page is still up and the same key keeps working.
  await press(t, i => i.pressEnter())
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(false)
})

test('arrows cycle a multi-value setting in both directions', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 11) // Tab size
  const size = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Tab size'))!
      .trimEnd()
  expect(size().endsWith('2')).toBe(true)
  await press(t, i => i.pressArrow('right'))
  expect(size().endsWith('4')).toBe(true)
  await press(t, i => i.pressArrow('left'))
  expect(size().endsWith('2')).toBe(true)
  // Wraps below the first entry instead of dying.
  await press(t, i => i.pressArrow('left'))
  expect(size().endsWith('8')).toBe(true)
})

test('the theme row applies live and reports in the status bar', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Theme:')
})

test('Esc closes the page back to the file', async () => {
  const t = await launch(fixture(PROJECT))
  await openA(t)
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Vim mode')
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  expect(frame).toContain('const a = 1')
})

test('Ctrl+W closes the page before any file tab', async () => {
  const t = await launch(fixture(PROJECT))
  await openA(t)
  await runCommand(t, 'Settings')
  await press(t, i => i.pressKey('w', { ctrl: true }))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  // The tab survived — only the page went.
  expect(frame).toContain('const a = 1')
})

test('opening a file from the fuzzy picker closes the page', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await openFile(t, 'a.ts')
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  expect(frame).toContain('const a = 1')
})

test('Enter on the theme row opens a filterable list and picks by search', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter()) // Theme is the first row
  const frame = t.captureCharFrame()
  expect(frame).toContain('Type to filter')
  expect(frame).toContain('GitHub Dark')
  // Nord is far down a 26-entry list — the filter is how you reach it at all.
  expect(frame).not.toContain('Nord')
  await press(t, i => void i.typeText('nord'))
  expect(t.captureCharFrame()).toContain('Nord')
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).theme).toBe('nord')
})

test('the list starts on the value in force, so bare Enter changes nothing', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'gruvbox' })
  await runCommand(t, 'Settings')
  const theme = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Theme'))!
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(theme()).toContain('Gruvbox')
})

test('Esc backs out of the list to the page without changing anything', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'nord' })
  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressArrow('down'))
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Type to filter')
  expect(frame).toContain('Vim mode') // still on the page
  expect(frame.split('\n').find(line => line.includes('Theme'))!).toContain('Nord')
})

test('booleans still flip on Enter without a list', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 7) // Vim mode
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(true)
})

test('/ filters the rows, Enter still changes the one it leaves', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => void i.typeText('/'))
  expect(t.captureCharFrame()).toContain('Filter settings')
  await press(t, i => void i.typeText('vim'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('Vim mode')
  expect(frame).not.toContain('Tab size')
  // The one match is selected, so Enter needs no arrows to reach it.
  await press(t, i => i.pressEnter())
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(true)
})

test('a filter matching nothing says so, and Esc drops it before closing the page', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => void i.typeText('/'))
  await press(t, i => void i.typeText('zzzz'))
  expect(t.captureCharFrame()).toContain('No matching settings')
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Filter settings')
  expect(frame).toContain('Vim mode') // still on the page
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('Vim mode')
})

test('the page windows its rows and the selection carries the window down', async () => {
  // Short terminal, long list: the title bar has to survive, which it did not
  // when every row was drawn and the column overflowed.
  const t = await launch(fixture(PROJECT), {}, { height: 16 })
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Settings')

  // Down until a late row is in view rather than a fixed count: every setting
  // added below moves that row, and the assertion is about what the window does,
  // not how many rows happen to precede it.
  for (let step = 0; step < 40 && !t.captureCharFrame().includes('Servers'); step++) {
    await down(t, 1)
  }
  const frame = t.captureCharFrame()
  expect(frame).toContain('Servers')
  expect(frame).toContain('Settings')
  // The first rows gave way rather than the chrome.
  expect(frame).not.toContain('Vim mode')
}, 20_000)
