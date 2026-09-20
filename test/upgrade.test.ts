import { describe, expect, test } from 'bun:test'

import { HELP } from '../src/core/cli'
import {
  changedNothing,
  detectInstall,
  runUpgrade,
  upgradeCommand,
  withSpinner,
} from '../src/core/upgrade'

const HOME = '/Users/dev'
const detect = (execPath: string, scriptPath = '') => detectInstall(execPath, scriptPath, HOME)

describe('working out how druk was installed', () => {
  test('Homebrew, from either prefix', () => {
    expect(detect('/opt/homebrew/bin/druk')).toEqual({ kind: 'brew' })
    expect(detect('/usr/local/Cellar/druk/1.2.0/bin/druk')).toEqual({ kind: 'brew' })
    expect(detect('/home/linuxbrew/.linuxbrew/bin/druk')).toEqual({ kind: 'brew' })
  })

  test('the curl installer, which owns ~/.druk', () => {
    expect(detect(`${HOME}/.druk/bin/druk`)).toEqual({ kind: 'script' })
  })

  test('each package manager, from the path it installs into', () => {
    expect(detect(`${HOME}/Library/pnpm/druk`)).toMatchObject({ manager: 'pnpm' })
    expect(detect(`${HOME}/.bun/bin/druk`)).toMatchObject({ manager: 'bun' })
    expect(detect(`${HOME}/.yarn/bin/druk`)).toMatchObject({ manager: 'yarn' })
    expect(detect('/usr/local/lib/node_modules/druk/bin/druk.js')).toMatchObject({
      manager: 'npm',
    })
  })

  test('the shim is what names the manager, not the runtime that runs it', () => {
    const install = detect('/usr/local/bin/node', `${HOME}/Library/pnpm/global/druk/bin/druk.mjs`)
    expect(install).toEqual({ kind: 'package', manager: 'pnpm' })
  })

  test('an unrecognised path assumes npm rather than refusing to help', () => {
    expect(detect('/somewhere/odd/druk')).toEqual({ kind: 'package', manager: 'npm' })
  })
})

describe('the command each install is upgraded with', () => {
  test('brew upgrades the tap formula', () => {
    expect(upgradeCommand({ kind: 'brew' })).toBe('brew upgrade letstri/tap/druk')
  })

  test('the script install re-runs the installer', () => {
    expect(upgradeCommand({ kind: 'script' })).toContain('curl -fsSL')
  })

  test('a package install asks nypm, so each manager gets its own syntax', () => {
    expect(upgradeCommand({ kind: 'package', manager: 'npm' })).toBe('npm install -g druk@latest')
    expect(upgradeCommand({ kind: 'package', manager: 'pnpm' })).toBe('pnpm add -g druk@latest')
    expect(upgradeCommand({ kind: 'package', manager: 'yarn' })).toBe('yarn global add druk@latest')
    expect(upgradeCommand({ kind: 'package', manager: 'bun' })).toBe('bun add -g druk@latest')
  })

  test('every command names druk@latest, never a bare install', () => {
    for (const install of [
      { kind: 'package', manager: 'npm' },
      { kind: 'package', manager: 'pnpm' },
      { kind: 'package', manager: 'bun' },
    ] as const) {
      expect(upgradeCommand(install)).toContain('druk@latest')
    }
  })
})

describe('running it', () => {
  test('says what it detected and shows the command before running it', async () => {
    const written: string[] = []
    await runUpgrade(text => written.push(text), { execPath: '/usr/bin/druk' })
    const output = written.join('')

    expect(output).toMatch(/Updating|Re-running|Installed by/)
  })
})

describe('the help', () => {
  test('lists update as a command', () => {
    expect(HELP).toContain('druk update')
    expect(HELP).toContain('upgrade druk itself')
  })
})

describe('a system package install', () => {
  test('the packaged path is its own kind, ahead of the npm fallback', () => {
    expect(detect('/usr/bin/druk')).toEqual({ kind: 'system' })
    expect(detect('/usr/bin/node', '/usr/lib/node_modules/druk/bin/druk.js')).toMatchObject({
      manager: 'npm',
    })
  })

  test('its command is the releases page, since nothing is safe to run', () => {
    expect(upgradeCommand({ kind: 'system' })).toContain('releases/latest')
  })

  test('update points at this architecture and spawns nothing', async () => {
    const written: string[] = []
    const code = await runUpgrade(text => written.push(text), {
      execPath: '/usr/bin/druk',
      arch: 'x64',
    })
    const out = written.join('')
    expect(code).toBe(0)
    expect(out).toContain('system package manager')
    expect(out).toContain('amd64 .deb or x86_64 .rpm')
    expect(out).toContain('releases/latest')
    expect(out).not.toContain('$ ')
  })

  test('arm64 names its own pair', async () => {
    const written: string[] = []
    await runUpgrade(text => written.push(text), { execPath: '/usr/bin/druk', arch: 'arm64' })
    expect(written.join('')).toContain('arm64 .deb or aarch64 .rpm')
  })
})

describe('the loader', () => {
  test('redraws over its own line and leaves the cursor back on', async () => {
    const written: string[] = []
    const result = await withSpinner(
      text => written.push(text),
      'npm install -g druk@latest',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'done'
      },
    )
    const output = written.join('')

    expect(result).toBe('done')
    expect(output).toContain('\x1B[?25l') // cursor hidden while it spins
    expect(written.filter(text => text.startsWith('\r\x1B[2K')).length).toBeGreaterThan(1)
    expect(output).toContain('npm install -g druk@latest')
    expect(output.endsWith('\r\x1B[2K\x1B[?25h')).toBe(true) // and the line is left clean
  })
})

describe('an update that changed nothing', () => {
  test('is read off what the installer and brew say, not an exit code', () => {
    expect(changedNothing('druk 1.30.3 is already installed')).toBe(true)
    expect(
      changedNothing('Warning: letstri/tap/druk 1.30.3 is already installed and up-to-date.'),
    ).toBe(true)
    expect(changedNothing('Installing druk 1.31.0 for darwin-arm64')).toBe(false)
  })
})
