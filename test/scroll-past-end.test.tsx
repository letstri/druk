import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { fixture, launch, openFile, press, settle, untilFrame } from './helpers'
import type { Harness } from './helpers'

const long = `${Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n')}\n`

/** Publishes and clears one diagnostic on a timer, the way a busy server does. */
const TICK = join(import.meta.dir, 'fixtures', 'tick-lsp.ts')

/** First line number in the gutter, i.e. where the viewport sits. */
function topLine(t: Harness): number {
  const row = t.captureCharFrame().split('\n')[1]!
  return Number(row.trim().split(/\s+/)[0])
}

/** Open with the sidebar hidden, so the gutter is the first thing on a row. */
async function openAlone(name: string, content: string, config: Parameters<typeof launch>[1] = {}) {
  const t = await launch(fixture({ [name]: content }), config)
  await openFile(t, name)
  await press(t, input => input.pressKey('b', { ctrl: true }))
  await settle(t)
  return t
}

/** Wheel the editor down until it stops moving. */
async function scrollToBottom(t: Harness) {
  let last = -1
  for (let turn = 0; turn < 200 && topLine(t) !== last; turn++) {
    last = topLine(t)
    for (let tick = 0; tick < 10; tick++) await t.mockMouse.scroll(20, 10, 'down')
    await settle(t)
  }
  return topLine(t)
}

describe('scrolling past the last line', () => {
  test('the wheel carries on until the last line is at the top', async () => {
    const t = await openAlone('big.ts', long)

    // The file's last line, with only the trailing empty one under it.
    expect(await scrollToBottom(t)).toBe(400)
    const frame = t.captureCharFrame()
    expect(frame).toContain('line 399')
    // Everything under it is empty: the line before the last is off screen.
    expect(frame).not.toContain('line 398')
  })

  test('off, the file stops with its last line at the bottom', async () => {
    const t = await openAlone('big.ts', long, { scrollPastEnd: false })

    expect(await scrollToBottom(t)).toBeLessThan(400)
    const frame = t.captureCharFrame()
    expect(frame).toContain('line 399')
    expect(frame).toContain('line 398')
  })

  test('scrolling back up fills the pane again', async () => {
    const t = await openAlone('big.ts', long)
    await scrollToBottom(t)

    for (let tick = 0; tick < 20; tick++) await t.mockMouse.scroll(20, 10, 'up')
    await settle(t)

    const frame = t.captureCharFrame()
    expect(topLine(t)).toBeLessThan(384)
    // Full again: the row above the status bar carries a line of the file.
    expect(frame.split('\n').at(-3)).toContain('line ')
  })

  test('a diagnostic coming and going leaves the view where it was', async () => {
    const dir = fixture({ 'a.ts': `oops\n${long}` })
    const t = await launch(dir, {
      lsp: true,
      lspServers: { typescript: [process.execPath, TICK] },
    })
    await openFile(t, 'a.ts')
    await press(t, input => input.pressKey('b', { ctrl: true }))
    await untilFrame(t, '● 1', 15_000)
    const top = await scrollToBottom(t)
    expect(top).toBeGreaterThan(395)

    // The server publishes and clears the same error on a timer, which is what
    // adds and removes the problem track beside the scrollbar — a one-column
    // resize of the pane, and one that used to re-clamp the viewport.
    await settle(t, 600)
    expect(topLine(t)).toBe(top)
  }, 30_000)

  test('a file that fits the pane stays put', async () => {
    const t = await openAlone('tiny.ts', 'one\ntwo\nthree\n')

    for (let tick = 0; tick < 10; tick++) await t.mockMouse.scroll(20, 5, 'down')
    await settle(t)

    expect(topLine(t)).toBe(1)
    expect(t.captureCharFrame()).toContain('one')
  })
})
