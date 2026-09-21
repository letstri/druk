import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ALT } from '../src/ui/keys'
import {
  fixture,
  launch,
  openFile,
  openPalette,
  press,
  pressTimes,
  runCommand,
  until,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

const PROJECT = { 'a.ts': 'const a = 1\n' }

function repo() {
  const dir = tempDir('druk-hints-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
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

test('the footer offers to follow the specifier the cursor is on', async () => {
  const dir = fixture({ 'a.ts': "import 'bun'\n" })
  const t = await launch(
    dir,
    {},
    { width: 120 },
    { openFile: join(dir, 'a.ts') }
  )

  await until(t, () => bar(t).includes('Ctrl+F find'))
  expect(bar(t)).not.toContain('open path')

  await pressTimes(t, 10, (input) => input.pressArrow('right'))
  await until(t, () => bar(t).includes(`Ctrl+${ALT}+O open path`))
}, 15_000)

test('a rebound command shows its new chord in the palette', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { save: 'Ctrl+J' } })
  await openPalette(t)
  await press(t, (input) => input.typeText('Save file'))
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

test('the footer names the definition key where a server serves the file', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'notes.txt': 'plain\n' })
  const fake = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, fake] } },
    { width: 120 },
    { openFile: join(dir, 'a.ts') }
  )

  await until(t, () => bar(t).includes('F12 definition'))

  await openFile(t, 'notes.txt')
  await until(t, () => !bar(t).includes('F12 definition'))
}, 20_000)
