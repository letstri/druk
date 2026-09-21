import { describe, expect, test } from 'bun:test'

import type { MouseEvent, TextareaRenderable } from '@opentui/core'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { ignoreScrollOutsideBounds } from '../src/ui/EditorPane'
import {
  fixture,
  launch,
  openFile,
  pressTimes,
  settle,
  until,
  untilFrame,
} from './helpers'
import { git, initRepo } from './repo'

function fakeEditor(seen: MouseEvent[]) {
  return {
    height: 18,
    onMouseEvent(event: MouseEvent) {
      seen.push(event)
    },
    width: 50,
    x: 30,
    y: 1,
  } as unknown as TextareaRenderable
}

const event = (type: string, x: number, y: number) =>
  ({ type, x, y }) as unknown as MouseEvent

describe('scroll delivered to the focused editor', () => {
  test('is dropped when the pointer is over the sidebar', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)

    ;(
      editor as unknown as { onMouseEvent: (e: MouseEvent) => void }
    ).onMouseEvent(event('scroll', 3, 8))
    expect(seen).toHaveLength(0)
  })

  test('still scrolls when the pointer is over the editor', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(
      editor as unknown as { onMouseEvent: (e: MouseEvent) => void }
    ).onMouseEvent(event('scroll', 59, 8))
    expect(seen).toHaveLength(1)
  })

  test('leaves every other mouse event alone, wherever it lands', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(
      editor as unknown as { onMouseEvent: (e: MouseEvent) => void }
    ).onMouseEvent(event('down', 3, 8))
    expect(seen).toHaveLength(1)
  })
})

test('highlights survive scrolling past an edit that added lines', async () => {
  // The theme is module state shared across the file's tests.
  setTheme('dark')
  invalidateSyntaxStyle()

  const source = `${Array.from(
    { length: 400 },
    (_, i) => `const value${i} = 'text ${i}'`
  ).join('\n')}\n`
  const t = await launch(
    fixture({ 'a.ts': source }),
    {},
    { height: 20, width: 60 }
  )
  await openFile(t, 'a.ts')
  await untilFrame(t, 'value0')

  await pressTimes(t, 200, (i) => i.pressEnter())
  await pressTimes(t, 400, (i) => i.pressArrow('down'))

  const colored = () => {
    const spans = t.captureSpans() as unknown as {
      lines: {
        spans: { text: string; fg?: { buffer: Record<string, number> } }[]
      }[]
    }
    const wanted = (THEMES.dark.syntax.string as { fg: string }).fg.replace(
      '#',
      ''
    )
    const rgb = [0, 2, 4]
      .map((i) => Number.parseInt(wanted.slice(i, i + 2), 16))
      .join(',')
    return spans.lines.some((line) =>
      line.spans.some((span) => {
        const b = span.fg?.buffer
        return (
          span.text.includes("'text") &&
          b &&
          `${b['0']},${b['1']},${b['2']}` === rgb
        )
      })
    )
  }
  await until(t, colored)
}, 30_000)

// The caret reaching an edge is what scrolls, not OpenTUI's 0.2-of-a-pane margin.
// The edge is one row in, not the last: the native margin floors at a row.
test('the view holds until the caret reaches the last row', async () => {
  const source = `${Array.from({ length: 300 }, (_, i) => `line${i}`).join('\n')}\n`
  const t = await launch(
    fixture({ 'a.ts': source }),
    { wrap: false },
    { height: 24, width: 60 }
  )
  await openFile(t, 'a.ts')
  await untilFrame(t, 'line0')

  const topLine = () =>
    t
      .captureCharFrame()
      .split('\n')[1]
      ?.match(/\bline(\d+)/u)?.[1]
  const rows = t
    .captureCharFrame()
    .split('\n')
    .filter((row) => /\bline\d/u.test(row)).length

  await pressTimes(t, rows - 2, (i) => i.pressArrow('down'))
  expect(`caret a row off the bottom, top ${topLine()}`).toBe(
    'caret a row off the bottom, top 0'
  )
  await pressTimes(t, 1, (i) => i.pressArrow('down'))
  expect(`caret on the bottom row, top ${topLine()}`).toBe(
    'caret on the bottom row, top 1'
  )
}, 30_000)

// The tracks and the scrollbar are drawn empty rather than not at all: a pane that
// narrows by one re-wraps every line the reader is on.
test('a change mark arriving re-wraps nothing', async () => {
  const dir = fixture({
    'a.ts': `${Array.from({ length: 200 }, (_, i) => `const v${i} = "${'word '.repeat(12)}"`).join('\n')}\n`,
  })
  initRepo(dir)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'init')

  const t = await launch(dir, {}, { height: 16, width: 70 })
  await openFile(t, 'a.ts')
  await untilFrame(t, 'v0')
  await pressTimes(t, 30, (i) => i.pressArrow('down'))
  await settle(t, 300)
  // How many words each row fits is the wrap; the marks and the gutter are not.
  const widths = () =>
    t
      .captureCharFrame()
      .split('\n')
      .map((row) => row.split('word').length - 1)
      .join(',')
  const before = widths()

  await pressTimes(t, 1, (i) => i.typeText('X'))
  await pressTimes(t, 1, (i) => i.pressKey('s', { ctrl: true }))
  await untilFrame(t, '\u258E')

  expect(widths()).toBe(before)
}, 30_000)
