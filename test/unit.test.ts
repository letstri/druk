import { describe, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCommands } from '../src/app/commands'
import type { CommandActions } from '../src/app/commands'
import { readFile, watchPath, watchTree, writeAtomic } from '../src/core/fs'
import type { Changed } from '../src/core/fs'
import { searchProject, searchText } from '../src/core/search'
import { isNewer } from '../src/core/update'
import { THEMES } from '../src/themes'
import { flattenCommands } from '../src/ui/CommandPalette'
import { tempDir } from './temp'
import { waitFor } from './wait'

describe('search', () => {
  const text = 'const alpha = 1\nlet beta = 2\n// alpha again\n'

  test('finds every occurrence with line and column', () => {
    expect(
      searchText(text, 'alpha', 'a.ts').map((m) => [m.line, m.col])
    ).toEqual([
      [0, 6],
      [2, 3],
    ])
  })

  test('is case-insensitive', () => {
    expect(searchText(text, 'ALPHA', 'a.ts')).toHaveLength(2)
  })

  test('walks subdirectories but skips node_modules', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'sub'))
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'a.ts'), 'alpha\n')
    writeFileSync(join(dir, 'sub/b.ts'), 'alpha\n')
    writeFileSync(join(dir, 'node_modules/c.ts'), 'alpha\n')

    const hits = searchProject(dir, 'alpha').map((m) =>
      m.path.replace(`${dir}/`, '')
    )
    expect(hits).toEqual(['a.ts', 'sub/b.ts'])
  })
})

describe('files', () => {
  test('refuses binary content', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(() => readFile(join(dir, 'bin'))).toThrow('binary file')
  })

  test('an install is reported as a dependency change, and a source edit is not', async () => {
    const dir = tempDir('druk-deps-')
    const seen: Changed[] = []
    const stop = watchTree(dir, (changed) => seen.push(changed))
    try {
      const settled = (want: Changed) =>
        waitFor(() => {
          const last = seen.at(-1)
          return (
            last?.tree === want.tree &&
            last.deps === want.deps &&
            last.git === want.git
          )
        })

      writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
      expect(await settled({ deps: false, git: false, tree: true })).toBe(true)

      mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true })
      writeFileSync(
        join(dir, 'node_modules', 'left-pad', 'index.js'),
        'module.exports = 1\n'
      )
      expect(await settled({ deps: true, git: false, tree: true })).toBe(true)
    } finally {
      stop()
    }
  })

  test('a watcher error is not thrown at the process', () => {
    const dir = tempDir('druk-watch-')
    const watcher = watchPath(dir, { recursive: true }, () => {})
    try {
      expect(() =>
        watcher?.emit(
          'error',
          new Error('ENOSPC: no space left on device, watch')
        )
      ).not.toThrow()
    } finally {
      watcher?.close()
    }
  })
})

describe('updates', () => {
  test('compares versions numerically', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0', '0.3.0')).toBe(false)
  })

  test('a release is newer than its own prereleases', () => {
    expect(isNewer('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
  })

  test('garbage from the registry is not an update', () => {
    expect(isNewer('not-a-version', '0.2.0')).toBe(false)
  })
})

describe('registries', () => {
  test('every command leaf is runnable, unique, and reachable', () => {
    const ran: string[] = []
    const actions = new Proxy({} as CommandActions, {
      get: (_t, name: string) => () => ran.push(name),
    })
    const tree = buildCommands(actions, {
      activeIconTheme: 'none',
      activeTheme: 'dark',
    })
    const leaves = flattenCommands(tree)

    expect(leaves.length).toBeGreaterThan(10)
    for (const { command } of leaves) {
      expect(typeof command.run).toBe('function')
    }

    const ids = leaves.map((l) => l.command.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const { command } of leaves) {
      command.run?.()
    }
    expect(ran.length).toBe(leaves.length)
  })

  test('every theme leaf can be previewed and put back', () => {
    const ran: string[] = []
    const actions = new Proxy({} as CommandActions, {
      get: (_t, name: string) => (arg?: unknown) =>
        ran.push(`${name}:${arg ?? ''}`),
    })
    const themes = buildCommands(actions, {
      activeIconTheme: 'none',
      activeTheme: 'dark',
    }).find((c) => c.id === 'themes')
    const leaves = themes?.children ?? []

    expect(leaves.length).toBe(Object.keys(THEMES).length)
    for (const leaf of leaves) {
      expect(typeof leaf.preview).toBe('function')
      expect(typeof leaf.restore).toBe('function')
    }

    leaves.find((c) => c.id === 'themes.light')?.preview?.()
    leaves.find((c) => c.id === 'themes.light')?.restore?.()
    expect(ran).toEqual(['previewTheme:light', 'restoreTheme:'])
  })

  test('every theme tints the current line instead of filling it', () => {
    const channels = (hex: string) =>
      [0, 2, 4].map((i) =>
        Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16)
      )

    for (const [id, theme] of Object.entries(THEMES)) {
      const [bg, line] = [channels(theme.ui.bg), channels(theme.ui.currentLine)]
      const delta = Math.max(...bg.map((v, i) => Math.abs(v - line[i]!)))
      expect(`${id}:${delta > 0 && delta <= 20}`).toBe(`${id}:true`)
    }
  })
})

test('an atomic write leaves no partial file and no temp behind', () => {
  const dir = tempDir('druk-atomic-')
  const file = join(dir, 'nested', 'config.json')

  writeAtomic(file, '{"a":1}')
  writeAtomic(file, '{"a":2}')

  expect(readFile(file)).toBe('{"a":2}')
  expect(readdirSync(join(dir, 'nested'))).toEqual(['config.json'])
})
