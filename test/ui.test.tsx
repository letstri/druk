import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCommands } from '../src/app/commands'
import type { CommandActions } from '../src/app/commands'
import { fixture, launch, press } from './helpers'
import type { Harness } from './helpers'

/** Row index of a top-level command, so tests survive new commands. */
function rowOf(label: string): number {
  const actions = new Proxy({} as CommandActions, { get: () => () => {} })
  const tree = buildCommands(actions, {
    vimEnabled: false,
    vscodeKeys: false,
    activeTheme: 'dark',
    tabSize: 2,
    trimOnSave: false,
    autoSaveOnBlur: false,
  })
  return tree.findIndex(command => command.label === label)
}

const PROJECT = {
  'src/main.ts': 'const a = 1\nconst b = 2\n',
  'notes.md': '# hi\n',
}

/** Expand src/ and open src/main.ts from the tree. */
async function openMain(t: Harness) {
  await press(t, i => i.pressArrow('down')) // src/
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressArrow('down')) // src/main.ts
  await press(t, i => i.pressEnter())
}

describe('editor', () => {
  test('shows the tree on start', async () => {
    const t = await launch(fixture(PROJECT))
    const frame = t.captureCharFrame()
    expect(frame).toContain('explorer')
    expect(frame).toContain('src')
    expect(frame).toContain('notes.md')
  })

  test('opens a file with content, tab and line numbers', async () => {
    const t = await launch(fixture(PROJECT))
    await openMain(t)
    const frame = t.captureCharFrame()
    expect(frame).toContain('const a = 1')
    expect(frame).toContain('main.ts')
    expect(frame).toContain(' 1 ') // gutter
    // The status bar, not the tab — 'main.ts' up there matches 'ts' on its own.
    // The frame ends with a newline, so the bar is the last row but one.
    expect(frame.split('\n').at(-2)).toContain('ts')
  })

  test('typing then Ctrl+S writes to disk', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await openMain(t)
    await press(t, i => void i.typeText('X'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe('Xconst a = 1\nconst b = 2\n')
  })
})

describe('command palette', () => {
  test('nests into submenus and applies a theme', async () => {
    const t = await launch(fixture(PROJECT))
    await press(t, i => i.pressKey('p', { ctrl: true }))
    // `›`, the same glyph the title trail and the README use for nesting.
    expect(t.captureCharFrame()).toContain('Themes ›')

    for (let i = 0; i < rowOf('Themes'); i++) await press(t, input => input.pressArrow('down'))
    await press(t, i => i.pressEnter())
    const frame = t.captureCharFrame()
    expect(frame).toContain('GitHub Dark')
    expect(frame).toContain('GitHub Light')
  })

  test('typing filters across levels with breadcrumbs', async () => {
    const t = await launch(fixture(PROJECT))
    await press(t, i => i.pressKey('p', { ctrl: true }))
    await press(t, i => void i.typeText('light'))
    expect(t.captureCharFrame()).toContain('Themes ›   GitHub Light')
  })
})

describe('search', () => {
  test('finds a match in the open file and jumps to it', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await openMain(t)
    await press(t, i => i.pressKey('f', { ctrl: true }))
    await press(t, i => void i.typeText('const b'))
    expect(t.captureCharFrame()).toContain('1 of 1')

    await press(t, i => i.pressEnter())
    await press(t, i => void i.typeText('Z'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe('const a = 1\nZconst b = 2\n')
  })
})

test('the status bar tracks the cursor, on vertical-only moves too', async () => {
  const t = await launch(fixture({ 'a.ts': 'one\ntwo\nthree\nfour\n' }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Ln 1, Col 1')

  // Arrow-down emits no cursor-change event, so this only holds while the
  // readout is refreshed after the key rather than from the event payload.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('Ln 3, Col 1')

  await press(t, i => i.pressArrow('up'))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 1')

  await press(t, i => i.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Ln 2, Col 2')
})
