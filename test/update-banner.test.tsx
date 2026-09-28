import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_FILE, loadConfig } from '../src/core/config'
import { fixture, launch, press, settle } from './helpers'

const realFetch = globalThis.fetch

const REGISTRY = 'registry.npmjs.org'

function recordFetches(): string[] {
  const urls: string[] = []
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input))
    return Promise.resolve(Response.json({ version: '99.0.0' }))
  }) as unknown as typeof fetch
  return urls
}

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

  test('checkUpdates off never asks the registry', async () => {
    const urls = recordFetches()
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      { checkUpdates: false },
      {},
      { checkUpdates: true }
    )
    await settle(t, 20)
    expect(urls.some((url) => url.includes(REGISTRY))).toBe(false)
    expect(t.captureCharFrame()).not.toContain('Update available')
  })

  test('a workspace after the first never asks, whatever the setting', async () => {
    const urls = recordFetches()
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      { checkUpdates: true },
      {},
      { checkUpdates: false }
    )
    await settle(t, 20)
    expect(urls.some((url) => url.includes(REGISTRY))).toBe(false)
  })

  test('checkUpdates off leaves the extension market check alone', async () => {
    rmSync(join(process.env.XDG_CACHE_HOME!, 'druk', 'market.json'), {
      force: true,
    })
    const urls = recordFetches()
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      { checkUpdates: false, extensionUpdates: true },
      {},
      { checkUpdates: true }
    )
    await settle(t, 20)
    expect(urls.some((url) => url.endsWith('index.json'))).toBe(true)
    expect(urls.some((url) => url.includes(REGISTRY))).toBe(false)
  })
})

describe('checkUpdates in config.json', () => {
  const write = (raw: unknown) => {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(raw))
  }

  test('false is kept', () => {
    write({ checkUpdates: false })
    expect(loadConfig().checkUpdates).toBe(false)
  })

  test('a value that is not a boolean falls back to checking', () => {
    write({ checkUpdates: 'no' })
    expect(loadConfig().checkUpdates).toBe(true)
  })
})
