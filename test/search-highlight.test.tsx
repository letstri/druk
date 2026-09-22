import { describe, expect, test } from 'bun:test'

import {
  fixture,
  launch,
  press,
  pressEscape,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (bg?: { buffer: Uint8Array }) =>
  bg
    ? `#${Array.from(bg.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''

const FILE = [
  'const definer = 1',
  'let other = 2',
  'const definer2 = 3',
  '',
].join('\n')

// The background `definer` is painted on in each of the file's rows — the panel's own
// query field carries that word too, so the rows are picked by what the file holds.
const tints = (t: Harness) =>
  (t.captureSpans() as unknown as Frame).lines
    .filter((line) => line.spans.some((span) => span.text === 'const'))
    .map((line) => hex(line.spans.find((span) => span.text === 'definer')?.bg))

async function search(query: string) {
  const t = await launch(
    fixture({ 'a.ts': FILE }),
    {},
    { height: 34, width: 100 }
  )
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressKey('f', { ctrl: true }))
  await press(t, (i) => i.typeText(query))
  await settle(t, 200)
  return t
}

describe('searching in a file', () => {
  test('tints every hit in the editor, the current one apart', async () => {
    const t = await search('definer')
    const [first, second] = tints(t)

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })

  test('the tint moves with the walk, and goes when the panel does', async () => {
    const t = await search('definer')
    const [first, second] = tints(t)

    await press(t, (i) => i.pressArrow('down'))
    await settle(t)
    expect(tints(t)).toEqual([second!, first!])

    await pressEscape(t)
    await settle(t)
    expect(tints(t)).not.toContain(first!)
    expect(tints(t)).not.toContain(second!)
  })

  test('the file follows the walk without taking the keyboard', async () => {
    const t = await search('definer')
    await untilFrame(t, 'Ln 1, Col 7')

    await press(t, (i) => i.pressArrow('down'))
    await untilFrame(t, 'Ln 3, Col 7')
    // The keyboard is still the panel's: typing narrows the query, it does not edit the file.
    await press(t, (i) => i.typeText('2'))
    await settle(t, 200)
    expect(t.captureCharFrame()).toContain('1 of 1')
    expect(t.captureCharFrame()).toContain('const definer2 = 3')
  })

  test('the panel leaves the file on screen, with no result list of its own', async () => {
    const t = await search('definer')
    const frame = t.captureCharFrame()

    expect(frame).toContain('Search in file')
    expect(frame).toContain('1 of 2')
    expect(frame).toContain('let other = 2')
  })
})
