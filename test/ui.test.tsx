import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCommands } from '../src/app/commands'
import type { CommandActions } from '../src/app/commands'
import { fixture, launch, openPalette, press, pressTimes } from './helpers'
import type { Harness } from './helpers'

function rowOf(label: string): number {
  const actions = new Proxy({} as CommandActions, { get: () => () => {} })
  const tree = buildCommands(actions, {
    activeIconTheme: 'none',
    activeTheme: 'dark',
  })
  return tree.findIndex((command) => command.label === label)
}

const PROJECT = {
  'notes.md': '# hi\n',
  'src/main.ts': 'const a = 1\nconst b = 2\n',
}

async function openMain(t: Harness) {
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
}

describe('editor', () => {
  test('shows the tree on start', async () => {
    const t = await launch(fixture(PROJECT))
    const frame = t.captureCharFrame()
    expect(frame).toContain('EXPLORER')
    expect(frame).toContain('src')
    expect(frame).toContain('notes.md')
  })

  test('opens a file with content, tab and line numbers', async () => {
    const t = await launch(fixture(PROJECT))
    await openMain(t)
    const frame = t.captureCharFrame()
    expect(frame).toContain('const a = 1')
    expect(frame).toContain('main.ts')
    expect(frame).toContain(' 1 ')
    expect(frame.split('\n').at(-2)).toContain('ts')
  })

  test('typing then Ctrl+S writes to disk', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await openMain(t)
    await press(t, (i) => i.typeText('X'))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf-8')).toBe(
      'Xconst a = 1\nconst b = 2\n'
    )
  })
})

describe('command palette', () => {
  test('nests into submenus and applies a theme', async () => {
    // Tall enough for the whole root list, which the palette otherwise windows.
    const t = await launch(fixture(PROJECT), {}, { height: 30 })
    await openPalette(t)
    expect(t.captureCharFrame()).toContain('Themes ›')

    await pressTimes(t, rowOf('Themes'), (input) => input.pressArrow('down'))
    await press(t, (i) => i.pressEnter())
    const frame = t.captureCharFrame()
    expect(frame).toContain('GitHub Dark')
    expect(frame).toContain('GitHub Light')
  })

  test('typing filters across levels with breadcrumbs', async () => {
    const t = await launch(fixture(PROJECT))
    await openPalette(t)
    await press(t, (i) => i.typeText('light'))
    expect(t.captureCharFrame()).toContain('Themes ›   GitHub Light')
  })
})

describe('search', () => {
  test('finds a match in the open file and jumps to it', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await openMain(t)
    await press(t, (i) => i.pressKey('f', { ctrl: true }))
    await press(t, (i) => i.typeText('const b'))
    expect(t.captureCharFrame()).toContain('1 of 1')

    await press(t, (i) => i.pressEnter())
    await press(t, (i) => i.typeText('Z'))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf-8')).toBe(
      'const a = 1\nZconst b = 2\n'
    )
  })
})

test('the status bar tracks the cursor, on vertical-only moves too', async () => {
  const t = await launch(fixture({ 'a.ts': 'one\ntwo\nthree\nfour\n' }))
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Ln 1, Col 1')

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('Ln 3, Col 1')

  await press(t, (i) => i.pressArrow('up'))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 1')

  await press(t, (i) => i.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 2')
})
