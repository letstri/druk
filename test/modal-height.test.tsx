import { describe, expect, test } from 'bun:test'

import { fixture, launch, openPalette, press } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'src/alpha.ts': 'const a = 1\n', 'src/beta.ts': 'const b = 2\n' }

function frame(t: Harness) {
  const rows = t.captureCharFrame().split('\n')
  return {
    top: rows.findIndex(row => row.includes('╭')),
    bottom: rows.findIndex(row => row.includes('╰')),
  }
}

describe('modal height', () => {
  test('the command palette holds its frame while filtering', async () => {
    const t = await launch(fixture(PROJECT), {}, { width: 100, height: 30 })
    await openPalette(t)

    const before = frame(t)
    expect(before.top).toBeGreaterThanOrEqual(0)
    expect(before.bottom).toBeGreaterThan(before.top)

    await press(t, input => void input.typeText('e'))
    expect(frame(t)).toEqual(before)

    await press(t, input => void input.typeText('zzzz'))
    expect(t.captureCharFrame()).toContain('No matching commands')
    expect(frame(t)).toEqual(before)
  })

  test('the file picker holds its frame while filtering', async () => {
    const t = await launch(fixture(PROJECT), {}, { width: 100, height: 30 })
    await press(t, input => input.pressKey('o', { ctrl: true }))

    const before = frame(t)
    expect(before.top).toBeGreaterThanOrEqual(0)
    expect(before.bottom).toBeGreaterThan(before.top)

    await press(t, input => void input.typeText('alpha'))
    expect(frame(t)).toEqual(before)

    await press(t, input => void input.typeText('zz'))
    expect(t.captureCharFrame()).toContain('No matches')
    expect(frame(t)).toEqual(before)
  })
})
