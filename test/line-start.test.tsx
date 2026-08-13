import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, runCommand } from './helpers'

const CONTENT = 'const a = 1\n  const b = 2\n'

/** Ctrl+Opt+B: Opt is an ESC prefix ahead of the Ctrl byte. */
const CTRL_OPT_B = `\x1B${String.fromCharCode(2)}`

async function opened() {
  const dir = fixture({ 'a.ts': CONTENT })
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  return { t, dir }
}

const save = (t: Awaited<ReturnType<typeof opened>>['t']) =>
  press(t, i => i.pressKey('s', { ctrl: true }))

/** Down onto the indented line, then to its end — the caret opens at the top. */
const toEndOfSecondLine = async (t: Awaited<ReturnType<typeof opened>>['t']) => {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressKey('e', { ctrl: true }))
}

test('Ctrl+Opt+B goes to column 0 of the current line', async () => {
  const { t, dir } = await opened()
  await toEndOfSecondLine(t)
  await press(t, i => void i.pressKeys([CTRL_OPT_B]))
  await press(t, i => void i.typeText('x'))
  await save(t)

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\nx  const b = 2\n')
})

test('the palette command does the same', async () => {
  const { t, dir } = await opened()
  await toEndOfSecondLine(t)
  await runCommand(t, 'beginning of line')
  await press(t, i => void i.typeText('x'))
  await save(t)

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\nx  const b = 2\n')
})
