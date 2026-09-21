import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { ALT } from '../src/ui/keys'
import { placeTooltips } from '../src/ui/tooltipLayout'
import { fixture, launch, openFile, settle, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

const rgb = (hex: string) => {
  const at = (from: number) => Number.parseInt(hex.slice(from, from + 2), 16)
  return `${at(1)},${at(3)},${at(5)}`
}

function spanBg(t: Harness, text: string) {
  const capture = t.captureSpans() as unknown as {
    lines: {
      spans: { text: string; bg?: { buffer: Record<string, number> } }[]
    }[]
  }
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (!span.text.includes(text) || !span.bg) {
        continue
      }
      const { buffer } = span.bg
      return `${buffer['0']},${buffer['1']},${buffer['2']}`
    }
  }
  return ''
}

function cellOf(t: Harness, text: string) {
  const lines = t.captureCharFrame().split('\n')
  const y = lines.findIndex((line) => line.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: lines[y]!.indexOf(text), y }
}

// Kitty's modifier-key report: `CSI <code> u` for the press, `;1:3` for the release.
const LEFT_CTRL = 57_442
const press = (t: Harness) =>
  t.renderer.stdin.emit('data', Buffer.from(`\u001B[${LEFT_CTRL}u`))
const release = (t: Harness) =>
  t.renderer.stdin.emit('data', Buffer.from(`\u001B[${LEFT_CTRL};1:3u`))

const HELD = 700

const RESTED = 600

async function rest(t: Harness, text: string) {
  const at = cellOf(t, text)
  await t.mockMouse.moveTo(at.x, at.y)
  await settle(t, RESTED)
  return at
}

const kitty = { kittyKeyboard: true }

const TIP = ' Ctrl+G '
const GIT_TIP = ` Ctrl+${ALT}+G `
const EXT_TIP = ` Ctrl+${ALT}+X `

describe('tooltip placement', () => {
  test('a control near the top is annotated below it, one near the bottom above', () => {
    const [top] = placeTooltips(
      [{ height: 1, id: 1, text: ' back ', width: 3, x: 0, y: 0 }],
      {
        height: 20,
        width: 40,
      }
    )
    expect(top).toEqual({ id: 1, left: 0, text: ' back ', top: 1 })

    const [bottom] = placeTooltips(
      [{ height: 1, id: 2, text: ' save ', width: 3, x: 4, y: 19 }],
      {
        height: 20,
        width: 40,
      }
    )
    expect(bottom).toEqual({ id: 2, left: 4, text: ' save ', top: 18 })
  })

  test('two controls on one row are stacked rather than drawn over each other', () => {
    const placed = placeTooltips(
      [
        { height: 1, id: 1, text: ' Ctrl+Opt+Z ', width: 2, x: 0, y: 0 },
        { height: 1, id: 2, text: ' Ctrl+Opt+Y ', width: 2, x: 2, y: 0 },
      ],
      { height: 20, width: 40 }
    )
    expect(placed.map((tip) => tip.top)).toEqual([1, 2])
  })

  test('a tooltip at the right edge is pulled back onto the screen', () => {
    const [tip] = placeTooltips(
      [{ height: 1, id: 1, text: ' Ln 1, Col 1 ', width: 3, x: 36, y: 19 }],
      { height: 20, width: 40 }
    )
    expect(tip!.left).toBe(40 - ' Ln 1, Col 1 '.length)
  })

  test('a tooltip is never drawn over a control, its own or another', () => {
    const [tip] = placeTooltips(
      [{ height: 1, id: 1, text: ' Ctrl+Opt+Z ', width: 2, x: 1, y: 0 }],
      { height: 20, width: 40 },
      [
        { height: 1, width: 2, x: 1, y: 0 },
        { height: 1, width: 20, x: 1, y: 1 },
      ]
    )
    expect(tip!.top).toBe(2)
  })

  test('an anchor with nowhere left to go is dropped, not overlapped', () => {
    const placed = placeTooltips(
      [
        { height: 1, id: 1, text: ' one ', width: 2, x: 0, y: 0 },
        { height: 1, id: 2, text: ' two ', width: 2, x: 0, y: 0 },
      ],
      { height: 2, width: 10 }
    )
    expect(placed.map((tip) => tip.id)).toEqual([1])
  })
})

describe('hover tooltips', () => {
  test('a status bar button gives its key, and says nothing else — the label is on it already', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    expect(t.captureCharFrame()).not.toContain(TIP)
    await rest(t, 'Ln 1')
    expect(t.captureCharFrame()).toContain(TIP)
    expect(t.captureCharFrame()).not.toContain('Go to line')
  })

  test('a sidebar view button too', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    await rest(t, 'Git')
    expect(t.captureCharFrame()).toContain(GIT_TIP)
  })

  test('nothing is drawn until the pointer has rested there', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t, 100)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
    await untilFrame(t, GIT_TIP)
  })

  test('a pointer only passing over a button says nothing at all', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    const at = cellOf(t, 'Git')
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t, 100)
    await t.mockMouse.moveTo(60, 10)
    await settle(t, RESTED)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })

  test('moving to the next button counts that one out from the start', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    await rest(t, 'Git')
    expect(t.captureCharFrame()).toContain(GIT_TIP)
    const ext = cellOf(t, 'Ext')
    await t.mockMouse.moveTo(ext.x, ext.y)
    await settle(t, 100)
    const frame = t.captureCharFrame()
    expect(frame).not.toContain(GIT_TIP)
    expect(frame).not.toContain(EXT_TIP)
    await untilFrame(t, EXT_TIP)
  })

  test('a hover chip sits against its button, not shifted off a neighbour', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n', 'src/b.ts': 'const b = 2\n' }),
      { sidebarWidth: 45 },
      { width: 120 }
    )
    t.mockInput.pressArrow('down')
    t.mockInput.pressArrow('right')
    await until(t, () => t.captureCharFrame().includes('▴'))
    await openFile(t, 'a.ts')

    const at = await rest(t, 'Ext')
    const tip = `Ctrl+${ALT}+X`
    const tipRow = t
      .captureCharFrame()
      .split('\n')
      .findIndex((line) => line.includes(tip))
    expect(tipRow).toBe(at.y + 1)
  })

  test("it is filled in chrome colours, not in the editor's own", async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    await rest(t, 'Git')
    expect(spanBg(t, GIT_TIP)).toBe(rgb(ui.statusBg))
    expect(spanBg(t, GIT_TIP)).not.toBe(rgb(ui.bg))
    expect(spanBg(t, GIT_TIP)).not.toBe(rgb(ui.panelBg))
  })

  test('a button no chord reaches gets none at all', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    const before = t.captureCharFrame()
    await rest(t, 'Files')
    expect(t.captureCharFrame()).toBe(before)
  })

  test('the tooltip goes away with the pointer', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    await rest(t, 'Git')
    expect(t.captureCharFrame()).toContain(GIT_TIP)
    await t.mockMouse.moveTo(60, 10)
    await settle(t)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })

  test('a button come back to counts out again', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFile(t, 'a.ts')
    const at = await rest(t, 'Git')
    expect(t.captureCharFrame()).toContain(GIT_TIP)
    await t.mockMouse.moveTo(60, 10)
    await settle(t)
    await t.mockMouse.moveTo(at.x, at.y)
    await settle(t, 100)
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
    await untilFrame(t, GIT_TIP)
  })

  test('nothing is drawn while the setting is off', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
      tooltips: false,
    })
    await openFile(t, 'a.ts')
    await rest(t, 'Git')
    expect(t.captureCharFrame()).not.toContain(GIT_TIP)
  })
})

describe('holding Ctrl', () => {
  test('lights every button that has a key', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    press(t)
    await settle(t, HELD)
    const frame = t.captureCharFrame()
    expect(frame).toContain(`Ctrl+${ALT}+Z`)
    expect(frame).toContain(`Ctrl+${ALT}+X`)
    expect(frame).not.toContain('Extensions panel')
  })

  test('the buttons light up with the chords, so it is clear which runs which', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, kitty)
    await openFile(t, 'a.ts')
    expect(spanBg(t, 'Git')).toBe(rgb(ui.sidebarBg))
    const files = spanBg(t, 'Files')
    press(t)
    await settle(t, HELD)
    expect(spanBg(t, 'Git')).toBe(rgb(ui.hoverBg))
    expect(spanBg(t, 'Files')).toBe(files)
  })

  test('with tooltips off the hold lights nothing at all', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      { tooltips: false },
      {},
      kitty
    )
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
