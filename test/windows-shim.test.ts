import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeWindowsBareShim } from '../bin/windows-shim.mjs'

async function shims() {
  const prefix = await mkdtemp(join(tmpdir(), 'druk-windows-shim-'))
  for (const name of ['druk', 'druk.cmd', 'druk.ps1']) {
    writeFileSync(join(prefix, name), name)
  }
  return prefix
}

// The suite runs from a package script, so npm_config_* is already set.
function withNpmEnv(env: Record<string, string | undefined>, run: () => void) {
  const keys = [
    'npm_config_global',
    'npm_config_location',
    'npm_config_global_prefix',
    'npm_config_prefix',
  ]
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) {
      Reflect.deleteProperty(process.env, key)
    }
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
    run()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('Windows npm shim cleanup', () => {
  test('removes only the extensionless global shim on Windows', async () => {
    const prefix = await shims()
    try {
      removeWindowsBareShim({ global: 'true', platform: 'win32', prefix })
      expect(existsSync(join(prefix, 'druk'))).toBe(false)
      expect(existsSync(join(prefix, 'druk.cmd'))).toBe(true)
      expect(existsSync(join(prefix, 'druk.ps1'))).toBe(true)
    } finally {
      await rm(prefix, { force: true, recursive: true })
    }
  })

  test('leaves shims alone outside a Windows global install', async () => {
    const prefixes = await Promise.all([shims(), shims(), shims()])
    try {
      removeWindowsBareShim({
        global: 'true',
        platform: 'linux',
        prefix: prefixes[0],
      })
      removeWindowsBareShim({
        global: 'false',
        platform: 'win32',
        prefix: prefixes[1],
      })
      withNpmEnv({}, () =>
        removeWindowsBareShim({ platform: 'win32', prefix: prefixes[2] })
      )
      expect(prefixes.every((prefix) => existsSync(join(prefix, 'druk')))).toBe(
        true
      )
    } finally {
      await Promise.all(
        prefixes.map((prefix) => rm(prefix, { force: true, recursive: true }))
      )
    }
  })

  test('takes the prefix npm exports unconditionally', async () => {
    const [exported, overridden] = await Promise.all([shims(), shims()])
    try {
      withNpmEnv(
        { npm_config_global: 'true', npm_config_global_prefix: exported },
        () => removeWindowsBareShim({ platform: 'win32' })
      )
      expect(existsSync(join(exported, 'druk'))).toBe(false)

      withNpmEnv(
        { npm_config_global: 'true', npm_config_prefix: overridden },
        () => removeWindowsBareShim({ platform: 'win32' })
      )
      expect(existsSync(join(overridden, 'druk'))).toBe(false)
    } finally {
      await Promise.all(
        [exported, overridden].map((prefix) =>
          rm(prefix, { force: true, recursive: true })
        )
      )
    }
  })

  test('a global install spelled as a location is still global', async () => {
    const prefix = await shims()
    try {
      withNpmEnv(
        { npm_config_global_prefix: prefix, npm_config_location: 'global' },
        () => removeWindowsBareShim({ platform: 'win32' })
      )
      expect(existsSync(join(prefix, 'druk'))).toBe(false)
    } finally {
      await rm(prefix, { force: true, recursive: true })
    }
  })

  test('does not fail when npm created no bare shim', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'druk-windows-shim-'))
    try {
      mkdirSync(join(prefix, 'node_modules'))
      expect(() =>
        removeWindowsBareShim({ global: 'true', platform: 'win32', prefix })
      ).not.toThrow()
    } finally {
      await rm(prefix, { force: true, recursive: true })
    }
  })
})
