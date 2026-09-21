import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (bg?: { buffer: Uint8Array }) =>
  bg
    ? `#${Array.from(bg.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''

function selectedRow(t: Harness): string {
  const marks = new Set([
    ui.treeSelectedBg.toLowerCase(),
    ui.treeFocusBg.toLowerCase(),
  ])
  for (const line of (t.captureSpans() as unknown as Frame).lines) {
    if (marks.has(hex(line.spans[0]?.bg))) {
      return line.spans
        .map((span) => span.text)
        .join('')
        .trim()
    }
  }
  return ''
}

const project = { 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' }

async function deleteRow(t: Harness, downs: number) {
  for (let step = 0; step < downs; step += 1) {
    await press(t, (input) => input.pressArrow('down'))
  }
  await press(t, (input) => input.typeText('d'))
  await press(t, (input) => input.pressEnter())
  await settle(t)
}

describe('deleting from the tree', () => {
  test('lands on the file that took its place', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 2)

    expect(selectedRow(t)).toContain('c.ts')
  })

  test('so the next arrow key carries on from there', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 2)

    await press(t, (input) => input.pressArrow('up'))
    expect(selectedRow(t)).toContain('a.ts')
  })

  test('falls back to the last row when the last file goes', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 3)

    expect(selectedRow(t)).toContain('b.ts')
  })

  test('an empty project leaves nothing selected, and does not crash', async () => {
    const t = await launch(fixture({ 'only.ts': 'x\n' }))
    await deleteRow(t, 1)

    expect(selectedRow(t)).toBe('')
    await press(t, (input) => input.pressArrow('down'))
    expect(t.captureCharFrame()).toContain('EXPLORER')
  })

  test('deleting an expanded folder lands after everything it held', async () => {
    const t = await launch(
      fixture({ 'src/one.ts': '1\n', 'src/two.ts': '2\n', 'z.ts': 'z\n' })
    )
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())
    await deleteRow(t, 0)

    expect(selectedRow(t)).toContain('z.ts')
  })
})
