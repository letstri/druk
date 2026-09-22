import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, pressEscape, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

function manyFiles(count: number) {
  const dir = tempDir('druk-tree-')
  for (let i = 0; i < count; i += 1) {
    writeFileSync(
      join(dir, `f${String(i).padStart(3, '0')}.ts`),
      `const a${i} = ${i}\n`
    )
  }
  return dir
}

const topRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3, 19)
    .map((row) => row.slice(0, 28).trim())
    .find(Boolean) ?? ''

const rowNames = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(1, 19)
    .map((row) => row.slice(0, 30))

async function scrollDown(t: Harness, ticks: number) {
  for (let n = 0; n < ticks; n += 1) {
    await t.mockMouse.scroll(4, 8, 'down')
  }
  await settle(t)
}

describe('the sidebar only scrolls when the selection moves', () => {
  test('changing focus leaves a scrolled tree where it is', async () => {
    const t = await launch(manyFiles(300))
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())

    await scrollDown(t, 40)
    const scrolled = topRow(t)
    expect(scrolled).not.toBe('· f000.ts')

    await pressEscape(t)
    await settle(t)
    expect(topRow(t)).toBe(scrolled)

    await press(t, (input) => input.pressTab())
    await settle(t)
    expect(topRow(t)).toBe(scrolled)
  })

  test('an arrow key still brings the cursor back into view', async () => {
    const t = await launch(manyFiles(300))
    await press(t, (input) => input.pressArrow('down'))

    await scrollDown(t, 40)
    expect(topRow(t)).not.toBe('· f000.ts')

    await press(t, (input) => input.pressArrow('down'))
    await settle(t, 20)
    expect(rowNames(t).join('\n')).toContain('f001.ts')
  })

  test('a scrolled tree is not yanked back by a git refresh', async () => {
    const dir = manyFiles(300)
    const t = await launch(dir)
    await press(t, (input) => input.pressArrow('down'))

    await scrollDown(t, 40)
    const scrolled = topRow(t)

    writeFileSync(join(dir, 'touched.ts'), 'const touched = 1\n')
    // Fixed wait: the assertion is that nothing moved.
    await settle(t, 400)
    expect(topRow(t)).toBe(scrolled)
  })
})

describe('switching sidebar views', () => {
  test('brings the tree back where it was left', async () => {
    const t = await launch(manyFiles(300))
    await scrollDown(t, 40)
    const scrolled = topRow(t)

    await press(t, (input) => input.pressTab({ shift: true }))
    expect(topRow(t)).not.toBe(scrolled)

    await pressEscape(t)
    await settle(t, 60)
    expect(topRow(t)).toBe(scrolled)
  })
})

describe('a terminal taller than the row window', () => {
  test('renders rows all the way down, not just the first 200', async () => {
    const t = await launch(manyFiles(300), {}, { height: 240 })
    await settle(t)
    const frame = t.captureCharFrame().split('\n')

    expect(frame.length).toBeGreaterThan(230)
    expect(frame.some((row) => row.includes('f000.ts'))).toBe(true)
    expect(frame.some((row) => row.includes('f210.ts'))).toBe(true)
    expect(frame.some((row) => row.includes('f230.ts'))).toBe(true)
  })
})

describe('reopening the sidebar', () => {
  test('puts the selected file near the middle, not on the last row', async () => {
    const t = await launch(manyFiles(300), {}, { height: 30 })
    await pressTimes(t, 100, (input) => input.pressArrow('down'))
    await settle(t)

    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    await settle(t, 100)

    const rows = t
      .captureCharFrame()
      .split('\n')
      .map((row) => row.slice(0, 30))
    const at = rows.findIndex((row) => row.includes('f100.ts'))
    expect(at).toBeGreaterThan(8)
    expect(at).toBeLessThan(22)
  })
})
