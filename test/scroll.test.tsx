import { describe, expect, test } from 'bun:test'

import type { MouseEvent, TextareaRenderable } from '@opentui/core'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { ignoreScrollOutsideBounds } from '../src/ui/EditorPane'
import { fixture, launch, openFile, pressTimes, until, untilFrame } from './helpers'

function fakeEditor(seen: MouseEvent[]) {
  return {
    x: 30,
    y: 1,
    width: 50,
    height: 18,
    onMouseEvent(event: MouseEvent) {
      seen.push(event)
    },
  } as unknown as TextareaRenderable
}

const event = (type: string, x: number, y: number) => ({ type, x, y }) as unknown as MouseEvent

describe('scroll delivered to the focused editor', () => {
  test('is dropped when the pointer is over the sidebar', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)

    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('scroll', 3, 8),
    )
    expect(seen).toHaveLength(0)
  })

  test('still scrolls when the pointer is over the editor', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('scroll', 59, 8),
    )
    expect(seen).toHaveLength(1)
  })

  test('leaves every other mouse event alone, wherever it lands', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('down', 3, 8),
    )
    expect(seen).toHaveLength(1)
  })
})

test('highlights survive scrolling past an edit that added lines', async () => {
  // The theme is module state shared across the file's tests.
  setTheme('dark')
  invalidateSyntaxStyle()

  const source = `${Array.from({ length: 400 }, (_, i) => `const value${i} = 'text ${i}'`).join(
    '\n',
  )}\n`
  const t = await launch(fixture({ 'a.ts': source }), {}, { width: 60, height: 20 })
  await openFile(t, 'a.ts')
  await untilFrame(t, 'value0')

  await pressTimes(t, 200, i => i.pressEnter())
  await pressTimes(t, 400, i => i.pressArrow('down'))

  const colored = () => {
    const spans = t.captureSpans() as unknown as {
      lines: { spans: { text: string; fg?: { buffer: Record<string, number> } }[] }[]
    }
    const wanted = (THEMES.dark.syntax.string as { fg: string }).fg.replace('#', '')
    const rgb = [0, 2, 4].map(i => Number.parseInt(wanted.slice(i, i + 2), 16)).join(',')
    return spans.lines.some(line =>
      line.spans.some(span => {
        const b = span.fg?.buffer
        return span.text.includes("'text") && b && `${b['0']},${b['1']},${b['2']}` === rgb
      }),
    )
  }
  await until(t, colored)
}, 30000)
