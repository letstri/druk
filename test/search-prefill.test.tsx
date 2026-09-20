import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const alpha = 1\nconst beta = alpha + 1\n' }

async function withOpenFile() {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  return t
}

async function selectOnFirstRow(t: Harness, word: string) {
  // Read off the frame: the editor's first column moves with the sidebar width.
  const row = t.captureCharFrame().split('\n')[2]!
  const from = row.indexOf(word)
  await t.mockMouse.drag(from, 2, from + word.length, 2)
  await settle(t)
}

describe('search opens on what is selected', () => {
  test('a selected word is already typed in, with its matches listed', async () => {
    const t = await withOpenFile()
    await selectOnFirstRow(t, 'alpha')

    await press(t, input => input.pressKey('f', { ctrl: true }))
    const frame = t.captureCharFrame()
    expect(frame).toContain('Search in file')
    expect(frame).toContain('alpha')
    expect(frame).toContain('1 of 2')
  })

  test('project search takes it too', async () => {
    const t = await withOpenFile()
    await selectOnFirstRow(t, 'alpha')

    await press(t, input => input.pressKey('r', { ctrl: true }))
    await settle(t, 200)
    expect(t.captureCharFrame()).toContain('Search in project')
    expect(t.captureCharFrame()).toContain('1 of 2')
  })

  test('a selection made with Shift+arrows counts as much as a drag', async () => {
    const t = await withOpenFile()
    for (let i = 0; i < 5; i++) t.mockInput.pressArrow('right', { shift: true })
    await settle(t)

    await press(t, input => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('Type at least 2 characters')
    expect(t.captureCharFrame()).toContain('1 of 2')
  })

  test('a selection spanning lines is left behind — it would match nothing', async () => {
    const t = await withOpenFile()
    const row = t.captureCharFrame().split('\n')[1]!
    const from = row.indexOf('const')
    await t.mockMouse.drag(from, 1, from + 6, 2)
    await settle(t)

    await press(t, input => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Type at least 2 characters')
  })

  test('with nothing selected the field is empty, as before', async () => {
    const t = await withOpenFile()

    await press(t, input => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Type at least 2 characters')
  })
})
