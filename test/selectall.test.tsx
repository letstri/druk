import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press } from './helpers'

const CONTENT = 'first line\nsecond line\nthird line\n'

async function openedFile() {
  const dir = fixture({ 'a.ts': CONTENT })
  const t = await launch(dir)
  await press(t, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressEnter())
  return { dir, t }
}

const save = (t: Awaited<ReturnType<typeof openedFile>>['t']) =>
  press(t, (input) => input.pressKey('s', { ctrl: true }))

describe('Ctrl+A', () => {
  test('selects the buffer, so typing replaces all of it', async () => {
    const { t, dir } = await openedFile()
    await press(t, (input) => input.pressKey('a', { ctrl: true }))
    await press(t, (input) => input.typeText('replaced'))
    await save(t)

    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('replaced')
  })

  test('backspace after it empties the file', async () => {
    const { t, dir } = await openedFile()
    await press(t, (input) => input.pressKey('a', { ctrl: true }))
    await press(t, (input) => input.pressBackspace())
    await save(t)

    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('')
  })

  test('a mouse selection is replaced by typing too', async () => {
    const { t, dir } = await openedFile()
    await t.mockMouse.drag(35, 1, 40, 1)
    await press(t, (input) => input.typeText('X'))
    await save(t)

    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
      'X line\nsecond line\nthird line\n'
    )
  })

  test('undo brings the whole file back', async () => {
    const { t, dir } = await openedFile()
    await press(t, (input) => input.pressKey('a', { ctrl: true }))
    await press(t, (input) => input.typeText('gone'))
    await press(t, (input) => input.pressKey('z', { ctrl: true }))
    await save(t)

    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(CONTENT)
  })
})
