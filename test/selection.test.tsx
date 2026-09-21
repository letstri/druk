import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, settle } from './helpers'
import type { Harness } from './helpers'

interface SelectionHost {
  renderer?: { getSelection: () => { getSelectedText: () => string } | null }
}

const selected = (t: Harness) =>
  (t as unknown as SelectionHost).renderer?.getSelection()?.getSelectedText() ??
  null

const CONTENT = 'const data = []\nconst beta = 2\n'

async function withOpenFile(content = 'const alpha = 1\nconst beta = 2\n') {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  return { dir, t }
}

const EDITOR_ROW = 1

function colOf(t: Harness, word: string) {
  const row = t.captureCharFrame().split('\n')[EDITOR_ROW]!
  return row.indexOf(word)
}

const save = (t: Harness) =>
  press(t, (input) => input.pressKey('s', { ctrl: true }))

describe('mouse selection', () => {
  test('dragging in the editor still selects, so Ctrl+C has something to copy', async () => {
    const { t } = await withOpenFile()
    // Read off the frame: the editor's first column moves with the sidebar's width.
    const from = colOf(t, 'alpha')
    await t.mockMouse.drag(from, EDITOR_ROW, from + 5, EDITOR_ROW)
    await settle(t)
    expect(selected(t)).toContain('alpha')
  })

  test('a finished drag copies what it selected', async () => {
    const { t } = await withOpenFile()
    const from = colOf(t, 'alpha')
    await t.mockMouse.drag(from, EDITOR_ROW, from + 5, EDITOR_ROW)
    await settle(t)
    expect(t.captureCharFrame()).toContain('Copied alpha')
  })

  test('a drag across many rows copies all of them', async () => {
    const lines = Array.from(
      { length: 400 },
      (_, at) => `const line${at} = ${at}`
    ).join('\n')
    const { t } = await withOpenFile(`${lines}\n`)
    const from = colOf(t, 'const')
    await t.mockMouse.drag(from, EDITOR_ROW, from + 8, EDITOR_ROW + 10)
    await settle(t)
    expect(t.captureCharFrame()).toContain('Copied 11 lines')
  })

  test('dragging over the file tree selects nothing', async () => {
    const { t } = await withOpenFile()
    await t.mockMouse.drag(2, 3, 10, 3)
    await settle(t)
    expect(selected(t)).toBeNull()
  })

  test('dragging over the tab bar selects nothing', async () => {
    const { t } = await withOpenFile()
    await t.mockMouse.drag(2, 0, 10, 0)
    await settle(t)
    expect(selected(t)).toBeNull()
  })

  test('double-click selects the word under the cursor', async () => {
    const { t, dir } = await withOpenFile(CONTENT)
    const at = colOf(t, 'data')
    await t.mockMouse.doubleClick(at, EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const X = []\nconst beta = 2\n'
    )
  })

  test('double-click copies the word it selected', async () => {
    const { t } = await withOpenFile(CONTENT)
    await t.mockMouse.doubleClick(colOf(t, 'data'), EDITOR_ROW)
    await settle(t)
    expect(t.captureCharFrame()).toContain('Copied data')
  })

  test('triple-click selects the whole line', async () => {
    const { t, dir } = await withOpenFile(CONTENT)
    const at = colOf(t, 'data')
    await t.mockMouse.click(at, EDITOR_ROW)
    await t.mockMouse.click(at, EDITOR_ROW)
    await t.mockMouse.click(at, EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('Xconst beta = 2\n')
  })

  test('a single click does not select the word', async () => {
    const { t, dir } = await withOpenFile(CONTENT)
    const at = colOf(t, 'data')
    await t.mockMouse.click(at, EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('data')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('X')
  })

  test('double-click inside a string selects only that word', async () => {
    const { t, dir } = await withOpenFile('const s = "hello world"\n')
    const at = colOf(t, 'hello')
    await t.mockMouse.doubleClick(at, EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const s = "X world"\n'
    )
  })

  test('double-clicking past the end of a line keeps the line break', async () => {
    const { t, dir } = await withOpenFile()
    const at = colOf(t, 'const alpha = 1') + 'const alpha = 1'.length + 3
    await t.mockMouse.doubleClick(at, EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const alpha = 1X\nconst beta = 2\n'
    )
  })

  test('double-clicking a blank line does not eat the blank lines around it', async () => {
    const { t, dir } = await withOpenFile(
      'const alpha = 1\n\n\n\nconst beta = 2\n'
    )
    const at = colOf(t, 'const alpha = 1')
    await t.mockMouse.doubleClick(at, EDITOR_ROW + 1)
    await settle(t)
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const alpha = 1\nX\n\n\nconst beta = 2\n'
    )
  })

  test('a word selection does not outlive the arrow key that leaves it', async () => {
    const { t, dir } = await withOpenFile(CONTENT)
    await t.mockMouse.doubleClick(colOf(t, 'data'), EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const data = []\nconst Xbeta = 2\n'
    )
  })

  test('and so the next left arrow steps, rather than jumping back to it', async () => {
    const { t, dir } = await withOpenFile(CONTENT)
    await t.mockMouse.doubleClick(colOf(t, 'data'), EDITOR_ROW)
    await settle(t)
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressArrow('right'))
    await press(t, (input) => input.pressArrow('left'))
    await press(t, (input) => input.typeText('X'))
    await save(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'const data = []\nconst Xbeta = 2\n'
    )
  })
})
