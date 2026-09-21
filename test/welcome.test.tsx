import { describe, expect, test } from 'bun:test'

import { welcomeKeys } from '../src/ui/keys'
import { fixture, launch, press } from './helpers'

describe('welcome screen', () => {
  test('names the project and advertises the keys from the table', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir)
    const frame = t.captureCharFrame()

    expect(frame).toContain('druk')
    expect(frame).toContain(dir.split('/').at(-1)!)
    for (const [key, label] of welcomeKeys().slice(0, 3)) {
      expect(frame).toContain(key)
      expect(frame).toContain(label)
    }
  })

  test('trims the key list instead of overflowing a short terminal', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      { height: 10 }
    )
    const frame = t.captureCharFrame()

    expect(frame).toContain('druk')
    expect(frame).not.toContain(welcomeKeys().at(-1)![1])
  })

  test('goes away once a file is open', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await press(t, (i) => i.pressArrow('down'))
    await press(t, (i) => i.pressEnter())

    const frame = t.captureCharFrame()
    expect(frame).toContain('const a = 1')
    expect(frame).not.toContain(welcomeKeys()[0]![1])
  })
})
