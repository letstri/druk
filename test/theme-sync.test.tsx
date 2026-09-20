import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { APPEARANCE_ENV, detectAppearance, watchAppearance } from '../src/core/appearance'
import { CONFIG_FILE, DEFAULTS } from '../src/core/config'
import {
  fixture,
  launch,
  loadMarketExtensions,
  runCommand,
  settle,
  toggleSetting,
  untilFrame,
} from './helpers'

loadMarketExtensions()

afterEach(() => {
  delete process.env[APPEARANCE_ENV]
})

test('the light and dark slots default to the GitHub pair, sync on', () => {
  expect(DEFAULTS.themeSync).toBe(true)
  expect(DEFAULTS.themeLight).toBe('light')
  expect(DEFAULTS.themeDark).toBe('dark')
})

test('the env override decides the appearance', () => {
  process.env[APPEARANCE_ENV] = 'light'
  expect(detectAppearance()).toBe('light')
  process.env[APPEARANCE_ENV] = 'Dark'
  expect(detectAppearance()).toBe('dark')
})

test('the watcher reports the appearance now and on every change', async () => {
  process.env[APPEARANCE_ENV] = 'light'
  const seen: string[] = []
  const stop = watchAppearance(appearance => seen.push(appearance), 5)
  expect(seen).toEqual(['light'])

  process.env[APPEARANCE_ENV] = 'dark'
  const started = Date.now()
  while (seen.length < 2 && Date.now() - started < 2000) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  stop()
  expect(seen).toEqual(['light', 'dark'])
})

test('sync paints the dark slot, then follows the OS to light', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    themeSync: true,
    theme: 'nord',
    themeDark: 'tokyo-night',
    themeLight: 'light',
  })
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Tokyo Night')

  process.env[APPEARANCE_ENV] = 'light'
  await untilFrame(t, 'GitHub Light')
})

test('picking a theme by hand turns the sync off and survives the next poll', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    themeSync: true,
    themeDark: 'tokyo-night',
  })
  await runCommand(t, 'Dracula')
  await untilFrame(t, 'no longer following the OS appearance')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).themeSync).toBe(false)

  process.env[APPEARANCE_ENV] = 'light'
  await settle(t, 300) // longer than one poll: the appearance must no longer matter
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Dracula')
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('Follow OS appearance'))!
  expect(row.trimEnd().endsWith('off')).toBe(true)
})

test('the settings page turns the sync on and applies the matching slot', async () => {
  process.env[APPEARANCE_ENV] = 'light'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    themeSync: false,
    theme: 'nord',
    themeLight: 'solarized-light',
  })
  await toggleSetting(t, 'Follow OS appearance')
  await untilFrame(t, 'Following OS appearance')
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Solarized Light')
})
