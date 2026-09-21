import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Config } from '../src/core/config'
import { fixture, launch, press } from './helpers'

async function editor(content: string, config: Partial<Config> = {}) {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir, config)
  await press(t, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressEnter())
  const saved = async () => {
    await press(t, (input) => input.pressKey('s', { ctrl: true }))
    return readFileSync(join(dir, 'a.ts'), 'utf-8')
  }
  return { saved, t }
}

describe('Tab in the editor', () => {
  test('indents, rather than doing nothing at all', async () => {
    const { t, saved } = await editor('hello\n')
    await press(t, (input) => input.pressTab())
    expect(await saved()).toBe('  hello\n')
  })

  test('aligns to the next tab stop instead of always inserting a full width', async () => {
    const { t, saved } = await editor('hello\n', { tabSize: 4 })
    await press(t, (input) => input.pressArrow('right'))
    await press(t, (input) => input.pressTab())
    expect(await saved()).toBe('h   ello\n')
  })

  test('honours the configured tab size', async () => {
    const { t, saved } = await editor('hello\n', { tabSize: 8 })
    await press(t, (input) => input.pressTab())
    expect(await saved()).toBe('        hello\n')
  })

  test('does not move focus to the tree — Esc does that', async () => {
    const { t } = await editor('hello\n')
    await press(t, (input) => input.pressTab())
    await press(t, (input) => input.typeText('X'))
    expect(t.captureCharFrame()).toContain('X')
    expect(t.captureCharFrame()).toContain('Ln 1')
  })
})

const BACK_TAB = `${String.fromCodePoint(27)}[Z`

describe('Tab over a selection', () => {
  test('indents every line the selection touches, keeping it', async () => {
    const { t, saved } = await editor('one\ntwo\nthree\n')
    // Into the second line: a selection stopping at column 0 does not take that line.
    await press(t, (input) => input.pressArrow('down', { shift: true }))
    await press(t, (input) => input.pressArrow('right', { shift: true }))
    await press(t, (input) => input.pressTab())
    expect(await saved()).toBe('  one\n  two\nthree\n')
    // The selection survives, so a second Tab is a second level rather than two spaces.
    await press(t, (input) => input.pressTab())
    expect(await saved()).toBe('    one\n    two\nthree\n')
  })

  test('Shift+Tab takes one level off each of them', async () => {
    const { t, saved } = await editor('    one\n    two\nthree\n')
    await press(t, (input) => input.pressArrow('down', { shift: true }))
    await press(t, (input) => input.pressArrow('right', { shift: true }))
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    expect(await saved()).toBe('  one\n  two\nthree\n')
  })
})

// Terminals send CSI Z for a back-tab; `pressKey('tab', { shift: true })` types "tab".
describe('Shift+Tab in the editor', () => {
  test('takes one level off the front of the line', async () => {
    const { t, saved } = await editor('    hello\n')
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    expect(await saved()).toBe('  hello\n')
  })

  test('removes only what is there, never past the margin', async () => {
    const { t, saved } = await editor(' hello\n')
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    expect(await saved()).toBe('hello\n')
  })

  test('does nothing on a line with no indentation', async () => {
    const { t, saved } = await editor('hello\n')
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    expect(await saved()).toBe('hello\n')
  })

  test('outdents from wherever the caret sits, not just column 0', async () => {
    const { t, saved } = await editor('    hello\n')
    for (let n = 0; n < 6; n += 1) {
      await press(t, (input) => input.pressArrow('right'))
    }
    await press(t, (input) => input.pressKeys([BACK_TAB]))
    expect(await saved()).toBe('  hello\n')
  })
})

describe('word wrap', () => {
  test('always on, so a long line stays readable without scrolling sideways', async () => {
    const long = `${'word '.repeat(60)}TAIL_MARKER\n`
    const t = await launch(fixture({ 'a.ts': long }))
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())

    expect(t.captureCharFrame()).toContain('TAIL_MARKER')
  })
})
