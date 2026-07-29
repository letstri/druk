import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCommands, flattenCommands } from '../src/app/commands'
import type { CommandActions } from '../src/app/commands'
import { readFile } from '../src/core/fs'
import { searchProject, searchText } from '../src/core/search'
import { isNewer } from '../src/core/update'
import { THEMES } from '../src/themes'

describe('search', () => {
  const text = 'const alpha = 1\nlet beta = 2\n// alpha again\n'

  test('finds every occurrence with line and column', () => {
    expect(searchText(text, 'alpha', 'a.ts').map(m => [m.line, m.col])).toEqual([
      [0, 6],
      [2, 3],
    ])
  })

  test('is case-insensitive', () => {
    expect(searchText(text, 'ALPHA', 'a.ts')).toHaveLength(2)
  })

  test('walks subdirectories but skips node_modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'druk-'))
    mkdirSync(join(dir, 'sub'))
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'a.ts'), 'alpha\n')
    writeFileSync(join(dir, 'sub/b.ts'), 'alpha\n')
    writeFileSync(join(dir, 'node_modules/c.ts'), 'alpha\n')

    const hits = searchProject(dir, 'alpha').map(m => m.path.replace(`${dir}/`, ''))
    expect(hits).toEqual(['a.ts', 'sub/b.ts'])
  })
})

describe('files', () => {
  test('refuses binary content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'druk-'))
    writeFileSync(join(dir, 'bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(() => readFile(join(dir, 'bin'))).toThrow('binary file')
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
      vimEnabled: false,
      vscodeKeys: false,
      activeTheme: 'dark',
      tabSize: 2,
      trimOnSave: false,
      autoSaveOnBlur: false,
    })
    const leaves = flattenCommands(tree)

    expect(leaves.length).toBeGreaterThan(10)
    for (const { command } of leaves) expect(typeof command.run).toBe('function')

    const ids = leaves.map(l => l.command.id)
    expect(new Set(ids).size).toBe(ids.length)

    // Running every leaf must not throw and must reach an action.
    for (const { command } of leaves) command.run?.()
    expect(ran.length).toBe(leaves.length)
  })

  // Missing/extra ui keys are a tsc error, so only the values are worth asserting.
  test('every theme tints the current line instead of filling it', () => {
    const channels = (hex: string) =>
      [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16))

    for (const [id, theme] of Object.entries(THEMES)) {
      const [bg, line] = [channels(theme.ui.bg), channels(theme.ui.currentLine)]
      const delta = Math.max(...bg.map((v, i) => Math.abs(v - line[i]!)))
      // Visible as a band, never a block that competes with the code on it.
      expect(`${id}:${delta > 0 && delta <= 20}`).toBe(`${id}:true`)
    }
  })
})
