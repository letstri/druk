import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, pressEscape, pressTimes, settle, until } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'alpha.ts': 'const alpha = 1\n',
  'src/keep.ts': 'const keep = 1\n',
  'lib/other.ts': 'const other = 1\n',
}

async function open(t: Harness, name: string) {
  await openFile(t, name)
  await pressEscape(t)
  await settle(t, 80)
}

// `steps` is 1-based: the tree starts unselected, so the first ↓ lands on row 0.
async function selectNth(t: Harness, steps: number) {
  await pressTimes(t, steps, input => input.pressArrow('down'))
}

describe('moving a file with x and p', () => {
  test('into a folder, with the tab following it', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')
    expect(t.captureCharFrame()).toContain('const alpha = 1')

    await press(t, input => void input.typeText('x'))
    expect(t.captureCharFrame()).toContain('Cut alpha.ts')

    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'src/alpha.ts'))).toBe(true)
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(false)
    expect(t.captureCharFrame()).toContain('Moved alpha.ts to src/')
    expect(t.captureCharFrame().split('\n')[0]).toContain('alpha.ts')
    expect(t.captureCharFrame()).toContain('const alpha = 1')
  })

  test('unsaved edits survive the move and save to the new path', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')
    await press(t, input => input.pressTab())
    await press(t, input => void input.typeText('EDIT'))
    expect(t.captureCharFrame()).toContain('unsaved')
    await pressEscape(t)
    await settle(t, 80)

    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(readFileSync(join(dir, 'src/alpha.ts'), 'utf8')).toContain('EDIT')
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(false)
  })

  test('dropping onto a file means the folder that file is in', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 2)
    await press(t, input => input.pressEnter())
    await settle(t)

    await selectNth(t, 2)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'src/alpha.ts'))).toBe(true)
  })

  test('Esc cancels a pending cut', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 3)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressEscape())
    await settle(t, 80)
    expect(t.captureCharFrame()).toContain('Move cancelled')

    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)
    expect(t.captureCharFrame()).toContain('Nothing taken')
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
  })
})

describe('moving a folder', () => {
  test('takes the tabs inside it along', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'keep.ts')
    expect(t.captureCharFrame()).toContain('const keep = 1')

    await press(t, input => input.pressArrow('left'))
    await press(t, input => input.pressArrow('left'))
    await settle(t)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'lib/src/keep.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src'))).toBe(false)

    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(existsSync(join(dir, 'src'))).toBe(false)
    expect(readFileSync(join(dir, 'lib/src/keep.ts'), 'utf8')).toBe('const keep = 1\n')
  })

  test('refuses to move into itself', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 2)
    await press(t, input => void input.typeText('x'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('into itself')
    expect(existsSync(join(dir, 'src/keep.ts'))).toBe(true)
  })

  test('refuses to move into a folder inside itself', async () => {
    const dir = fixture({ 'a/b/c.ts': 'x\n', 'other.ts': 'y\n' })
    const t = await launch(dir)
    await selectNth(t, 1)
    await press(t, input => input.pressEnter())
    await settle(t)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('into itself')
    expect(existsSync(join(dir, 'a/b/c.ts'))).toBe(true)
  })

  test('reports a name that is already taken instead of clobbering it', async () => {
    const dir = fixture({ 'one/dup.ts': 'first\n', 'two/dup.ts': 'second\n' })
    const t = await launch(dir)
    await selectNth(t, 1)
    await press(t, input => input.pressEnter())
    await settle(t)
    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('already exists')
    expect(readFileSync(join(dir, 'two/dup.ts'), 'utf8')).toBe('second\n')
    expect(readFileSync(join(dir, 'one/dup.ts'), 'utf8')).toBe('first\n')
  })
})

describe('clicking a row', () => {
  const rowOf = (t: Harness, name: string) =>
    t
      .captureCharFrame()
      .split('\n')
      .findIndex(
        row =>
          row
            .slice(0, 28)
            .replaceAll(/[│▾▸·]/g, '')
            .trim() === name,
      )

  test('selects and opens it, and moves nothing', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    const row = rowOf(t, 'alpha.ts')

    await t.mockMouse.click(4, row)
    await settle(t)

    expect(t.captureCharFrame()).toContain('const alpha = 1')
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
    expect(t.captureCharFrame()).not.toContain('Moved')
  })
})

test('a batch move takes the open tabs with it', async () => {
  const dir = fixture({ 'one.ts': 'const one = 1\n', 'two.ts': 'const two = 2\n', 'lib/.keep': '' })
  const t = await launch(dir)

  for (const name of ['one.ts', 'two.ts']) {
    await openFile(t, name)
  }

  await pressEscape(t)
  await press(t, i => i.pressArrow('up'))
  await press(t, i => i.pressArrow('down', { shift: true }))
  await press(t, i => void i.typeText('x'))
  await press(t, i => i.pressArrow('up'))
  await press(t, i => i.pressArrow('up'))
  await press(t, i => void i.typeText('p'))
  await until(t, () => existsSync(join(dir, 'lib/two.ts')))

  expect(readFileSync(join(dir, 'lib/one.ts'), 'utf8')).toBe('const one = 1\n')

  await press(t, i => i.pressTab())
  await press(t, i => void i.typeText('X'))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t, 100)

  expect(existsSync(join(dir, 'two.ts'))).toBe(false)
  expect(existsSync(join(dir, 'one.ts'))).toBe(false)
  expect(readFileSync(join(dir, 'lib/two.ts'), 'utf8')).toContain('X')
})
