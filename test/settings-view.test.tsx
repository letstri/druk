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
  settle,
} from './helpers'
import type { Harness } from './helpers'

loadMarketExtensions()

const PROJECT = { 'a.ts': 'const a = 1\n' }

// One flush per key: a burst of arrow sequences in one chunk parses as fewer keys than were sent.
async function down(t: Harness, times: number) {
  for (let step = 0; step < times; step += 1) {
    await press(t, (i) => i.pressArrow('down'))
  }
}

async function openA(t: Harness) {
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
}

test('the palette opens the settings page over the editor slot', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Settings')
  expect(frame).toContain('Theme')
  expect(frame).toContain('Vim mode')
  expect(frame).toContain('Follow OS appearance')
  expect(frame).toContain('a.ts')
})

test('Enter flips a boolean, the row and the config file follow', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 9)
  await press(t, (i) => i.pressEnter())
  const row = t
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes('Vim mode'))!
  expect(row.trimEnd().endsWith('on')).toBe(true)
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).vim).toBe(true)
  await press(t, (i) => i.pressEnter())
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).vim).toBe(false)
})

test('arrows cycle a multi-value setting in both directions', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 14)
  const size = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find((line) => line.includes('Tab size'))!
      .trimEnd()
  expect(size().endsWith('2')).toBe(true)
  await press(t, (i) => i.pressArrow('right'))
  expect(size().endsWith('4')).toBe(true)
  await press(t, (i) => i.pressArrow('left'))
  expect(size().endsWith('2')).toBe(true)
  await press(t, (i) => i.pressArrow('left'))
  expect(size().endsWith('8')).toBe(true)
})

test('the theme row applies live and reports in the status bar', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, (i) => i.pressArrow('right'))
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
  await press(t, (i) => i.pressKey('w', { ctrl: true }))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
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
  await press(t, (i) => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).toContain('Type to filter')
  expect(frame).toContain('GitHub Dark')
  expect(frame).not.toContain('Nord')
  await press(t, (i) => i.typeText('nord'))
  expect(t.captureCharFrame()).toContain('Nord')
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).theme).toBe('nord')
})

test('the list starts on the value in force, so bare Enter changes nothing', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'gruvbox' })
  await runCommand(t, 'Settings')
  const theme = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find((line) => line.includes('Theme'))!
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(theme()).toContain('Gruvbox')
})

test('Esc backs out of the list to the page without changing anything', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'nord' })
  await runCommand(t, 'Settings')
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressArrow('down'))
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Type to filter')
  expect(frame).toContain('Vim mode')
  expect(frame.split('\n').find((line) => line.includes('Theme'))!).toContain(
    'Nord'
  )
})

test('booleans still flip on Enter without a list', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await down(t, 9)
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).vim).toBe(true)
})

test('/ filters the rows, Enter still changes the one it leaves', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, (i) => i.typeText('/'))
  expect(t.captureCharFrame()).toContain('Filter settings')
  await press(t, (i) => i.typeText('vim'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('Vim mode')
  expect(frame).not.toContain('Tab size')
  await press(t, (i) => i.pressEnter())
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).vim).toBe(true)
})

test('a filter matching nothing says so, and Esc drops it before closing the page', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, (i) => i.typeText('/'))
  await press(t, (i) => i.typeText('zzzz'))
  expect(t.captureCharFrame()).toContain('No matching settings')
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Filter settings')
  expect(frame).toContain('Vim mode')
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('Vim mode')
})

test('the page windows its rows and the selection carries the window down', async () => {
  const t = await launch(fixture(PROJECT), {}, { height: 16 })
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Settings')

  for (
    let step = 0;
    step < 40 && !t.captureCharFrame().includes('Servers');
    step += 1
  ) {
    await down(t, 1)
  }
  const frame = t.captureCharFrame()
  expect(frame).toContain('Servers')
  expect(frame).toContain('Settings')
  expect(frame).not.toContain('Vim mode')
}, 20_000)

// A flush per tick: OpenTUI's scroll acceleration drops events sent within its minimum interval.
async function wheel(t: Harness, ticks: number, direction: 'up' | 'down') {
  for (let tick = 0; tick < ticks; tick += 1) {
    await t.mockMouse.scroll(60, 8, direction)
    await settle(t)
  }
}

test('the wheel scrolls the page without moving the selection', async () => {
  const t = await launch(fixture(PROJECT), {}, { height: 16 })
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Follow OS appearance')

  await wheel(t, 6, 'down')
  const scrolled = t.captureCharFrame()
  expect(scrolled).not.toContain('Follow OS appearance')
  expect(scrolled).toContain('Settings')

  await wheel(t, 12, 'up')
  expect(t.captureCharFrame()).toContain('Follow OS appearance')

  const cursor = t
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes('▌'))
  expect(cursor).toContain('Theme')

  await wheel(t, 60, 'down')
  const bottom = t.captureCharFrame()
  expect(bottom).toContain('Registry')
  expect(bottom).toContain('Settings')
}, 20_000)
