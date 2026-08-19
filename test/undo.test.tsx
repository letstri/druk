import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openPalette, press, pressTimes, untilFrame } from './helpers'

async function openedFile(dir: string) {
  const t = await launch(dir)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  return t
}

describe('undo and redo', () => {
  test('Ctrl+Z takes back a whole typing burst, Ctrl+Y puts it back', async () => {
    const t = await openedFile(fixture({ 'a.ts': 'start\n' }))
    await press(t, input => void input.typeText('hello'))
    expect(t.captureCharFrame()).toContain('hellostart')

    await press(t, input => input.pressKey('z', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('hellostart')
    expect(t.captureCharFrame()).toContain('start')

    await press(t, input => input.pressKey('y', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('hellostart')
  })

  test('undoing to the original text then saving writes the original', async () => {
    const dir = fixture({ 'a.ts': 'start\n' })
    const t = await openedFile(dir)
    await press(t, input => void input.typeText('junk'))
    await press(t, input => input.pressKey('z', { ctrl: true }))
    await press(t, input => input.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('start\n')
  })

  test('undoing back to the file drops the unsaved mark', async () => {
    const t = await openedFile(fixture({ 'a.ts': 'start\n' }))
    await press(t, input => void input.typeText('junk'))
    expect(t.captureCharFrame()).toContain('unsaved')

    await press(t, input => input.pressKey('z', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('unsaved')
  })

  test('the caret stays where the undone edit was', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
    const t = await openedFile(fixture({ 'a.ts': `${lines}\n` }))
    await pressTimes(t, 20, input => input.pressArrow('down'))
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressKey('z', { ctrl: true }))

    await untilFrame(t, 'Ln 21')
  })

  test('Ctrl+Z with nothing to undo leaves the buffer alone', async () => {
    const t = await openedFile(fixture({ 'a.ts': 'start\n' }))
    await press(t, input => input.pressKey('z', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('start')
  })

  test('the palette runs undo too', async () => {
    const t = await openedFile(fixture({ 'a.ts': 'start\n' }))
    await press(t, input => void input.typeText('typed'))
    expect(t.captureCharFrame()).toContain('typedstart')

    await openPalette(t)
    await press(t, input => void input.typeText('Undo'))
    await press(t, input => input.pressEnter())

    expect(t.captureCharFrame()).not.toContain('typedstart')
    expect(t.captureCharFrame()).toContain('start')
  })
})
