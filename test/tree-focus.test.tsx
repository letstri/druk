import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { fixture, launch, openFile, press, pressEscape } from './helpers'

interface Span {
  text: string
  bg?: { buffer: Uint8Array }
}
interface Frame {
  lines: { spans: Span[] }[]
}

const hex = (bg: Span['bg']) =>
  bg
    ? `#${Array.from(bg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
    : undefined

function selectedRow(frame: Frame): string {
  const marks = new Set([ui.treeSelectedBg.toLowerCase(), ui.treeFocusBg.toLowerCase()])
  for (const line of frame.lines) {
    if (marks.has(hex(line.spans[0]?.bg) ?? '')) {
      return line.spans
        .map(span => span.text)
        .join('')
        .trim()
    }
  }
  return ''
}

describe('focusing the tree', () => {
  test('reveals and scrolls to the file opened from the picker', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 30; index++) {
      files[`deep/nested/f${index}.ts`] = `const a${index} = 1\n`
    }
    const t = await launch(fixture(files))

    await openFile(t, 'f21.ts')
    await pressEscape(t)

    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('f21.ts')

    await press(t, input => input.pressArrow('down'))
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('f22.ts')
  })

  test('follows the active tab even while the editor has focus', async () => {
    const files: Record<string, string> = { 'aaa.ts': 'const first = 1\n' }
    for (let index = 0; index < 40; index++) files[`filler-${index}.ts`] = 'x\n'
    files['zzz.ts'] = 'const last = 2\n'
    const t = await launch(fixture(files))

    const open = async (name: string) => {
      await openFile(t, name)
    }
    await open('aaa.ts')
    await open('zzz.ts')
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('zzz.ts')

    await press(t, input => input.pressKey('t', { ctrl: true }))
    await press(t, input => void input.typeText('aaa'))
    await press(t, input => input.pressEnter())
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('aaa.ts')
  })

  test('selects the first row when nothing was selected yet', async () => {
    const t = await launch(fixture({ 'alpha.ts': 'const a = 1\n', 'beta.ts': 'const b = 2\n' }))
    await press(t, input => input.pressArrow('down'))
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('alpha.ts')
  })
})
