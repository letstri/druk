import { describe, expect, test } from 'bun:test'

import { contextIn } from '../src/core/search'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'docs/long.md': `${'x'.repeat(200)}capture${'y'.repeat(60)}\nplain line\n`,
  'src/alpha.ts':
    'const capture = 1\nfunction captureAll() {\n  return capture\n}\n',
  'src/beta.ts': '// capture notes\nconst other = 2\n',
}

async function search(
  query: string,
  size: { width?: number; height?: number } = {}
) {
  const t = await launch(
    fixture(PROJECT),
    {},
    { height: 30, width: 100, ...size }
  )
  await press(t, (input) => input.pressKey('r', { ctrl: true }))
  await press(t, (input) => input.typeText(query))
  await settle(t, 300)
  return t
}

const panel = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter((row) => row.includes('│'))
    .map((row) =>
      row.slice(row.indexOf('│') + 1, row.lastIndexOf('│')).trimEnd()
    )

describe('project search results', () => {
  test('group under one heading per file, with a count', async () => {
    const t = await search('capture')
    const rows = panel(t)

    expect(
      rows.some(
        (row) => row.includes('src/alpha.ts') && row.includes('3 matches')
      )
    ).toBe(true)
    expect(
      rows.some((row) => row.includes('src/beta.ts') && row.includes('1 match'))
    ).toBe(true)
    expect(rows.filter((row) => row.includes('src/alpha.ts')).length).toBe(1)
  })

  test('the summary counts files as well as matches', async () => {
    const t = await search('capture')
    expect(panel(t).some((row) => row.includes('1 of 5 in 3 files'))).toBe(true)
  })

  test('a match far along a line is still on screen', async () => {
    const t = await search('capture')
    const rows = panel(t)

    const row = rows.find((r) => r.includes('…'))
    expect(row).toBeDefined()
    expect(row).toContain('capture')
  })

  test('match rows carry the line number instead of the path', async () => {
    const t = await search('capture')
    const rows = panel(t)
    const alpha = rows.indexOf(rows.find((r) => r.includes('src/alpha.ts'))!)

    expect(rows[alpha + 1]).toContain('const capture = 1')
    expect(rows[alpha + 1]).toMatch(/^\s+1\s/u)
    expect(rows[alpha + 2]).toMatch(/^\s+2\s/u)
  })
})

describe('the preview under the results', () => {
  test('shows the lines around the selected match', async () => {
    const t = await search('other')
    const rows = panel(t)

    expect(rows.some((row) => row.includes('// capture notes'))).toBe(true)
    expect(rows.some((row) => row.includes('const other = 2'))).toBe(true)
  })

  test('follows the selection', async () => {
    const t = await search('capture')
    expect(panel(t).some((row) => row.includes('plain line'))).toBe(true)

    await press(t, (input) => input.pressArrow('up'))
    await settle(t)
    const rows = panel(t)
    expect(rows.some((row) => row.includes('5 of 5'))).toBe(true)
    expect(rows.some((row) => row.includes('const other = 2'))).toBe(true)
    expect(rows.some((row) => row.includes('plain line'))).toBe(false)
  })

  test('gives way on a terminal with no room for it', async () => {
    const t = await search('capture', { height: 16 })
    const rows = panel(t)

    expect(rows.some((row) => row.includes('src/alpha.ts'))).toBe(true)
    expect(rows.some((row) => row.includes('Enter jump'))).toBe(true)
    expect(rows.some((row) => row.includes('plain line'))).toBe(false)
    expect(t.captureCharFrame().split('\n').length).toBeLessThanOrEqual(17)
  })
})

describe('folding a file in the results', () => {
  test('Tab hides its matches behind the heading, and gives them back', async () => {
    const t = await search('capture')
    await press(t, (input) => input.pressTab())
    let rows = panel(t)

    expect(
      rows.some((row) => row.includes('docs/long.md') && row.includes('▸'))
    ).toBe(true)
    expect(
      rows.filter((row) => row.includes('…') && row.includes('capture')).length
    ).toBe(1)
    expect(rows.some((row) => row.includes('const capture = 1'))).toBe(true)

    await press(t, (input) => input.pressTab())
    rows = panel(t)
    expect(
      rows.some((row) => row.includes('docs/long.md') && row.includes('▾'))
    ).toBe(true)
    expect(
      rows.filter((row) => row.includes('…') && row.includes('capture')).length
    ).toBe(2)
  })

  test('the selection lands on the heading, and moves past the hidden matches', async () => {
    const t = await search('capture')
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressTab())

    expect(panel(t).some((row) => row.includes('2 of 5'))).toBe(true)
    expect(
      panel(t).filter((row) => row.includes('function captureAll')).length
    ).toBe(1)

    await press(t, (input) => input.pressArrow('down'))
    expect(panel(t).some((row) => row.includes('5 of 5'))).toBe(true)
  })

  test('Shift+Tab folds every file, leaving a list of files to walk', async () => {
    const t = await search('capture')
    await press(t, (input) => input.pressTab({ shift: true }))
    let rows = panel(t)

    expect(rows.filter((row) => row.includes('▸')).length).toBe(3)
    expect(rows.some((row) => row.includes('const capture = 1'))).toBe(false)
    await press(t, (input) => input.pressArrow('down'))
    expect(panel(t).some((row) => row.includes('2 of 5'))).toBe(true)

    await press(t, (input) => input.pressTab({ shift: true }))
    rows = panel(t)
    expect(rows.some((row) => row.includes('▸'))).toBe(false)
    expect(rows.some((row) => row.includes('2 of 5'))).toBe(true)
  })

  test('Enter on a folded file opens it back up instead of jumping', async () => {
    const t = await search('capture')
    await press(t, (input) => input.pressTab())
    await press(t, (input) => input.pressEnter())

    const rows = panel(t)
    expect(
      rows.some((row) => row.includes('docs/long.md') && row.includes('▾'))
    ).toBe(true)
    expect(rows.some((row) => row.includes('Enter jump'))).toBe(true)
  })

  test('typing a new query starts with every file open', async () => {
    const t = await search('capture')
    await press(t, (input) => input.pressTab())
    expect(panel(t).some((row) => row.includes('▸'))).toBe(true)

    await press(t, (input) => input.typeText('A'))
    await settle(t, 300)
    expect(panel(t).some((row) => row.includes('▸'))).toBe(false)
    expect(panel(t).some((row) => row.includes('captureAll'))).toBe(true)
  })
})

describe('contextIn', () => {
  const TEXT = 'one\ntwo\nthree\nfour\nfive\n'

  test('clamps at the top of the file', () => {
    expect(contextIn(TEXT, 0, 2)).toEqual({
      lines: ['one', 'two', 'three'],
      start: 0,
    })
  })

  test('clamps at the end of the file', () => {
    expect(contextIn(TEXT, 4, 2)).toEqual({
      lines: ['three', 'four', 'five', ''],
      start: 2,
    })
  })
})
