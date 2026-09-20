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

const FAKELANG_EXTENSION = {
  id: 'fakelang',
  name: 'Fakelang',
  version: '1.0.0',
  description: 'a language whose server is never installed',
  languages: [
    {
      id: 'fakelang',
      extensions: ['.fakelang'],
      patterns: [{ group: 'keyword', re: '\\bhello\\b', flags: 'g' }],
    },
  ],
  languageServers: [
    {
      id: 'fakelang',
      command: ['druk-no-such-fakelang-server', '--stdio'],
      filetypes: ['fakelang'],
      install: { kind: 'npm', packages: ['druk-no-such-fakelang-server'] },
    },
  ],
}
const fakelangDir = join(process.env.XDG_CONFIG_HOME!, '.druk', 'extensions', 'fakelang')
mkdirSync(fakelangDir, { recursive: true })
writeFileSync(join(fakelangDir, 'extension.json'), JSON.stringify(FAKELANG_EXTENSION))

loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')
const MARKER = join(import.meta.dir, 'fixtures', 'marker-lsp.ts')
const INIT = join(import.meta.dir, 'fixtures', 'init-lsp.ts')
const PULL = join(import.meta.dir, 'fixtures', 'pull-lsp.ts')
const CONFIG = join(import.meta.dir, 'fixtures', 'config-lsp.ts')

const LSP_WAIT = 15_000

test('diagnostics reach the status bar, the problems list, and next-problem', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)

  await untilFrame(t, 'found oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('● error')

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('a.ts:1:1')

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 1, Col 1', LSP_WAIT)
  await untilGone(t, 'Enter jumps')

  await press(t, input => void input.pressKeys(['F8']))
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

  await press(t, input => void input.typeText('nag'))
  await press(t, input => input.pressArrow('down'))
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  const list = t.captureCharFrame()
  expect(list).toContain('1 error · 1 warning')
  expect(list).toContain('fake(no-oops)')
  expect(list).toContain('src/deep/a.ts:2:')
  const rows = list.split('\n')
  const inList = rows.slice(rows.findIndex(row => row.includes('1 error · 1 warning')))
  expect(inList.findIndex(row => row.includes('found oops'))).toBeLessThan(
    inList.findIndex(row => row.includes('this is a very wordy')),
  )

  expect(list).not.toContain('never enough to read one')
  await press(t, input => input.pressArrow('down'))
  await untilFrame(t, 'never enough to read one', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('warning · src/deep/a.ts:1:')
}, 30_000)

test('the inline note is what broke, and the card under the line says the rest', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 120, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('nag'))
  await untilFrame(t, '▲ 1', LSP_WAIT)
  await press(t, input => input.pressArrow('down'))
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('nagconst'))
  expect(row).toContain('this is a very wordy diagnostic…')
  expect(row).not.toContain('real servers append')
  expect(row).not.toContain(`Ctrl+${ALT}+I`)
  await runCommand(t, 'Show problem at cursor')
  await untilFrame(t, 'No problem on this line', LSP_WAIT)

  await press(t, input => input.pressArrow('up'))
  await untilFrame(t, 'real servers append', LSP_WAIT)
  const framed = t.captureCharFrame()
  expect(framed).toContain('list is never enough to read one')
  expect(framed).toContain('▲ warning')
  expect(framed.split('\n').find(line => line.includes('nagconst'))).not.toContain(
    'this is a very wordy',
  )

  await runCommand(t, 'Show problem at cursor')
  await untilFrame(t, 'Problem at cursor', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('list is never enough to read one')
  await pressEscape(t)
  await untilGone(t, 'Problem at cursor')
}, 30_000)

test('a message only the width shortened is spelled out in the card', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Wide enough for the note to be drawn, narrow enough for it to be cut.
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 80, height: 12 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('huh'))
  await untilFrame(t, 'corresponding type declarations', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('● error')
}, 30_000)

test('advice the row drops opens the card even where the whole message would fit', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 160, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('tip'))
  await untilFrame(t, 'with advice the row drops', LSP_WAIT)
  const framed = t.captureCharFrame()
  expect(framed).toContain('● error')
  expect(framed.split('\n').find(line => line.includes('tipconst'))).not.toContain('short gripe')
}, 30_000)

test('a short message is a card on the caret line and a note on every other', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 120, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● error', LSP_WAIT)
  expect(
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('oopsconst')),
  ).not.toContain('found oops')

  await press(t, input => input.pressArrow('down'))
  await untilGone(t, '● error')
  expect(
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('oopsconst')),
  ).toContain('found oops')
}, 30_000)

test('a message longer than the cards used to hold is on screen whole', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 90, height: 34 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('wall'))
  await untilFrame(t, 'Argument of type', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('who will read that far')

  await runCommand(t, 'Show problem at cursor')
  await untilFrame(t, 'Problem at cursor', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('three paragraphs suggesting')
}, 30_000)

test('the settings page shows the LSP rows and the master toggle flips', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Tall: the page windows its rows and the server rows are last.
  const t = await launch(dir, {}, { height: 48 })

  await runCommand(t, 'Settings')
  await untilFrame(t, 'LSP diagnostics')
  expect(t.captureCharFrame()).toContain('Inline problem text')
  expect(t.captureCharFrame()).toMatch(/\d+\/\d+ enabled/)
}, 15_000)

test('a missing server with an npm package offers to install it', async () => {
  if (!Bun.which('node')) return
  const dir = fixture({ 'a.fakelang': 'hello\n' })
  // Wide enough for the decline line: the status bar truncates at the width.
  const t = await launch(
    dir,
    { lsp: true, lspAutoInstall: true },
    { width: 130 },
    { openFile: join(dir, 'a.fakelang') },
  )

  await untilFrame(t, 'Language server missing', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('druk-no-such-fakelang-server is not installed')
  expect(t.captureCharFrame()).toContain('npm')

  await pressEscape(t)
  await untilFrame(t, 'npm i -g druk-no-such-fakelang-server')
}, 30_000)

test('a missing server druk cannot install just says so', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
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

  // Fixed wait: the assertion is that nothing spawns.
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  await openFile(t, 'readme.md')
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  await openFile(t, 'a.ts')
  await until(t, () => existsSync(marker), LSP_WAIT)
}, 30_000)

test('a folded line with a diagnostic on it says both, one after the other', async () => {
  const dir = fixture({ 'a.ts': 'const oops = {\n  a: 1,\n}\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 120, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, 'found oops', LSP_WAIT)
  await runCommand(t, 'Fold block at cursor')
  await untilFrame(t, '⋯ 1 line', LSP_WAIT)
  // The caret's own line wears the card instead of the note.
  await press(t, input => input.pressArrow('down'))
  await untilFrame(t, 'found oops', LSP_WAIT)

  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('const oops = {'))
  expect(row).toContain('⋯ 1 line')
  expect(row).toContain('found oops')
  expect(row!.indexOf('⋯ 1 line')).toBeLessThan(row!.indexOf('found oops'))
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

const STRIKETHROUGH = 1 << 7

test('a Deprecated span is struck through, and its neighbours are not', async () => {
  const dir = fixture({ 'a.ts': 'const stale = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  const struck = () => {
    const frame = t.captureSpans() as unknown as {
      lines: { spans: { text: string; attributes: number }[] }[]
    }
    return frame.lines
      .flatMap(line => line.spans)
      .filter(span => (span.attributes & STRIKETHROUGH) !== 0)
      .map(span => span.text.trim())
  }

  await until(t, () => struck().length > 0, LSP_WAIT)
  expect(struck()).toEqual(['stale'])
}, 30_000)

test('a span crossing lines is marked on every line it covers', async () => {
  const dir = fixture({ 'a.ts': 'const sprawl = {\n  a: 1,\n}\nconst after = 2\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  const struck = () => {
    const frame = t.captureSpans() as unknown as {
      lines: { spans: { text: string; attributes: number }[] }[]
    }
    return frame.lines
      .map(line =>
        line.spans
          .filter(span => (span.attributes & STRIKETHROUGH) !== 0)
          .map(span => span.text)
          .join('')
          .trim(),
      )
      .filter(Boolean)
  }

  // Off the span's first line: the card under the caret would cover the rows below it.
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressArrow('down'))
  await until(t, () => struck().length > 1, LSP_WAIT)
  expect(struck().join(' ')).toBe('sprawl = { a: 1, }')
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
  expect(marked[0]!).toBeGreaterThan(frame.length * 0.8)
}, 30_000)

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

  mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')

  // macOS drops fs events under load; touch slower than the 2s window or the debounce resets.
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

  await untilFrame(t, 'pulled oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('● 1')

  await press(t, input => void input.typeText('oops '))
  await untilFrame(t, '● 2', LSP_WAIT)
}, 30_000)

test('a file is served by every server for its language, and their marks merge', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        typescript: [process.execPath, FAKE],
        eslint: [process.execPath, CONFIG],
        oxlint: [],
      },
    },
    { height: 30 },
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, 'found oops', LSP_WAIT)
  await untilFrame(t, '▲ 2', LSP_WAIT)
  await runCommand(t, 'List problems')
  const list = t.captureCharFrame()
  expect(list).toContain('found oops')
  expect(list).toContain('configured by request')
  expect(list).toContain('configured by push')
}, 30_000)

test('clicking a note or a card lands the caret on the line under it', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    { width: 120, height: 24 },
    { openFile: join(dir, 'a.ts') },
  )

  await press(t, input => void input.typeText('nag'))
  await untilFrame(t, '▲ 1', LSP_WAIT)
  await press(t, input => input.pressArrow('down'))
  await untilFrame(t, 'Ln 2, Col 4', LSP_WAIT)

  const rows = t.captureCharFrame().split('\n')
  const at = rows.findIndex(row => row.includes('nagconst'))
  await t.mockMouse.click(rows[at]!.indexOf('this is a very wordy'), at)
  await untilFrame(t, 'Ln 1, Col 15', LSP_WAIT)

  // The card covers the line under it: clicking its text is a click on that code.
  const card = t
    .captureCharFrame()
    .split('\n')
    .findIndex(row => row.includes('real servers append'))
  await t.mockMouse.click(6, card)
  await untilFrame(t, 'Ln 3, Col 1', LSP_WAIT)
}, 30_000)
