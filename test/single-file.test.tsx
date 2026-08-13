import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { resolveTarget } from '../src/core/cli'
import type { Config } from '../src/core/config'
import { loadSession, saveSession } from '../src/core/session'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

const PROJECT = {
  'one.ts': 'const one = 1\n',
  'two.ts': 'const two = 2\n',
  'src/deep.ts': 'const deep = 3\n',
}

/** Render as `druk <file>` does: one file, its folder as the project. */
const openOne = (file: string, config: Partial<Config> = {}) =>
  launch(dirname(file), config, {}, { openFile: file })

const tabBar = (t: Harness) => t.captureCharFrame().split('\n')[0]!

describe('druk <file>', () => {
  test('opens that file with the sidebar out of the way', async () => {
    const dir = fixture(PROJECT)
    const t = await openOne(join(dir, 'two.ts'))

    expect(t.captureCharFrame()).toContain('const two = 2')
    expect(tabBar(t)).toContain('two.ts')
    // No tree: no header, no explorer label, no row for the sibling file.
    expect(t.captureCharFrame()).not.toContain('explorer')
    expect(t.captureCharFrame()).not.toContain('one.ts')
  })

  test('the file is the only tab, whatever the folder had open before', async () => {
    const dir = fixture(PROJECT)
    // A session for this folder with both files open and the sidebar showing.
    saveSession(dir, {
      tabs: [join(dir, 'one.ts'), join(dir, 'two.ts')],
      activePath: join(dir, 'one.ts'),
      expanded: [join(dir, 'src')],
      sidebar: true,
    })

    const t = await openOne(join(dir, 'two.ts'))
    expect(tabBar(t)).toContain('two.ts')
    expect(tabBar(t)).not.toContain('one.ts')
    expect(t.captureCharFrame()).not.toContain('explorer')
  })

  test('and it does not write that layout back over the folder’s own', async () => {
    const dir = fixture(PROJECT)
    const before = {
      tabs: [join(dir, 'one.ts')],
      activePath: join(dir, 'one.ts'),
      expanded: [join(dir, 'src')],
      sidebar: true,
    }
    saveSession(dir, before)

    const t = await openOne(join(dir, 'two.ts'))
    await press(t, input => void input.typeText('X'))
    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)

    expect(loadSession(dir)).toMatchObject({ tabs: before.tabs, sidebar: true })
  })

  test('typing lands in the file, not the tree', async () => {
    const dir = fixture(PROJECT)
    const file = join(dir, 'two.ts')
    const t = await openOne(file)

    await press(t, input => void input.typeText('EDIT'))
    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(readFileSync(file, 'utf8')).toContain('EDIT')
  })

  test('Ctrl+B still brings the tree in when you want it', async () => {
    const dir = fixture(PROJECT)
    const t = await openOne(join(dir, 'two.ts'))
    expect(t.captureCharFrame()).not.toContain('explorer')

    await press(t, input => input.pressKey('b', { ctrl: true }))
    await settle(t)
    const frame = t.captureCharFrame()
    expect(frame).toContain('explorer')
    // The folder holding the file is the project, so its siblings are there.
    expect(frame).toContain('one.ts')
  })

  test('a file druk cannot display says so instead of opening blank', async () => {
    const dir = fixture(PROJECT)
    const blob = join(dir, 'blob.bin')
    writeFileSync(blob, Buffer.from([0, 1, 2, 0]))

    const t = await openOne(blob)
    await settle(t)
    const frame = t.captureCharFrame()
    expect(frame).toContain('blob.bin cannot be shown')
  })

  test('a nested file still gets its own folder as the project', async () => {
    const dir = fixture(PROJECT)
    const t = await openOne(join(dir, 'src/deep.ts'))
    expect(t.captureCharFrame()).toContain('const deep = 3')

    await press(t, input => input.pressKey('b', { ctrl: true }))
    await settle(t)
    // Rooted at src/, so deep.ts is a top-level row and one.ts is out of scope.
    const frame = t.captureCharFrame()
    expect(frame).toContain('deep.ts')
    expect(frame).not.toContain('one.ts')
  })
})

describe('the CLI itself', () => {
  /**
   * Drive the real entry point, with an isolated config home so it cannot touch the
   * developer's own. Run from the repo root: `bunfig.toml` lives there, and without
   * its preload the Solid JSX transform never happens.
   */
  function run(args: string[]) {
    const home = tempDir('druk-home-')
    const proc = Bun.spawnSync(['bun', 'src/index.tsx', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, XDG_CONFIG_HOME: home },
      stdin: 'ignore',
    })
    return { code: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr) }
  }

  test('a missing path is reported, and nothing is created', () => {
    const dir = fixture(PROJECT)
    const missing = join(dir, 'nope.ts')
    const { code, stderr } = run([missing])

    expect(code).toBe(1)
    expect(stderr).toContain(`no such file or directory: ${missing}`)
    expect(existsSync(missing)).toBe(false)
  })
})

describe('resolveTarget', () => {
  test('a directory is the project, with no file to open', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget(dir, '/')).toEqual({ rootDir: dir, openFile: null, line: null, col: null })
  })

  test('a file opens alone, rooted at the folder holding it', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget(join(dir, 'src/deep.ts'), '/')).toEqual({
      rootDir: join(dir, 'src'),
      openFile: join(dir, 'src/deep.ts'),
      line: null,
      col: null,
    })
  })

  test('a relative path resolves against the working directory', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget('two.ts', dir)).toEqual({
      rootDir: dir,
      openFile: join(dir, 'two.ts'),
      line: null,
      col: null,
    })
  })

  test('no argument at all means the working directory', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget(undefined, dir)).toEqual({
      rootDir: dir,
      openFile: null,
      line: null,
      col: null,
    })
  })

  test('a path that is not there is refused rather than guessed at', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget('nope.ts', dir)).toBeNull()
    expect(resolveTarget(join(dir, 'no/such/dir'), '/')).toBeNull()
  })

  test('file.ts:42 opens the file at that line, 0-based', () => {
    const dir = fixture(PROJECT)
    expect(resolveTarget('two.ts:42', dir)).toEqual({
      rootDir: dir,
      openFile: join(dir, 'two.ts'),
      line: 41,
      col: null,
    })
    // Both numbers are 0-based in the result; the CLI form is 1-based.
    expect(resolveTarget('two.ts:42:7', dir)).toMatchObject({ line: 41, col: 6 })
    expect(resolveTarget('two.ts:42:0', dir)?.col).toBe(0)
    // But a missing file is still a missing file.
    expect(resolveTarget('nope.ts:42', dir)).toBeNull()
  })

  test('a real file literally named with a colon wins over the line reading', () => {
    const dir = fixture({ ...PROJECT, 'odd.ts:1': 'colon named\n' })
    expect(resolveTarget('odd.ts:1', dir)).toEqual({
      rootDir: dir,
      openFile: join(dir, 'odd.ts:1'),
      line: null,
      col: null,
    })
  })
})

test('opening at a line puts the cursor there', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `const v${i} = ${i}`).join('\n')
  const dir = fixture({ 'big.ts': `${lines}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts'), openLine: 41 })

  expect(t.captureCharFrame()).toContain('Ln 42, Col 1')
})

test('opening at a line and column puts the cursor on both', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `const v${i} = ${i}`).join('\n')
  const dir = fixture({ 'big.ts': `${lines}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts'), openLine: 41, openCol: 6 })

  expect(t.captureCharFrame()).toContain('Ln 42, Col 7')
})

test('a column past the end of the line stops at the end', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'a.ts'), openLine: 0, openCol: 999 })

  expect(t.captureCharFrame()).toContain('Ln 1, Col 12')
})
