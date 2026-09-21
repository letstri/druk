import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { freePath } from '../src/core/fs'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  pressTimes,
  settle,
} from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'alpha.ts': 'const alpha = 1\n',
  'lib/other.ts': 'const other = 1\n',
  'src/keep.ts': 'const keep = 1\n',
}

async function open(t: Harness, name: string) {
  await openFile(t, name)
  await pressEscape(t)
  await settle(t, 80)
}

async function selectNth(t: Harness, steps: number) {
  await pressTimes(t, steps, (input) => input.pressArrow('down'))
}

describe('freePath', () => {
  test('takes the name as it is when nothing is in the way', () => {
    const dir = fixture(PROJECT)
    expect(freePath(dir, 'new.ts')).toBe(join(dir, 'new.ts'))
  })

  test('suffixes before the extension, and counts up from there', () => {
    const dir = fixture({ 'a copy 2.ts': '', 'a copy.ts': '', 'a.ts': '' })
    expect(freePath(dir, 'a.ts')).toBe(join(dir, 'a copy 3.ts'))
  })

  test('a dotfile keeps its name whole — the leading dot is not an extension', () => {
    const dir = fixture({ '.env': '' })
    expect(freePath(dir, '.env')).toBe(join(dir, '.env copy'))
  })
})

describe('copying a file with c and p', () => {
  test('into another folder, leaving the original alone', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')

    await press(t, (input) => input.typeText('c'))
    expect(t.captureCharFrame()).toContain('Copied alpha.ts')

    await press(t, (input) => input.pressArrow('up'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(readFileSync(join(dir, 'src/alpha.ts'), 'utf-8')).toBe(
      'const alpha = 1\n'
    )
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
    expect(t.captureCharFrame()).toContain('Copied alpha.ts to src/')
  })

  test('beside itself, which is how a file is duplicated', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')

    await press(t, (input) => input.typeText('c'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(readFileSync(join(dir, 'alpha copy.ts'), 'utf-8')).toBe(
      'const alpha = 1\n'
    )
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
  })

  test('the clipboard survives the paste, so it can be dropped again', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')

    await press(t, (input) => input.typeText('c'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'alpha copy.ts'))).toBe(true)
    expect(existsSync(join(dir, 'alpha copy 2.ts'))).toBe(true)
  })

  test('a folder goes with everything inside it', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 2)
    await press(t, (input) => input.typeText('c'))
    await press(t, (input) => input.pressArrow('up'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(readFileSync(join(dir, 'lib/src/keep.ts'), 'utf-8')).toBe(
      'const keep = 1\n'
    )
    expect(existsSync(join(dir, 'src/keep.ts'))).toBe(true)
  })

  test('a folder refuses to be copied inside itself', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 2)
    await press(t, (input) => input.typeText('c'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('Cannot copy src into itself')
    expect(existsSync(join(dir, 'src/src'))).toBe(false)
  })

  test('pasting with nothing taken says so', async () => {
    const t = await launch(fixture(PROJECT))
    await selectNth(t, 1)
    await press(t, (input) => input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('Nothing taken')
  })

  test('Esc drops a copy without touching anything', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')

    await press(t, (input) => input.typeText('c'))
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('Copy cancelled')

    await press(t, (input) => input.typeText('p'))
    await settle(t)
    expect(existsSync(join(dir, 'alpha copy.ts'))).toBe(false)
  })

  test('a cut is still spent by its paste, unlike a copy', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')

    await press(t, (input) => input.typeText('x'))
    await press(t, (input) => input.pressArrow('up'))
    await press(t, (input) => input.typeText('p'))
    await settle(t)
    expect(existsSync(join(dir, 'src/alpha.ts'))).toBe(true)

    await press(t, (input) => input.typeText('p'))
    await settle(t)
    expect(t.captureCharFrame()).toContain('Nothing taken')
  })
})
