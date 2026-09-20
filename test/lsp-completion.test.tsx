import { expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  fixture,
  launch,
  loadMarketExtensions,
  press,
  pressEscape,
  runCommand,
  settle,
  spansOf,
  untilFrame,
  untilGone,
} from './helpers'

loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

const LSP_WAIT = 15_000

const READY_FILE = { 'a.ts': 'oops\n' }

const lspConfig = {
  lsp: true,
  lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] },
}

async function readyEditor(files = READY_FILE) {
  const dir = fixture(files)
  const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') })
  await untilFrame(t, '● 1', LSP_WAIT)
  return t
}

test('typing opens the menu, Enter inserts the best match', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('drukBeta')
  expect(t.captureCharFrame()).toContain('ƒ')
  expect(t.captureCharFrame()).toContain('() => void')

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'drukAlpha()oops', LSP_WAIT)
  await untilGone(t, 'drukBeta')
}, 30_000)

test('Ctrl+N walks the menu instead of opening a new file', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, '1/4', LSP_WAIT)
  await press(t, input => input.pressKey('n', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('2/4')
  await press(t, input => input.pressKey('p', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('1/4')
}, 30_000)

test('the menu draws the origin, the kind and the resolved documentation', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('(alpha)')
  expect(t.captureCharFrame()).toContain('druk/alpha')
  expect(t.captureCharFrame()).toContain('function · Tab accepts')
  expect(t.captureCharFrame()).toContain('1/4')
  expect(t.captureCharFrame()).toContain('() => void')
  await untilFrame(t, 'Alpha greets the caller.', LSP_WAIT)

  // The panel's filler once painted a zero-height row over the box's own bottom border.
  expect(t.captureCharFrame()).toContain('╰──')

  await press(t, input => input.pressArrow('down'))
  await untilGone(t, 'Alpha greets the caller.', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('variable')
}, 30_000)

test('the panel paints the signature as code and names where the symbol comes from', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, '() => void', LSP_WAIT)

  const spans = spansOf(t, '() => void')
  const colorOf = (text: string) => spans.find(span => span.text === text)?.fg
  expect(colorOf('void')).toBeDefined()
  expect(colorOf('()')).toBeDefined()
  expect(colorOf('void')).not.toBe(colorOf('()'))

  const rows = t
    .captureCharFrame()
    .split('\n')
    .filter(row => row.includes('druk/alpha'))
  expect(rows.length).toBe(2)
}, 30_000)

test('typing more filters the list; Escape dismisses it', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukBeta', LSP_WAIT)

  await press(t, input => void input.typeText('B'))
  await untilGone(t, 'drukAlpha', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('drukBeta')

  await pressEscape(t)
  await untilGone(t, 'drukBeta', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('drukBoops')
}, 30_000)

test('an accepted auto-import lands its additionalTextEdit', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('drukImp'))
  await untilFrame(t, 'drukImported', LSP_WAIT)

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'import { drukImported } from "druk"', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('drukImportedoops')
}, 30_000)

test('an auto-import withheld until completionItem/resolve still lands', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('drukLazy'))
  await untilFrame(t, 'resolve-import', LSP_WAIT)

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'import { drukLazy } from "druk"', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('drukLazyoops')
}, 30_000)

test('Ctrl+Space asks without a prefix and ↓ walks the list', async () => {
  const t = await readyEditor()

  await press(t, input => input.pressKey(' ', { ctrl: true }))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)

  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'import { drukImported } from "druk"', LSP_WAIT)
}, 30_000)

test('a dot typed over the open menu asks again at the member position', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)

  await press(t, input => void input.typeText('.'))
  await untilFrame(t, 'memTable', LSP_WAIT)
  await untilGone(t, 'drukAlpha')
  expect(t.captureCharFrame()).toContain('memOther')
}, 30_000)

test('a trigger retyped after a backspace is asked at the member position', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)

  for (let round = 0; round < 3; round++) {
    await press(t, input => void input.typeText('.'))
    await untilFrame(t, 'memTable', LSP_WAIT)
    await press(t, input => input.pressBackspace())
    await press(t, input => void input.typeText('.'))
    await untilFrame(t, 'memTable', LSP_WAIT)
    // Fixed wait: the stale global list would arrive 400ms later.
    await settle(t, 600)
    expect(t.captureCharFrame()).not.toContain('drukAlpha')
    await press(t, input => input.pressBackspace())
    await untilGone(t, 'memTable', LSP_WAIT)
  }
}, 30_000)

test('a keystroke that leaves the scope cancels the ask the trigger scheduled', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  await press(t, input => void input.typeText('.'))
  await press(t, input => void input.typeText(')'))
  // Fixed wait, longer than the fake's 400ms delay: the menu must stay shut.
  await settle(t, 800)
  expect(t.captureCharFrame()).not.toContain('memTable')
  expect(t.captureCharFrame()).not.toContain('drukAlpha')
}, 30_000)

test('a reply overtaken by a scope-changing keystroke is dropped', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await new Promise(resolve => setTimeout(resolve, 150))
  await press(t, input => void input.typeText('('))
  await new Promise(resolve => setTimeout(resolve, 600))
  await press(t, input => input.pressArrow('right'))
  expect(t.captureCharFrame()).not.toContain('drukAlpha')
}, 30_000)

test('the palette command triggers the menu, Escape dismisses it', async () => {
  const t = await readyEditor()

  await runCommand(t, 'Trigger autocomplete')
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  await pressEscape(t)
  await untilGone(t, 'drukAlpha', LSP_WAIT)
}, 30_000)

test('the settings page carries the Autocomplete toggle', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Tall: the page windows its rows and the server rows come last.
  const t = await launch(dir, {}, { height: 46 })

  await runCommand(t, 'Settings')
  await untilFrame(t, 'Autocomplete')
}, 15_000)

test('lspCompletion off means no menu, however hard you ask', async () => {
  const dir = fixture(READY_FILE)
  const t = await launch(
    dir,
    { ...lspConfig, lspCompletion: false },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await untilFrame(t, '● 1', LSP_WAIT)

  await press(t, input => void input.typeText('druk'))
  await press(t, input => input.pressKey(' ', { ctrl: true }))
  await new Promise(resolve => setTimeout(resolve, 300))
  await press(t, input => input.pressKey('x'))
  expect(t.captureCharFrame()).not.toContain('drukAlpha')
}, 30_000)

test('the menu opens under the caret in a scrolled file', async () => {
  const lines = ['oops']
  for (let n = 2; n <= 130; n++) lines.push(`x${n}`)
  const dir = fixture({ 'a.ts': `${lines.join('\n')}\n` })
  const t = await launch(
    dir,
    lspConfig,
    { width: 100, height: 50 },
    { openFile: join(dir, 'a.ts'), openLine: 103 },
  )
  await untilFrame(t, '● 1', LSP_WAIT)

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  const rows = t.captureCharFrame().split('\n')
  const caret = rows.findIndex(row => row.includes('drukx104'))
  // `visualRow` is a viewport row: subtracting the scroll offset again drops the menu off-screen.
  expect(rows[caret + 2]).toContain('drukAlpha')
}, 30_000)
