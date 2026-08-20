import { afterAll, describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { readdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'

// Accepts the request and never responds: headers never arrive.
const silent = createServer(() => {})
// Headers arrive, the body never finishes — the shape of a stalled mirror.
const stalled = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  res.write('partial')
})
// Answers at once, with nothing to download.
const missing = createServer((_req, res) => {
  res.writeHead(404)
  res.end()
})
// A 404 that remembers what was asked for, so a test can see which asset was picked.
const requested: string[] = []
const recording = createServer((req, res) => {
  requested.push(req.url ?? '')
  res.writeHead(404)
  res.end()
})
const servers = [silent, stalled, missing, recording]
for (const server of servers) server.listen(0, '127.0.0.1')
await Promise.all(servers.map(server => once(server, 'listening')))

function port(server: Server) {
  const address = server.address()
  if (address && typeof address === 'object') return address.port
  throw new Error('server is not listening on a TCP port')
}

function closeServer(server: Server) {
  server.closeAllConnections()
  // Bun's http close reports ERR_SERVER_NOT_RUNNING even after a clean
  // listen/close pair (verified on 1.3.14); anything else is a real failure.
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

// binary.mjs bakes DRUK_DOWNLOAD_BASE into its URL at module evaluation, so each
// base needs its own import: env first, then a cache-busted dynamic import.
async function binaryAgainst(server: Server) {
  process.env.DRUK_DOWNLOAD_BASE = `http://127.0.0.1:${port(server)}`
  return import(`../bin/binary.mjs?base=${port(server)}`)
}

describe('fetchBinary timeout', () => {
  test('the machine running the suite has a binary to fetch', async () => {
    // On a target with no release asset fetchBinary returns before it reaches the
    // network, and every test below would pass without exercising a timeout at all.
    const { supported } = await binaryAgainst(missing)
    expect(supported).toBe(true)
  })

  test('gives up when the server never answers', async () => {
    const { fetchBinary } = await binaryAgainst(silent)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 250 })).toBeNull()
    const elapsed = Date.now() - started
    // Waiting out the bound is the point: returning early would mean the connection
    // was refused and the null proved nothing.
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

  test('a server that answers is not held to the bound', async () => {
    // The 60s an install may spend waiting must not also be 60s of not installing.
    const { fetchBinary } = await binaryAgainst(missing)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 60_000 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('the baseline variant', () => {
  test('a cpuinfo without avx2 wants the baseline build', async () => {
    const { wantsBaseline } = await binaryAgainst(missing)
    // The flags line of an i5-2500 (issue #99): AVX but no AVX2.
    expect(wantsBaseline('flags\t\t: fpu vme sse sse2 avx aes lahf_lm')).toBe(true)
    expect(wantsBaseline('flags\t\t: fpu sse sse2 avx avx2 bmi1 bmi2')).toBe(false)
  })

  test('recognises the illegal-instruction crash on both platforms', async () => {
    const { illegalInstruction } = await binaryAgainst(missing)
    expect(illegalInstruction({ signal: 'SIGILL', status: null })).toBe(true)
    // STATUS_ILLEGAL_INSTRUCTION as Windows reports it, unsigned and sign-extended.
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
  // release.ts stages bin/ file by file, and `files: ['bin']` publishes whatever it
  // staged: a module added here but not there leaves the shim importing nothing.
  test('stages every module bin/ holds', async () => {
    const release = await Bun.file(new URL('../scripts/release.ts', import.meta.url)).text()
    const staged = [...release.matchAll(/cp\('\.\/bin\/([\w.-]+)'/g)].map(match => match[1])
    const modules = readdirSync(new URL('../bin/', import.meta.url))
    expect(staged.toSorted()).toEqual(modules.toSorted())
  })
})
