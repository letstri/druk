import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { F1, fixture, launch, openPalette, press, pressEscape } from './helpers'
import type { Harness } from './helpers'

type Input = Harness['mockInput']

const PROJECT = { 'a.ts': 'const a = 1\n' }

async function openedFile(dir: string) {
  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  return t
}

describe('focus after an overlay closes', () => {
  const reopensTyping = (open: (input: Input) => void) => async () => {
    const dir = fixture(PROJECT)
    const t = await openedFile(dir)

    await press(t, open)
    await pressEscape(t)
    await press(t, (i) => i.typeText('X'))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('Xconst a = 1\n')
  }

  test(
    'after the command palette',
    reopensTyping((i) => i.pressKeys([F1]))
  )
  test(
    'after find in file',
    reopensTyping((i) => i.pressKey('f', { ctrl: true }))
  )
  test(
    'after the file picker',
    reopensTyping((i) => i.pressKey('o', { ctrl: true }))
  )
  test(
    'after go to line',
    reopensTyping((i) => i.pressKey('g', { ctrl: true }))
  )
})

describe('chords while the tree has focus', () => {
  const leavesTreeAlone = (letter: string) => async () => {
    const t = await launch(fixture(PROJECT))
    await press(t, (i) => i.pressArrow('down'))

    await press(t, (i) => i.pressKey(letter, { ctrl: true }))
    const frame = t.captureCharFrame()
    expect(frame).not.toContain('Delete')
    expect(frame).not.toContain('Rename to')
    expect(frame).not.toContain('New file name')
  }

  test(
    'Ctrl+D does not offer to delete the selected file',
    leavesTreeAlone('d')
  )
  test('Ctrl+R does not open rename', leavesTreeAlone('r'))
  test('Ctrl+A does not open new file', leavesTreeAlone('a'))
})

describe('closing a tab with unsaved edits', () => {
  test('Ctrl+W asks instead of throwing the edits away', async () => {
    const dir = fixture(PROJECT)
    const t = await openedFile(dir)
    await press(t, (i) => i.typeText('QQQ'))

    await press(t, (i) => i.pressKey('w', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Unsaved changes')
    expect(t.captureCharFrame()).toContain('a.ts')

    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('QQQconst a = 1')
  })

  test('confirming closes it and the file on disk is untouched', async () => {
    const dir = fixture(PROJECT)
    const t = await openedFile(dir)
    await press(t, (i) => i.typeText('QQQ'))

    await press(t, (i) => i.pressKey('w', { ctrl: true }))
    await press(t, (i) => i.pressEnter())

    expect(t.captureCharFrame()).toContain('no open files')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('const a = 1\n')
  })

  test('a saved tab closes without asking', async () => {
    const dir = fixture(PROJECT)
    const t = await openedFile(dir)
    await press(t, (i) => i.typeText('X'))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))

    await press(t, (i) => i.pressKey('w', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('Unsaved changes')
    expect(t.captureCharFrame()).toContain('no open files')
  })

  test('Quit asks too, naming the files', async () => {
    const t = await openedFile(fixture(PROJECT))
    await press(t, (i) => i.typeText('QQQ'))

    await press(t, (i) => i.pressKey('q', { ctrl: true }))
    const frame = t.captureCharFrame()
    expect(frame).toContain('Unsaved changes')
    expect(frame).toContain('a.ts')
    expect(frame).toContain('quit without saving')
  })
})

test('go to line rejects something that is not a line number', async () => {
  const t = await openedFile(fixture({ 'a.ts': 'one\ntwo\n' }))
  await press(t, (i) => i.pressKey('g', { ctrl: true }))
  await press(t, (i) => i.typeText('nonsense'))
  await press(t, (i) => i.pressEnter())

  expect(t.captureCharFrame()).toContain('Not a line number')
})

test('the palette keeps its input and footer on screen when a filter matches everything', async () => {
  const t = await launch(fixture(PROJECT))
  await openPalette(t)
  await press(t, (i) => i.typeText('e'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('Esc close')
  // 20 rows plus the trailing newline
  expect(frame.split('\n').length).toBeLessThanOrEqual(21)
})
