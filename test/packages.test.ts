import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nfpmConfig, packageFileName } from '../scripts/packages'

describe('packageFileName', () => {
  test('deb keeps underscores and Debian arch names', () => {
    expect(packageFileName('deb', 'linux-x64', '1.16.0')).toBe('druk_1.16.0_amd64.deb')
    expect(packageFileName('deb', 'linux-arm64', '1.16.0')).toBe('druk_1.16.0_arm64.deb')
  })

  test('rpm follows name-version-release.arch, its own shape', () => {
    expect(packageFileName('rpm', 'linux-x64', '1.16.0')).toBe('druk-1.16.0-1.x86_64.rpm')
    expect(packageFileName('rpm', 'linux-arm64', '1.16.0')).toBe('druk-1.16.0-1.aarch64.rpm')
  })
})

describe('nfpmConfig', () => {
  test('carries the version as package.json spells it, no tag v', () => {
    expect(nfpmConfig('linux-x64', '1.16.0')).toContain('version: 1.16.0')
    expect(nfpmConfig('linux-x64', '1.16.0')).not.toContain('version: v')
  })

  test('maps the target to Go arch names for nfpm to translate', () => {
    expect(nfpmConfig('linux-x64', '1.0.0')).toContain('arch: amd64')
    expect(nfpmConfig('linux-arm64', '1.0.0')).toContain('arch: arm64')
  })

  test('installs the binary executable to /usr/bin with the three doc files', () => {
    const config = nfpmConfig('linux-x64', '1.0.0')
    expect(config).toContain('src: ./dist/linux-x64/druk')
    expect(config).toContain('dst: /usr/bin/druk')
    expect(config).toContain('mode: 0755')
    expect(config).toContain('dst: /usr/share/doc/druk/LICENSE')
    expect(config).toContain('dst: /usr/share/doc/druk/THIRD_PARTY_NOTICES.md')
    expect(config).toContain('dst: /usr/share/doc/druk/PDFIUM_LICENSE')
  })
})

test('a missing binary is named before nfpm is ever needed', () => {
  const empty = mkdtempSync(join(tmpdir(), 'druk-dist-'))
  const proc = Bun.spawnSync(['bun', 'scripts/packages.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DRUK_DIST: empty },
  })
  expect(proc.exitCode).toBe(1)
  expect(new TextDecoder().decode(proc.stderr)).toContain(`${empty}/linux-x64/druk`)
})
