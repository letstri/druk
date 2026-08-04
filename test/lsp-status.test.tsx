import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  loadMarketExtensions,
  press,
  pressEscape,
  runCommand,
  until,
  untilFrame,
  untilGone,
} from './helpers'

// druk ships no language servers: the specs these tests override live in the
// market, so the extension that carries them has to be registered first.
loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')
const MARKER = join(import.meta.dir, 'fixtures', 'marker-lsp.ts')

/** Diagnostics cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

test('the status page shows a running server, its log, and closes on Esc', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 100 },
    { openFile: join(dir, 'a.ts') },
  )

  // Ready for sure: the diagnostic has crossed the wire before the page opens.
  await untilFrame(t, '● 1', LSP_WAIT)
  await runCommand(t, 'Language server status')
  await untilFrame(t, 'Language servers', LSP_WAIT)

  const frame = t.captureCharFrame()
  expect(frame).toContain('typescript · ready')
  expect(frame).toContain('1 open')
  expect(frame).toContain('fake-lsp')
  // The three log sources: a lifecycle event, the document sync, and stderr.
  expect(frame).toContain('initialized — diagnostics published')
  expect(frame).toContain('opened a.ts')
  expect(frame).toContain('fake-lsp standing by')

  await pressEscape(t)
  await untilGone(t, 'Language servers')
  expect(t.captureCharFrame()).toContain('const oops = 1')
}, 30_000)

test('a server that could not start shows as failed, with the reason', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: { typescript: ['druk-no-such-language-server'], eslint: [], oxlint: [] },
    },
    { width: 110 },
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, 'is not installed, or not on PATH', LSP_WAIT)
  await runCommand(t, 'Language server status')
  await untilFrame(t, 'failed', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('typescript · failed — is not installed')
}, 30_000)

/** Lines in the marker file: one per spawn of the server. */
const spawns = (marker: string) =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0

test('r on the page restarts the servers', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const marker = join(dir, 'spawn-marker')
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: { typescript: [process.execPath, MARKER, marker], eslint: [], oxlint: [] },
    },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await until(t, () => spawns(marker) === 1, LSP_WAIT)

  await runCommand(t, 'Language server status')
  await untilFrame(t, 'Language servers')
  await press(t, input => input.pressKey('r'))
  await untilFrame(t, 'Restarted language servers')
  await until(t, () => spawns(marker) === 2, LSP_WAIT)
}, 30_000)

test('d on the page refuses to remove a server druk did not install', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 100 },
    { openFile: join(dir, 'a.ts') },
  )
  await untilFrame(t, '● 1', LSP_WAIT)
  await runCommand(t, 'Language server status')
  await untilFrame(t, 'Language servers', LSP_WAIT)

  await press(t, input => input.pressKey('d'))
  // No confirm, because there is nothing of druk's to delete: this command was
  // overridden onto a fixture, and one on PATH or in the project is the user's.
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Remove language server')
  expect(frame).toContain('druk did not install it')
}, 30_000)
