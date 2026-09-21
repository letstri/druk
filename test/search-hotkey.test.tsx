import { describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'

const project = { 'a.ts': 'hello world\n', 'b.ts': 'hello again\n' }

async function openedProject() {
  const t = await launch(fixture(project))
  await press(t, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressEnter())
  return t
}

describe('search hotkeys', () => {
  test('Ctrl+R searches the whole project', async () => {
    const t = await openedProject()
    await press(t, (input) => input.pressKey('r', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Search in project')

    await press(t, (input) => input.typeText('hello'))
    await settle(t, 300)
    const frame = t.captureCharFrame()
    expect(frame).toContain('a.ts')
    expect(frame).toContain('b.ts')
  })

  test('Ctrl+F stays scoped to the open file', async () => {
    const t = await openedProject()
    await press(t, (input) => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Search in file')
  })

  test('Ctrl+Opt+F reaches the project search, as Terminal.app spells it', async () => {
    const t = await openedProject()
    // Esc-prefixed Ctrl+F: what Opt puts on the wire.
    await press(t, (input) => input.pressKeys(['\u001B\u0006']))
    expect(t.captureCharFrame()).toContain('Search in project')
  })
})
