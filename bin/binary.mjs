import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// import.meta.dirname wants node 20.11; the published package promises >=18.
// oxlint-disable-next-line unicorn/prefer-import-meta-properties
const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'))

const platform = process.platform === 'win32' ? 'windows' : process.platform
export const target = `${platform}-${process.arch}`
export const exe = platform === 'windows' ? 'druk.exe' : 'druk'
export const { version } = pkg

const SUPPORTED = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'windows-x64',
])
export const supported = SUPPORTED.has(target)

// Bun's default x64 builds need AVX2 and die on a pre-2013 CPU (#99). No darwin: every Mac has it.
const BASELINE_TARGETS = new Set(['linux-x64', 'windows-x64'])

export function wantsBaseline(cpuinfo) {
  return !/\bavx2\b/u.test(cpuinfo)
}

// Only Linux exposes CPU flags; elsewhere the probe in fetchBinary catches an old CPU instead.
function detectBaseline() {
  const forced = process.env.DRUK_CPU_BASELINE
  if (forced === '1') {
    return true
  }
  if (forced === '0' || !BASELINE_TARGETS.has(target)) {
    return false
  }
  if (platform !== 'linux') {
    return false
  }
  try {
    return wantsBaseline(readFileSync('/proc/cpuinfo', 'utf-8'))
  } catch {
    return false
  }
}

// Windows has no signals: 0xC000001D arrives as the exit code, unsigned or sign-extended.
export function illegalInstruction({ signal, status }) {
  return (
    signal === 'SIGILL' || status === 3_221_225_501 || status === -1_073_741_795
  )
}

const assetFor = (baseline) =>
  `druk-${target}${baseline ? '-baseline' : ''}.${platform === 'linux' ? 'tar.gz' : 'zip'}`
const repo =
  pkg.repository?.url?.replace(/^git\+/u, '').replace(/\.git$/u, '') ??
  'https://github.com/letstri/druk'
const base =
  process.env.DRUK_DOWNLOAD_BASE ?? `${repo}/releases/download/v${version}`

const inPackage = join(here, exe)
const inCache = join(homedir(), '.cache', 'druk', version, exe)

export function findBinary() {
  if (existsSync(inPackage)) {
    return inPackage
  }
  if (existsSync(inCache)) {
    return inCache
  }
  const local = join(dirname(here), 'dist', target, exe)
  return existsSync(local) ? local : null
}

// A 404 is the missing-asset answer the baseline fallback reads, so only 5xx and throws retry.
async function get(url, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal })
      if (response.status < 500 || attempt === 2) {
        return response
      }
    } catch (error) {
      if (attempt === 2 || signal?.aborted) {
        throw error
      }
    }
    await delay(500 * (attempt + 1))
  }
}

async function download(asset, signal) {
  const temp = join(tmpdir(), `druk-${version}-${asset}-${process.pid}`)
  try {
    const response = await get(`${base}/${asset}`, signal)
    if (!response.ok) {
      return null
    }
    mkdirSync(temp, { recursive: true })
    const archive = join(temp, asset)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    if (!unpack(archive, temp)) {
      return null
    }
    const unpacked = join(temp, exe)
    if (!existsSync(unpacked)) {
      return null
    }
    if (platform !== 'windows') {
      chmodSync(unpacked, 0o755)
    }
    return { temp, unpacked }
  } catch {
    return null
  }
}

// `timeout` (ms) bounds headers *and* body: a stalled body hangs an install forever.
export async function fetchBinary({ timeout } = {}) {
  if (!supported) {
    return null
  }
  const temps = []
  try {
    const signal = timeout ? AbortSignal.timeout(timeout) : undefined
    const baseline = detectBaseline()
    let got = await download(assetFor(baseline), signal)
    if (!got) {
      return null
    }
    temps.push(got.temp)

    // Run what arrived; any other probe failure installs anyway rather than failing a sandbox.
    if (!baseline && BASELINE_TARGETS.has(target)) {
      const probe = spawnSync(got.unpacked, ['--version'], {
        stdio: 'pipe',
        windowsHide: true,
      })
      if (illegalInstruction(probe)) {
        const fallback = await download(assetFor(true), signal)
        if (fallback) {
          temps.push(fallback.temp)
          got = fallback
        }
      }
    }

    for (const destination of [inPackage, inCache]) {
      // Copy beside the destination, then rename: out of tmpdir, rename fails EXDEV.
      const partial = `${destination}.partial`
      try {
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(got.unpacked, partial)
        if (platform !== 'windows') {
          chmodSync(partial, 0o755)
        }
        renameSync(partial, destination)
        return destination
      } catch {
        rmSync(partial, { force: true })
      }
    }
    return null
  } catch {
    return null
  } finally {
    for (const temp of temps) {
      rmSync(temp, { force: true, recursive: true })
    }
  }
}

// `tar` is bsdtar on macOS and Windows 10+, which reads zip; PowerShell is the fallback.
function unpack(archive, into) {
  const tar = spawnSync('tar', ['-xf', archive, '-C', into], {
    stdio: 'pipe',
    windowsHide: true,
  })
  if (tar.status === 0) {
    return true
  }
  if (platform !== 'windows') {
    return false
  }
  const expand = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${into}' -Force`,
    ],
    { stdio: 'pipe', windowsHide: true }
  )
  return expand.status === 0
}
