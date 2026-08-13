import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { ALT } from '../src/ui/keys'
import { placeTooltips } from '../src/ui/tooltipLayout'
import { fixture, launch, openFile, settle, until } from './helpers'
import type { Harness } from './helpers'

/** A theme colour as the captured spans report one. */
const rgb = (hex: string) => {
  const at = (from: number) => Number.parseInt(hex.slice(from, from + 2), 16)
  return `${at(1)},${at(3)},${at(5)}`
}

/** Background of the span carrying `text`, or '' where nothing does. */
function spanBg(t: Harness, text: string) {
  const capture = t.captureSpans() as unknown as {
    lines: { spans: { text: string; bg?: { buffer: Record<string, number> } }[] }[]
  }
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (!span.text.includes(text) || !span.bg) continue
      const { buffer } = span.bg
      return `${buffer['0']},${buffer['1']},${buffer['2']}`
    }
  }
  return ''
}

/** Top-left cell of `text` in the frame, for pointing the mouse at it. */
function cellOf(t: Harness, text: string) {
  const lines = t.captureCharFrame().split('\n')
  const y = lines.findIndex(line => line.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: lines[y]!.indexOf(text), y }
}

/**
 * Kitty's own report for a modifier key, which is the only way one arrives:
 * `CSI <code> u` for the press, `;1:3` for the release. mockInput has no
 * spelling for a key with no character, so the bytes go in as the terminal
 * sends them.
 */
const LEFT_CTRL = 57442
const press = (t: Harness) => t.renderer.stdin.emit('data', Buffer.from(`\x1B[${LEFT_CTRL}u`))
const release = (t: Harness) => t.renderer.stdin.emit('data', Buffer.from(`\x1B[${LEFT_CTRL};1:3u`))

/** Long enough for the hold to have counted out. */
const HELD = 700

const kitty = { kittyKeyboard: true }

/**
 * Chords as a tooltip draws them — padded, which is also what keeps them apart
 * from the same spelling in the footer hints or the help table.
 */
const TIP = ' Ctrl+G '
const GIT_TIP = ` Ctrl+${ALT}+G `

describe('tooltip placement', () => {
  test('a control near the top is annotated below it, one near the bottom above', () => {
    const [top] = placeTooltips([{ id: 1, text: ' back ', x: 0, y: 0, width: 3, height: 1 }], {
      width: 40,
      height: 20,
    })
    expect(top).toEqual({ id: 1, text: ' back ', left: 0, top: 1 })

    const [bottom] = placeTooltips([{ id: 2, text: ' save ', x: 4, y: 19, width: 3, height: 1 }], {
      width: 40,
      height: 20,
    })
    expect(bottom).toEqual({ id: 2, text: ' save ', left: 4, top: 18 })
  })

  test('two controls on one row are stacked rather than drawn over each other', () => {
    const placed = placeTooltips(
      [
        { id: 1, text: ' Ctrl+Opt+Z ', x: 0, y: 0, width: 2, height: 1 },
        { id: 2, text: ' Ctrl+Opt+Y ', x: 2, y: 0, width: 2, height: 1 },
      ],
      { width: 40, height: 20 },
    )
    expect(placed.map(tip => tip.top)).toEqual([1, 2])
  })

  test('a tooltip at the right edge is pulled back onto the screen', () => {
    const [tip] = placeTooltips(
      [{ id: 1, text: ' Ln 1, Col 1 ', x: 36, y: 19, width: 3, height: 1 }],
      { width: 40, height: 20 },
    )
    expect(tip!.left).toBe(40 - ' Ln 1, Col 1 '.length)
  })

  test('a tooltip is never drawn over a control, its own or another', () => {
    const [tip] = placeTooltips(
      [{ id: 1, text: ' Ctrl+Opt+Z ', x: 1, y: 0, width: 2, height: 1 }],
      { width: 40, height: 20 },
      // The row under the tab strip is the sidebar's own strip of buttons.
      [
        { x: 1, y: 0, width: 2, height: 1 },
        { x: 1, y: 1, width: 20, height: 1 },
      ],
    )
    expect(tip!.top).toBe(2)
  })

  test('an anchor with nowhere left to go is dropped, not overlapped', () => {
    // Two rows of screen, one already spent on the anchor itself.
    const placed = placeTooltips(
      [
        { id: 1, text: ' one ', x: 0, y: 0, width: 2, height: 1 },
        { id: 2, text: ' two ', x: 0, y: 0, width: 2, height: 1 },
      ],
      { width: 10, height: 2 },
    )
    expect(placed.map(tip => tip.id)).toEqual([1])
  })
})

describe('hover tooltips', () => {
  test('a status bar button gives its key, and says nothing else — the label is on it already', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Ln 1')
    expect(t.captureCharFrame()).not.toContain(TIP)
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(t.captureCharFrame()).toContain(TIP)
    expect(t.captureCharFrame()).not.toContain('Go to line')
  })

  test('a sidebar view button too', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    // With a file open: the welcome screen lists chords too, and this is looking
    // for one of them by its spelling.
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(t.captureCharFrame()).toContain(GIT_TIP)
  })

  test('a hover chip sits against its button, not shifted off a neighbour', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n', 'src/b.ts': 'const b = 2\n' }),
      // Wide enough that the header's ▴ sits under Ext — the neighbour the chip
      // used to walk around, landing on the file list instead of the tab.
      { sidebarWidth: 45 },
      { width: 120 },
    )
    // Tree still has the keyboard: opening a file first would send the arrows
    // into the editor, and the header's ▴ only exists while a folder is open.
    t.mockInput.pressArrow('down')
    t.mockInput.pressArrow('right')
    await until(t, () => t.captureCharFrame().includes('▴'))
    await openFile(t, 'a.ts')

    const at = cellOf(t, 'Ext')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    const tip = `Ctrl+${ALT}+X`
    const tipRow = t
      .captureCharFrame()
      .split('\n')
      .findIndex(line => line.includes(tip))
    expect(tipRow).toBe(at.y + 1)
  })

  test("it is filled in chrome colours, not in the editor's own", async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    // With a file open: the welcome screen lists chords too, and this is looking
    // for one of them by its spelling.
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(spanBg(t, GIT_TIP)).toBe(rgb(ui.statusBg))
    // The tooltip must not read as part of the pane it floats over.
    expect(spanBg(t, GIT_TIP)).not.toBe(rgb(ui.bg))
    expect(spanBg(t, GIT_TIP)).not.toBe(rgb(ui.panelBg))
  })

  test('a button no chord reaches gets none at all', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    // Files is the sidebar's default view: Shift+Tab walks the strip, and no
    // bindable command holds a key for it.
    await openFile(t, 'a.ts')
    const before = t.captureCharFrame()
    const at = cellOf(t, 'Files')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(t.captureCharFrame()).toBe(before)
  })

  test('the tooltip goes away with the pointer', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    // With a file open: the welcome screen lists chords too, and this is looking
    // for one of them by its spelling.
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(t.captureCharFrame()).toContain(GIT_TIP)
    // Into the editor, which is nobody's button.
    await t.mockMouse.moveTo(60, 10)
    await settle(t)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })

  test('nothing is drawn while the setting is off', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { tooltips: false })
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })
})

describe('holding Ctrl', () => {
  test('lights every button that has a key', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    press(t)
    await settle(t, HELD)
    const frame = t.captureCharFrame()
    // The history arrows and the sidebar's own views.
    expect(frame).toContain(`Ctrl+${ALT}+Z`)
    expect(frame).toContain(`Ctrl+${ALT}+X`)
    // The key alone: the buttons are labelled already, so a peek that repeated
    // the labels would be saying nothing new.
    expect(frame).not.toContain('Extensions panel')
  })

  test('the buttons light up with the chords, so it is clear which runs which', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    await openFile(t, 'a.ts')
    expect(spanBg(t, 'Git')).toBe(rgb(ui.sidebarBg))
    // Files is the view on screen, so it is already filled: what matters is that
    // the peek leaves it exactly as it was, having no chord to advertise.
    const files = spanBg(t, 'Files')
    press(t)
    await settle(t, HELD)
    expect(spanBg(t, 'Git')).toBe(rgb(ui.hoverBg))
    expect(spanBg(t, 'Files')).toBe(files)
  })

  test('with tooltips off the hold lights nothing at all', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { tooltips: false }, {}, kitty)
    await openFile(t, 'a.ts')
    press(t)
    await settle(t, HELD)
    expect(spanBg(t, 'Git')).toBe(rgb(ui.sidebarBg))
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })

  test('nothing happens before the hold is up', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    press(t)
    await settle(t, 100)
    expect(t.captureCharFrame()).not.toContain(`Ctrl+${ALT}+Z`)
  })

  test('letting go puts them away', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    press(t)
    await settle(t, HELD)
    expect(t.captureCharFrame()).toContain(`Ctrl+${ALT}+Z`)
    release(t)
    await settle(t)
    expect(t.captureCharFrame()).not.toContain(`Ctrl+${ALT}+Z`)
  })

  test('a chord pressed on the way ends it rather than reading over it', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    press(t)
    await settle(t, HELD)
    expect(t.captureCharFrame()).toContain(`Ctrl+${ALT}+Z`)
    t.mockInput.pressKey('b', { ctrl: true })
    await settle(t)
    expect(t.captureCharFrame()).not.toContain(`Ctrl+${ALT}+Z`)
  })
})
