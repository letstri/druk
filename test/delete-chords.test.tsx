import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press } from './helpers'
import type { Harness } from './helpers'

const CONTENT = 'const alpha = beta\n'

async function openEditor() {
  const dir = fixture({ 'a.ts': CONTENT })
  const t = await launch(
    dir,
    {},
    {},
    { kittyKeyboard: true, openFile: join(dir, 'a.ts') }
  )
  // The caret opens at offset 0, where a backward delete is a no-op whatever it is bound to.
  await press(t, (i) => i.pressKey('e', { ctrl: true }))
  return { dir, t }
}

const saved = (t: Harness, dir: string) =>
  press(t, (i) => i.pressKey('s', { ctrl: true })).then(() =>
    readFileSync(join(dir, 'a.ts'), 'utf-8')
  )

test('Cmd+Backspace deletes to the start of the line', async () => {
  const { t, dir } = await openEditor()

  await press(t, (i) => i.pressBackspace({ super: true }))
  expect(await saved(t, dir)).toBe('\n')
})

test('Ctrl+U deletes to the line start — what a Mac sends for Cmd+Backspace', async () => {
  const { t, dir } = await openEditor()

  await press(t, (i) => i.pressKey('u', { ctrl: true }))
  expect(await saved(t, dir)).toBe('\n')
})

test('Ctrl+Backspace deletes a word, as Windows and Linux expect', async () => {
  const { t, dir } = await openEditor()

  await press(t, (i) => i.pressBackspace({ ctrl: true }))
  expect(await saved(t, dir)).toBe('const alpha = \n')
})

test('Opt+Backspace deletes the word before the cursor', async () => {
  const { t, dir } = await openEditor()

  await press(t, (i) => i.pressBackspace({ meta: true }))
  expect(await saved(t, dir)).toBe('const alpha = \n')
})

test('Ctrl+U at the start of a line leaves the line above alone', async () => {
  const dir = fixture({ 'a.ts': 'alpha\nbeta\n' })
  const t = await launch(
    dir,
    {},
    {},
    { kittyKeyboard: true, openFile: join(dir, 'a.ts') }
  )
  await press(t, (i) => i.pressArrow('down'))

  await press(t, (i) => i.pressKey('u', { ctrl: true }))
  expect(await saved(t, dir)).toBe('alpha\nbeta\n')
})
