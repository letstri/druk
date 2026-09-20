import { afterAll, describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { readdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'

const silent = createServer(() => {})
const stalled = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  res.write('partial')
})
const missing = createServer((_req, res) => {
  res.writeHead(404)
  res.end()
})
const requested: string[] = []
const recording = createServer((req, res) => {
  requested.push(req.url ?? '')
  res.writeHead(404)
  res.end()
})
let flaky = 0
const failing = createServer((_req, res) => {
  flaky += 1
  res.writeHead(504)
  res.end()
})
const servers = [silent, stalled, missing, recording, failing]
for (const server of servers) server.listen(0, '127.0.0.1')
await Promise.all(servers.map(server => once(server, 'listening')))

function port(server: Server) {
  const address = server.address()
  if (address && typeof address === 'object') return address.port
  throw new Error('server is not listening on a TCP port')
}

function closeServer(server: Server) {
  server.closeAllConnections()
  // Bun's http close reports ERR_SERVER_NOT_RUNNING after a clean listen/close pair (1.3.14).
  return new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error)
      else resolve()
    })
  })
}

afterAll(async () => {
  await Promise.all(servers.map(server => closeServer(server)))
})

// binary.mjs bakes DRUK_DOWNLOAD_BASE in at evaluation: each base needs a cache-busted import.
async function binaryAgainst(server: Server) {
  process.env.DRUK_DOWNLOAD_BASE = `http://127.0.0.1:${port(server)}`
  return import(`../bin/binary.mjs?base=${port(server)}`)
}

describe('fetchBinary timeout', () => {
  test('the machine running the suite has a binary to fetch', async () => {
    const { supported } = await binaryAgainst(missing)
    expect(supported).toBe(true)
  })

  test('gives up when the server never answers', async () => {
    const { fetchBinary } = await binaryAgainst(silent)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 250 })).toBeNull()
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(200)
    expect(elapsed).toBeLessThan(5_000)
  })

  test('gives up when the body stalls after headers', async () => {
    const { fetchBinary } = await binaryAgainst(stalled)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 250 })).toBeNull()
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(200)
    expect(elapsed).toBeLessThan(5_000)
  })

  test('a transient 5xx is retried, a 404 is not', async () => {
    const { fetchBinary } = await binaryAgainst(failing)
    flaky = 0
    expect(await fetchBinary({ timeout: 30_000 })).toBeNull()
    expect(flaky).toBe(3)

    const { fetchBinary: probe } = await binaryAgainst(recording)
    requested.length = 0
    expect(await probe({ timeout: 30_000 })).toBeNull()
    expect(requested.length).toBe(1)
    requested.length = 0
  }, 30_000)

  test('a server that answers is not held to the bound', async () => {
    const { fetchBinary } = await binaryAgainst(missing)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 60_000 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('the baseline variant', () => {
  test('a cpuinfo without avx2 wants the baseline build', async () => {
    const { wantsBaseline } = await binaryAgainst(missing)
    expect(wantsBaseline('flags\t\t: fpu vme sse sse2 avx aes lahf_lm')).toBe(true)
    expect(wantsBaseline('flags\t\t: fpu sse sse2 avx avx2 bmi1 bmi2')).toBe(false)
  })

  test('recognises the illegal-instruction crash on both platforms', async () => {
    const { illegalInstruction } = await binaryAgainst(missing)
    expect(illegalInstruction({ signal: 'SIGILL', status: null })).toBe(true)
    expect(illegalInstruction({ signal: null, status: 3221225501 })).toBe(true)
    expect(illegalInstruction({ signal: null, status: -1073741795 })).toBe(true)
    expect(illegalInstruction({ signal: null, status: 0 })).toBe(false)
    expect(illegalInstruction({ signal: 'SIGTERM', status: null })).toBe(false)
    expect(illegalInstruction({ signal: null, status: 1 })).toBe(false)
  })

  test('DRUK_CPU_BASELINE=1 fetches the baseline asset', async () => {
    const { fetchBinary } = await binaryAgainst(recording)
    process.env.DRUK_CPU_BASELINE = '1'
    try {
      expect(await fetchBinary({ timeout: 5_000 })).toBeNull()
    } finally {
      delete process.env.DRUK_CPU_BASELINE
    }
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.every(url => url.includes('-baseline.'))).toBe(true)
  })
})

describe('the published package', () => {
  test('stages every module bin/ holds', async () => {
    const release = await Bun.file(new URL('../scripts/release.ts', import.meta.url)).text()
    const staged = [...release.matchAll(/cp\('\.\/bin\/([\w.-]+)'/g)].map(match => match[1])
    const modules = readdirSync(new URL('../bin/', import.meta.url))
    expect(staged.toSorted()).toEqual(modules.toSorted())
  })
})
