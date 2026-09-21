import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, pressTimes } from './helpers'
import type { Harness } from './helpers'

const long = `${Array.from({ length: 200 }, (_, index) => `line ${index}`).join('\n')}\n`

const PAGE_UP = '\u001B[5~'
const PAGE_DOWN = '\u001B[6~'

const shown = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .flatMap((row) => row.match(/line \d+/u) ?? [])

const first = (t: Harness) => shown(t)[0]!

async function open(t: Harness) {
  await openFile(t, 'big.ts')
}

describe('page keys scroll the editor', () => {
  test('PageDown then PageUp walks a screen at a time and comes back', async () => {
    const t = await launch(fixture({ 'big.ts': long }))
    await open(t)
    expect(first(t)).toBe('line 0')

    await press(t, (i) => i.pressKeys([PAGE_DOWN]))
    const top = first(t)
    expect(Number(top.slice(5))).toBeGreaterThan(10)
    expect(shown(t)).toContain(top)

    await press(t, (i) => i.pressKeys([PAGE_DOWN]))
    expect(Number(first(t).slice(5))).toBeGreaterThan(Number(top.slice(5)))

    await press(t, (i) => i.pressKeys([PAGE_UP]))
    expect(first(t)).toBe(top)
    await press(t, (i) => i.pressKeys([PAGE_UP]))
    expect(first(t)).toBe('line 0')
  })

  test('Ctrl+D pages down, for keyboards with no page keys — Ctrl+U does not page back', async () => {
    const t = await launch(fixture({ 'big.ts': long }))
    await open(t)

    await press(t, (i) => i.pressKey('d', { ctrl: true }))
    const top = first(t)
    expect(top).not.toBe('line 0')

    // Ctrl+U is the buffer's delete-to-line-start: a Mac sends it for Cmd+Backspace.
    await press(t, (i) => i.pressKey('u', { ctrl: true }))
    expect(first(t)).toBe(top)

    await press(t, (i) => i.pressKeys([PAGE_UP]))
    expect(first(t)).toBe('line 0')
  })

  test('paging does not edit the buffer', async () => {
    const t = await launch(fixture({ 'big.ts': long }))
    await open(t)

    await press(t, (i) => i.pressKey('d', { ctrl: true }))
    await press(t, (i) => i.pressKeys([PAGE_DOWN, PAGE_UP, PAGE_UP]))

    expect(shown(t)[0]).toBe('line 0')
    expect(t.captureCharFrame()).not.toContain('●')
  })

  test('paging stops at the end of the file instead of scrolling past it', async () => {
    const t = await launch(fixture({ 'big.ts': long }))
    await open(t)

    await pressTimes(t, 40, (i) => i.pressKeys([PAGE_DOWN]))
    expect(shown(t)).toContain('line 199')
  })
})
