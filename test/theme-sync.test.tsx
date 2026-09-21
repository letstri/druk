import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  APPEARANCE_ENV,
  detectAppearance,
  watchAppearance,
} from '../src/core/appearance'
import { CONFIG_FILE, DEFAULTS } from '../src/core/config'
import {
  fixture,
  launch,
  loadMarketExtensions,
  runCommand,
  settle,
  toggleSetting,
  until,
  untilFrame,
} from './helpers'

loadMarketExtensions()

afterEach(() => {
  Reflect.deleteProperty(process.env, APPEARANCE_ENV)
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
  const stop = watchAppearance((appearance) => seen.push(appearance), 5)
  expect(seen).toEqual(['light'])

  process.env[APPEARANCE_ENV] = 'dark'
  const started = Date.now()
  while (seen.length < 2 && Date.now() - started < 2000) {
    await sleep(5)
  }
  stop()
  expect(seen).toEqual(['light', 'dark'])
})

test('sync paints the dark slot, then follows the OS to light', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    theme: 'nord',
    themeDark: 'tokyo-night',
    themeLight: 'light',
    themeSync: true,
  })
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Tokyo Night')

  process.env[APPEARANCE_ENV] = 'light'
  await untilFrame(t, 'GitHub Light')
})

test('picking a theme by hand turns the sync off and survives the next poll', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    themeDark: 'tokyo-night',
    themeSync: true,
  })
  await runCommand(t, 'Dracula')
  await untilFrame(t, 'no longer following the OS appearance')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).themeSync).toBe(false)

  process.env[APPEARANCE_ENV] = 'light'
  // longer than one poll: the appearance must no longer matter
  await settle(t, 300)
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Dracula')
  const row = t
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes('Follow OS appearance'))!
  expect(row.trimEnd().endsWith('off')).toBe(true)
})

test('the settings page turns the sync on and applies the matching slot', async () => {
  process.env[APPEARANCE_ENV] = 'light'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    theme: 'nord',
    themeLight: 'solarized-light',
    themeSync: false,
  })
  await toggleSetting(t, 'Follow OS appearance')
  await untilFrame(t, 'Following OS appearance')
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Solarized Light')
})

test('the icon slots default to one set for both, sync off', () => {
  expect(DEFAULTS.iconThemeSync).toBe(false)
  expect(DEFAULTS.iconThemeLight).toBe(DEFAULTS.iconTheme)
  expect(DEFAULTS.iconThemeDark).toBe(DEFAULTS.iconTheme)
})

const savedIcons = () =>
  JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).iconTheme

test('icon sync takes the dark slot, then follows the OS to light', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    iconTheme: 'none',
    iconThemeDark: 'unicode',
    iconThemeLight: 'none',
    iconThemeSync: true,
    themeSync: false,
  })
  await until(t, () => savedIcons() === 'unicode')

  process.env[APPEARANCE_ENV] = 'light'
  await until(t, () => savedIcons() === 'none')
})

test('picking an icon set by hand turns the icon sync off', async () => {
  process.env[APPEARANCE_ENV] = 'dark'
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    iconTheme: 'none',
    iconThemeDark: 'unicode',
    iconThemeSync: true,
    themeSync: false,
  })
  await runCommand(t, 'Unicode shapes')
  await untilFrame(t, 'no longer following the OS appearance')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).iconThemeSync).toBe(
    false
  )

  process.env[APPEARANCE_ENV] = 'light'
  await settle(t, 300)
  expect(savedIcons()).toBe('unicode')
})
