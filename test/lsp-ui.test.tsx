import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ALT } from '../src/ui/keys'
import {
  fixture,
  launch,
  loadMarketExtensions,
  openFile,
  press,
  pressEscape,
  runCommand,
  settle,
  until,
  untilFrame,
  untilGone,
} from './helpers'

// druk ships no language servers: the specs these tests override live in the
// market, so the extension that carries them has to be registered first.
loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')
const MARKER = join(import.meta.dir, 'fixtures', 'marker-lsp.ts')
const INIT = join(import.meta.dir, 'fixtures', 'init-lsp.ts')
const PULL = join(import.meta.dir, 'fixtures', 'pull-lsp.ts')
const CONFIG = join(import.meta.dir, 'fixtures', 'config-lsp.ts')

/** Diagnostics cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

test('diagnostics reach the status bar, the problems list, and next-problem', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  // The edit reaches the server through the debounced didChange, so this
  // exercises the whole pipeline, not just the didOpen snapshot.
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)

  // The message is drawn inline after the line's end, before any list opens —
  // on the same row as the code it belongs to.
  await untilFrame(t, 'found oops', LSP_WAIT)
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('oopsconst'))
  expect(row).toContain('found oops')

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('a.ts:1:1')

  // Enter jumps to the diagnostic and closes the list.
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 1, Col 1', LSP_WAIT)
  await untilGone(t, 'Enter jumps')

  // Next problem wraps to the same diagnostic and reads it out.
  await runCommand(t, 'Next problem')
  await untilFrame(t, 'found oops', LSP_WAIT)
}, 30_000)

test('the problems list carries the rule, the path and the whole message', async () => {
  const dir = fixture({ 'src/deep/a.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 110, height: 34 },
    { openFile: join(dir, 'src/deep/a.ts') },
  )

  // A warning on the first line and an error on the second, so the list has to
  // put them in an order of its own rather than the file's.
  await press(t, input => void input.typeText('nag'))
  await press(t, input => input.pressArrow('down'))
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  const list = t.captureCharFrame()
  // The severity tally, the rule that fired, and the path from the project root
  // rather than the bare file name two directories can share.
  expect(list).toContain('1 error · 1 warning')
  expect(list).toContain('fake(no-oops)')
  expect(list).toContain('src/deep/a.ts:2:')
  // The error is above the warning whatever order the file has them in. Counted
  // from the modal's heading: the editor's own inline text is on screen above it.
  const rows = list.split('\n')
  const inList = rows.slice(rows.findIndex(row => row.includes('1 error · 1 warning')))
  expect(inList.findIndex(row => row.includes('found oops'))).toBeLessThan(
    inList.findIndex(row => row.includes('this is a very wordy')),
  )

  // The wordy one's tail fits in no row, so it is only readable once the
  // selection reaches it and the detail block spells the message out.
  expect(list).not.toContain('never enough to read one')
  await press(t, input => input.pressArrow('down'))
  await untilFrame(t, 'never enough to read one', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('warning · src/deep/a.ts:1:')
}, 30_000)

test('the inline note is what broke, and the whole of it is one chord away', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 120, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('nag'))
  await untilFrame(t, '▲ 1', LSP_WAIT)
  // The server's advice is dropped from the row beside the code — an ellipsis
  // says there is more, and the chord that shows the rest is named on the row
  // the caret is on, which is the only way to find a key nobody has been told.
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('nagconst'))
  expect(row).toContain('this is a very wordy diagnostic…')
  expect(row).not.toContain('real servers append')
  expect(row).toContain(`Ctrl+${ALT}+I`)

  await runCommand(t, 'Show problem at cursor')
  await untilFrame(t, 'Problem at cursor', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('list is never enough to read one')

  // A line with nothing on it says so rather than opening an empty modal — and
  // the hint goes with the caret, so it is not repeated down the whole file.
  await pressEscape(t)
  await untilGone(t, 'Problem at cursor')
  await press(t, input => input.pressArrow('down'))
  expect(
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('nagconst')),
  ).not.toContain(`Ctrl+${ALT}+I`)
  await runCommand(t, 'Show problem at cursor')
  await untilFrame(t, 'No problem on this line', LSP_WAIT)
}, 30_000)

test('a message only the width shortened gets the hint too', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Wide enough for the note to be drawn, narrow enough for it to be cut: the
  // message carries no advice, so nothing but the terminal shortens it.
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 80, height: 12 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('huh'))
  await untilFrame(t, 'Cannot find module', LSP_WAIT)
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('huhconst'))
  expect(row).toContain('…')
  expect(row).toContain(`Ctrl+${ALT}+I`)
}, 30_000)

test('the settings page shows the LSP rows and the master toggle flips', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Tall enough for every section: the page windows its rows to what it can draw,
  // and the language-server rows are the last of them.
  const t = await launch(dir, {}, { height: 47 })

  await runCommand(t, 'Settings')
  await untilFrame(t, 'LSP diagnostics')
  expect(t.captureCharFrame()).toContain('Inline problem text')
  expect(t.captureCharFrame()).toMatch(/\d+\/\d+ enabled/)
}, 15_000)

test('a missing server with an npm package offers to install it', async () => {
  // The trigger is the *default* command being absent, which an override would
  // hide — so this is one of the few tests that depends on the host. php is the
  // least likely server for a druk developer to have; skip rather than guess.
  if (Bun.which('intelephense') || !Bun.which('node')) return
  const dir = fixture({ 'a.php': '<?php\n' })
  const t = await launch(
    dir,
    { lsp: true, lspAutoInstall: true },
    {},
    { openFile: join(dir, 'a.php') },
  )

  await untilFrame(t, 'Language server missing', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('intelephense is not installed')
  expect(t.captureCharFrame()).toContain('npm')

  // Declining leaves the install line behind, and does not ask again.
  await pressEscape(t)
  await untilFrame(t, 'npm i -g intelephense')
}, 30_000)

test('a missing server druk cannot install just says so', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // An override rules out the install offer: the hint names the default's
  // package, which is not what this command is.
  // Wide enough for the whole sentence: the status bar truncates at 80 columns.
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
  expect(t.captureCharFrame()).not.toContain('Language server missing')
}, 30_000)

test('the chosen TypeScript is handed to the server, and no choice sends nothing', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const dump = join(dir, 'init.json')
  const server = { typescript: [process.execPath, INIT, dump], eslint: [], oxlint: [] }

  const chosen = await launch(
    dir,
    { lsp: true, lspServers: server, typescriptTsdk: '/opt/ts/lib' },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await until(chosen, () => existsSync(dump), LSP_WAIT)
  await until(chosen, () => readFileSync(dump, 'utf8').includes('/opt/ts/lib'), LSP_WAIT)
  expect(JSON.parse(readFileSync(dump, 'utf8'))).toEqual({ tsserver: { path: '/opt/ts/lib' } })
  chosen.renderer.destroy()

  // Left empty the server picks for itself — it prefers the open project's own
  // copy, so sending a path here would override the very thing that should win.
  rmSync(dump)
  const auto = await launch(
    dir,
    { lsp: true, lspServers: server },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await until(auto, () => existsSync(dump), LSP_WAIT)
  expect(JSON.parse(readFileSync(dump, 'utf8'))).toBeNull()
}, 30_000)

test('a server spawns only once a file of its language opens', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n', 'readme.md': 'hi\n' })
  const marker = join(dir, 'spawn-marker')
  const t = await launch(dir, {
    lsp: true,
    lspServers: { typescript: [process.execPath, MARKER, marker], eslint: [], oxlint: [] },
  })

  // No file open: nothing may spawn, however long the editor sits there.
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  // A file of another language does not wake the typescript server either.
  await openFile(t, 'readme.md')
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  await openFile(t, 'a.ts')
  await until(t, () => existsSync(marker), LSP_WAIT)
}, 30_000)

test('inline text hides when the setting is off, the gutter dot stays', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspInline: false,
      lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] },
    },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, '● 1', LSP_WAIT)
  expect(t.captureCharFrame()).not.toContain('found oops')
}, 30_000)

test('a problem far below the viewport is marked on the track', async () => {
  const lines = Array.from({ length: 400 }, (_, index) => `const value${index} = ${index}`)
  lines[380] = 'const oops = 1'
  const dir = fixture({ 'big.ts': `${lines.join('\n')}\n` })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 100, height: 24 },
    { openFile: join(dir, 'big.ts') },
  )

  await untilFrame(t, '● 1', LSP_WAIT)
  const frame = t.captureCharFrame().split('\n').filter(Boolean)
  const marked = frame.flatMap((row, index) => (row.includes('•') ? [index] : []))

  expect(marked).toHaveLength(1)
  // Near the bottom of the track, where line 380 of 400 belongs — seeing that
  // without scrolling is the whole point of the column.
  expect(marked[0]!).toBeGreaterThan(frame.length * 0.8)
}, 30_000)

/** Lines in the marker file: one per spawn of the server. */
const spawns = (marker: string) =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0

test('the restart command spawns the servers again and re-opens the documents', async () => {
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

  await runCommand(t, 'Restart language servers')
  await untilFrame(t, 'Restarted language servers')
  await until(t, () => spawns(marker) === 2, LSP_WAIT)

  // The typed text only reaches the new server if the document was opened into
  // it: a restart that forgot to re-open would leave this diagnostic unreported.
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)
}, 30_000)

test('installing dependencies restarts the servers by itself', async () => {
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

  // What `bun install` looks like from the watcher's side. A server started
  // before this resolved every import against a tree that did not exist.
  mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')

  // A real install is a storm of events; this is one burst, and macOS can drop
  // a lone burst that lands while a previous event's callback is dispatching
  // (reproducible under CPU load — the restart then never comes). Touch the
  // tree again until the restart is seen, slower than the 2s dependency-quiet
  // window: a faster cadence would reset the debounce on every touch and hold
  // the restart off forever.
  let touched = Date.now()
  await until(
    t,
    () => {
      if (spawns(marker) >= 2) return true
      if (Date.now() - touched > 2_500) {
        touched = Date.now()
        writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
      }
      return false
    },
    LSP_WAIT,
  )
  expect(t.captureCharFrame()).toContain('Dependencies changed')
}, 30_000)

test('a server that only answers pulls still fills the gutter and the list', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, PULL], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  // Nothing was published: this diagnostic exists only because druk asked for
  // it after the didOpen.
  await untilFrame(t, 'pulled oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('● 1')

  // And it asks again after an edit, or the marks would describe older text.
  await press(t, input => void input.typeText('oops '))
  await untilFrame(t, '● 2', LSP_WAIT)
}, 30_000)

test('a file is served by every server for its language, and their marks merge', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    {
      lsp: true,
      // Both serve `typescript` — the market's eslint extension is what makes
      // the second one resolve at all, and this only swaps its command.
      lspServers: {
        typescript: [process.execPath, FAKE],
        eslint: [process.execPath, CONFIG],
        oxlint: [],
      },
    },
    { height: 30 },
    { openFile: join(dir, 'a.ts') },
  )

  // One from each server, and neither replaced the other: a publish carries the
  // sender's marks alone.
  await untilFrame(t, 'found oops', LSP_WAIT)
  // Two warnings, one per way the settings can arrive: the request the server
  // makes after the handshake, and the push druk sends unasked. Counted rather
  // than read off the line — only one message is drawn inline per line, and
  // both of these land on the first.
  await untilFrame(t, '▲ 2', LSP_WAIT)
  await runCommand(t, 'List problems')
  const list = t.captureCharFrame()
  expect(list).toContain('found oops')
  expect(list).toContain('configured by request')
  expect(list).toContain('configured by push')
}, 30_000)
