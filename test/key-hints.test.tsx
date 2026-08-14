import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fixture, launch, openPalette, press, runCommand, until } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

/** A repo with one change, so the source-control panel has a row to sit on. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-hints-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@e.com')
  git('config', 'user.name', 'T')
  writeFileSync(join(dir, 'a.ts'), 'const alpha = 1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'const alpha = 2\n')
  return dir
}

const bar = (t: Harness) => t.captureCharFrame().split('\n').at(-2) ?? ''

test('the tree footer advertises its own keys, not just the global pair', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 120 })
  const row = bar(t)
  expect(row).toContain('Space preview')
  expect(row).toContain('a new')
})

test('the source-control panel brings its keys into the footer', async () => {
  const t = await launch(repo(), {}, { width: 120 })
  await until(t, () => bar(t).includes('⎇'))
  await runCommand(t, 'Source control (commit / push)')
  await until(t, () => bar(t).includes('Space stage'))
  expect(bar(t)).toContain('c commit')
})

test('a rebound command shows its new chord in the palette', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { save: 'Ctrl+J' } })
  await openPalette(t)
  await press(t, input => void input.typeText('Save file'))
  expect(t.captureCharFrame()).toContain('Ctrl+J')
})

test('running a keyed command from the palette names the key', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Toggle sidebar')
  await until(t, () => bar(t).includes('Tip: Ctrl+B'))
  expect(bar(t)).toContain('Show / hide sidebar')
})

test('a command with no key earns no tip', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 120 })
  await runCommand(t, 'Toggle word wrap')
  expect(bar(t)).not.toContain('Tip:')
})
