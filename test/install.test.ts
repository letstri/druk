import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

const script = new URL('../install', import.meta.url).pathname

const scratches: string[] = []
function scratch() {
  const dir = tempDir('druk-install-')
  scratches.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratches.splice(0)) {
    chmodSync(join(dir, 'bin'), 0o755)
    rmSync(dir, { force: true, recursive: true })
  }
})

function setup() {
  const dir = scratch()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const next = join(dir, 'next-binary')
  writeFileSync(next, '#!/bin/sh\necho v2\n', { mode: 0o755 })
  return { bin, dir, next }
}

async function runInstall(installDir: string, binary: string) {
  const proc = Bun.spawn(
    ['bash', script, '--binary', binary, '--no-modify-path'],
    {
      env: { ...process.env, DRUK_INSTALL_DIR: installDir },
      stderr: 'pipe',
      stdout: 'pipe',
    }
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stderr, stdout }
}

// Root ignores file permissions, so the failure tests would install fine.
const asRoot = process.getuid?.() === 0

describe('install --binary', () => {
  // Linux refuses a write to a running binary (ETXTBSY); macOS does not, so
  // only CI can fail this one.
  test('replaces the executable while it is the running process', async () => {
    const { bin, dir, next } = setup()
    // The runtime itself, copied: macOS SIGKILLs a copied system binary (bash,
    // sleep) just after spawn, and ubuntu-latest's sleep is a rust-coreutils
    // applet that refuses to run as `druk`. realpath, since cpSync copies a
    // symlink as one and the installer rightly refuses to replace it; cwd off
    // the repo, whose bunfig preload costs every start ~200ms.
    cpSync(realpathSync(process.execPath), join(bin, 'druk'))
    const running = Bun.spawn(
      [join(bin, 'druk'), '-e', 'setTimeout(() => {}, 30_000)'],
      { cwd: dir }
    )
    try {
      const result = await runInstall(bin, next)
      expect(result.exitCode).toBe(0)
      // Alive, not just unexited: a signal death leaves exitCode null too.
      expect(running.exitCode).toBeNull()
      expect(running.signalCode).toBeNull()
      expect(readFileSync(join(bin, 'druk'), 'utf-8')).toContain('v2')
      expect(readdirSync(bin)).toEqual(['druk'])
    } finally {
      running.kill()
      await running.exited
    }
  })

  test('refuses a symlinked destination and leaves it untouched', async () => {
    const { dir, bin, next } = setup()
    const referent = join(dir, 'real-druk')
    writeFileSync(referent, 'someone else set this up', { mode: 0o755 })
    symlinkSync(referent, join(bin, 'druk'))
    const result = await runInstall(bin, next)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('symlink')
    expect(readlinkSync(join(bin, 'druk'))).toBe(referent)
    expect(readFileSync(referent, 'utf-8')).toBe('someone else set this up')
    expect(readdirSync(bin)).toEqual(['druk'])
  })

  test.skipIf(asRoot)(
    'a copy that fails leaves the old binary and no staging file',
    async () => {
      const { bin, next } = setup()
      writeFileSync(join(bin, 'druk'), 'the version that works', {
        mode: 0o755,
      })
      chmodSync(next, 0o000)
      const result = await runInstall(bin, next)
      expect(result.exitCode).not.toBe(0)
      expect(readFileSync(join(bin, 'druk'), 'utf-8')).toBe(
        'the version that works'
      )
      expect(readdirSync(bin)).toEqual(['druk'])
    }
  )

  test.skipIf(asRoot)(
    'a non-writable install dir fails with a clear error',
    async () => {
      const { bin, next } = setup()
      writeFileSync(join(bin, 'druk'), 'the version that works', {
        mode: 0o755,
      })
      chmodSync(bin, 0o555)
      const result = await runInstall(bin, next)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`cannot write to ${bin}`)
      expect(readFileSync(join(bin, 'druk'), 'utf-8')).toBe(
        'the version that works'
      )
    }
  )
})
