import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { APPEARANCE_ENV } from '../src/core/appearance'
import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, loadMarketExtensions, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'

// The themes these tests name are market extensions now.
loadMarketExtensions()

afterEach(() => {
  delete process.env[APPEARANCE_ENV]
})

/** A project whose `.druk/settings.json` holds `overrides` and nothing else. */
const project = (overrides: Record<string, unknown>) =>
  fixture({ 'a.ts': 'const a = 1\n', '.druk/settings.json': JSON.stringify(overrides) })

const local = (dir: string) => JSON.parse(readFileSync(join(dir, '.druk', 'settings.json'), 'utf8'))

/** The user file is written lazily, and no test here should be what writes it. */
const userVim = () =>
  existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim : undefined

/** One flush per key: a burst of arrows in one chunk parses as fewer keys. */
async function down(t: Harness, times: number) {
  for (let step = 0; step < times; step++) await press(t, i => i.pressArrow('down'))
}

const rowOf = (t: Harness, label: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes(label))!
    .trimEnd()

test('the project file outranks the user settings', async () => {
  // `.druk` is itself a dotfile, so hiding them hides the file doing the hiding.
  const hidden = await launch(project({ showDotfiles: false }))
  expect(hidden.captureCharFrame()).toContain('a.ts')
  expect(hidden.captureCharFrame()).not.toContain('.druk')

  const shown = await launch(project({}))
  expect(shown.captureCharFrame()).toContain('.druk')
})

test('a key the project leaves out keeps the user value', async () => {
  const t = await launch(project({ vim: true }), { tabSize: 8 })
  await runCommand(t, 'Settings: this project')
  await down(t, 12) // Theme, Follow OS, Light, Dark, Transparent, Icons, Tab icons, Tooltips, Vim, Cursor, Word wrap, Scroll past end → Tab size
  expect(rowOf(t, 'Vim mode').endsWith('on')).toBe(true)
  // Not 2: an absent key falls through to the user's file, not to the default.
  expect(rowOf(t, 'Tab size').endsWith('8')).toBe(true)
})

test('Tab moves the page between the two files', async () => {
  const t = await launch(project({ tabSize: 8 }))
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Settings — User')
  await down(t, 12)
  // The user page shows the user's own value, marked as overridden — VS Code's
  // arrangement, and the only one where stepping the row does something visible.
  expect(rowOf(t, 'Tab size').endsWith('2')).toBe(true)
  expect(rowOf(t, 'Tab size')).toContain('◆')

  await press(t, i => i.pressTab())
  expect(t.captureCharFrame()).toContain('Settings — Project')
  expect(rowOf(t, 'Tab size').endsWith('8')).toBe(true)
})

test('the project page writes the project file, and only the keys it changed', async () => {
  const dir = project({})
  const t = await launch(dir)
  await runCommand(t, 'Settings: this project')
  await down(t, 8) // Vim mode
  await press(t, i => i.pressEnter())
  expect(local(dir)).toEqual({ vim: true })
  expect(userVim()).not.toBe(true)
})

test('Backspace drops an override and the user value comes back', async () => {
  const dir = project({ tabSize: 8 })
  const t = await launch(dir)
  await runCommand(t, 'Settings: this project')
  await down(t, 12)
  expect(rowOf(t, 'Tab size').endsWith('8')).toBe(true)
  await press(t, i => i.pressBackspace())
  expect(rowOf(t, 'Tab size').endsWith('2')).toBe(true)
  expect(local(dir)).toEqual({})
})

test('a broken or bogus project file is ignored, not fatal', async () => {
  const broken = await launch(fixture({ 'a.ts': 'const a = 1\n', '.druk/settings.json': '{ nope' }))
  expect(broken.captureCharFrame()).toContain('a.ts')

  const bogus = await launch(project({ tabSize: 'huge', vim: true }))
  await runCommand(bogus, 'Settings: this project')
  await down(bogus, 6)
  expect(rowOf(bogus, 'Vim mode').endsWith('on')).toBe(true)
  expect(rowOf(bogus, 'Tab size').endsWith('2')).toBe(true)
})

test('a project theme outranks the OS appearance', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(project({ theme: 'dracula' }), {
    themeSync: true,
    themeDark: 'tokyo-night',
  })
  await runCommand(t, 'Settings: this project')
  expect(rowOf(t, 'Theme')).toContain('Dracula')

  process.env[APPEARANCE_ENV] = 'light'
  await settle(t, 300) // longer than one poll: the project's pick has to survive it
  expect(rowOf(t, 'Theme')).toContain('Dracula')
})
