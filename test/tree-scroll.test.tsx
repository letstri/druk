import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** Enough top-level files that the tree scrolls. */
function manyFiles(count: number) {
  const dir = tempDir('druk-tree-')
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.ts`), `const a${i} = ${i}\n`)
  }
  return dir
}

/** Name on the first tree row, i.e. where the sidebar is scrolled to. */
const topRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3, 19)
    .map(row => row.slice(0, 28).trim())
    .find(Boolean) ?? ''

const rowNames = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(1, 19)
    .map(row => row.slice(0, 30))

/** Wheel the tree down, flushing once at the end rather than per tick. */
async function scrollDown(t: Harness, ticks: number) {
  for (let n = 0; n < ticks; n++) await t.mockMouse.scroll(4, 8, 'down')
  await settle(t)
}

describe('the sidebar only scrolls when the selection moves', () => {
  test('changing focus leaves a scrolled tree where it is', async () => {
    const t = await launch(manyFiles(300))
    await press(t, input => input.pressArrow('down')) // select f000
    await press(t, input => input.pressEnter()) // open it, focus the editor

    await scrollDown(t, 40)
    const scrolled = topRow(t)
    expect(scrolled).not.toBe('· f000.ts')

    // Esc only moves focus to the tree. Nothing was chosen, so nothing should move —
    // this used to snap the view back to the selection.
    await pressEscape(t)
    await settle(t)
    expect(topRow(t)).toBe(scrolled)

    // Tab back to the editor: still no movement.
    await press(t, input => input.pressTab())
    await settle(t)
    expect(topRow(t)).toBe(scrolled)
  })

  test('an arrow key still brings the cursor back into view', async () => {
    const t = await launch(manyFiles(300))
    await press(t, input => input.pressArrow('down')) // select f000

    await scrollDown(t, 40)
    expect(topRow(t)).not.toBe('· f000.ts')

    // Navigating changes the selection, which is what earns a scroll.
    await press(t, input => input.pressArrow('down'))
    await settle(t, 20)
    expect(rowNames(t).join('\n')).toContain('f001.ts')
  })

  test('a scrolled tree is not yanked back by a git refresh', async () => {
    const dir = manyFiles(300)
    const t = await launch(dir)
    await press(t, input => input.pressArrow('down'))

    await scrollDown(t, 40)
    const scrolled = topRow(t)

    // The watcher rebuilds the node list; the index of the selection is unchanged.
    writeFileSync(join(dir, 'touched.ts'), 'const touched = 1\n')
    // A fixed wait, deliberately: the assertion is that nothing moved, so there
    // is no arrival to poll for — the watcher's 80ms debounce has to be given
    // its chance to fire and rebuild before the frame is worth reading.
    await settle(t, 400)
    expect(topRow(t)).toBe(scrolled)
  })
})

describe('a terminal taller than the row window', () => {
  /**
   * The window used to be a flat 200 rows, so on a very tall terminal the bottom of
   * the tree had no renderables at all and simply came up blank.
   */
  test('renders rows all the way down, not just the first 200', async () => {
    const t = await launch(manyFiles(300), {}, { height: 240 })
    await settle(t)
    const frame = t.captureCharFrame().split('\n')

    // Row 3 is the first file; the viewport reaches well past row 200.
    expect(frame.length).toBeGreaterThan(230)
    expect(frame.some(row => row.includes('f000.ts'))).toBe(true)
    expect(frame.some(row => row.includes('f210.ts'))).toBe(true)
    expect(frame.some(row => row.includes('f230.ts'))).toBe(true)
  })
})
