import { expect, test } from 'bun:test'

import { fixture, launch, openFile, press, untilFrame } from './helpers'
import type { Harness } from './helpers'

// The terminal's own Home/End and their Ctrl forms.
const ESC = String.fromCodePoint(27)
const HOME = `${ESC}[H`
const END = `${ESC}[F`
const CTRL_HOME = `${ESC}[1;5H`
const CTRL_END = `${ESC}[1;5F`
const CTRL_RIGHT = `${ESC}[1;5C`
const CTRL_LEFT = `${ESC}[1;5D`
const CTRL_PGDN = `${ESC}[6;5~`

const at = (t: Harness) => {
  const rows = t.captureCharFrame().split('\n')
  return (rows.at(-2) ?? '').match(/Ln \d+, Col \d+/u)?.[0]
}
const send = (t: Harness, seq: string) =>
  press(t, (input) => input.pressKeys([seq]))

test('Home and End are the line, Ctrl+Home and Ctrl+End the file', async () => {
  const t = await launch(
    fixture({ 'a.ts': 'const alpha = beta\nsecond line here\nthird\n' }),
    { wrap: false },
    { height: 12, width: 70 }
  )
  await openFile(t, 'a.ts')
  await untilFrame(t, 'alpha')
  await press(t, (i) => i.pressArrow('down'))

  await send(t, END)
  expect(at(t)).toBe('Ln 2, Col 17')
  await send(t, HOME)
  expect(at(t)).toBe('Ln 2, Col 1')
  await send(t, CTRL_END)
  expect(at(t)).toBe('Ln 4, Col 1')
  await send(t, CTRL_HOME)
  expect(at(t)).toBe('Ln 1, Col 1')
})

// VS Code's Home/End walk the wrapped row, not the whole logical line.
test('Home and End stop at the wrap', async () => {
  const t = await launch(
    fixture({ 'a.ts': `const m = "${'word '.repeat(30)}"\n` }),
    {},
    { height: 12, width: 60 }
  )
  await openFile(t, 'a.ts')
  await untilFrame(t, 'const m')
  await press(t, (i) => i.pressArrow('down'))

  await send(t, HOME)
  const rowStart = at(t)
  expect(rowStart).not.toBe('Ln 1, Col 1')
  await send(t, END)
  expect(at(t)).not.toBe(rowStart)
  await send(t, HOME)
  expect(at(t)).toBe(rowStart)
})

// Ctrl+←/→ is the word motion every editor on Linux and Windows uses; the tab switch
// it used to answer to keeps Ctrl+Opt+←/→ and Ctrl+PgUp/PgDn.
test('Ctrl+arrow walks by word, and the tabs keep Ctrl+PgUp/PgDn', async () => {
  const t = await launch(
    fixture({
      'a.ts': 'const alpha = beta + gamma\n',
      'b.ts': 'const b = 2\n',
    }),
    { wrap: false },
    { height: 12, width: 70 }
  )
  await openFile(t, 'a.ts')
  await untilFrame(t, 'alpha')

  await send(t, CTRL_RIGHT)
  expect(at(t)).toBe('Ln 1, Col 7')
  await send(t, CTRL_RIGHT)
  expect(at(t)).toBe('Ln 1, Col 13')
  await send(t, CTRL_LEFT)
  expect(at(t)).toBe('Ln 1, Col 7')

  await openFile(t, 'b.ts')
  await send(t, CTRL_PGDN)
  expect(t.captureCharFrame()).toContain('const alpha')
})
