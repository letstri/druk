import { describe, expect, test } from 'bun:test'

import { fixture, launch, press } from './helpers'

describe('sidebar', () => {
  test('Ctrl+B hides and shows the tree', async () => {
    const t = await launch(fixture({ 'alpha.ts': 'const a = 1\n' }))
    expect(t.captureCharFrame()).toContain('EXPLORER')

    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('EXPLORER')

    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('EXPLORER')
  })

  test('typing goes to the editor while the sidebar is hidden', async () => {
    const t = await launch(fixture({ 'alpha.ts': 'const a = 1\n' }))
    await press(t, (input) => input.pressArrow('down'))
    await press(t, (input) => input.pressEnter())
    await press(t, (input) => input.pressKey('b', { ctrl: true }))
    await press(t, (input) => input.typeText('X'))
    expect(t.captureCharFrame()).toContain('X')
  })
})
