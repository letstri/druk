import { afterEach, describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'

const realFetch = globalThis.fetch

function mockRegistry(version: string) {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json({ version }))) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('update banner', () => {
  test('a newer published version shows the banner', async () => {
    mockRegistry('99.0.0')
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      {},
      { checkUpdates: true }
    )
    await settle(t, 20)
    const frame = t.captureCharFrame()
    expect(frame).toContain('Update available')
    expect(frame).toContain('99.0.0')
    expect(frame).toContain('druk update')
  })

  test('Enter dismisses the banner', async () => {
    mockRegistry('99.0.0')
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      {},
      { checkUpdates: true }
    )
    await settle(t, 20)
    expect(t.captureCharFrame()).toContain('Update available')
    await press(t, (i) => i.pressEnter())
    expect(t.captureCharFrame()).not.toContain('Update available')
  })

  test('a skipped version stays silent', async () => {
    mockRegistry('99.0.0')
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      { skipUpdate: '99.0.0' },
      {},
      { checkUpdates: true }
    )
    await settle(t, 20)
    expect(t.captureCharFrame()).not.toContain('Update available')
  })

  test('the harness default never fetches', async () => {
    let called = false
    globalThis.fetch = (() => {
      called = true
      return Promise.resolve(Response.json({ version: '99.0.0' }))
    }) as unknown as typeof fetch
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await settle(t, 20)
    expect(called).toBe(false)
    expect(t.captureCharFrame()).not.toContain('Update available')
  })
})
