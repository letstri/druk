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

// druk ships no language servers: the specs these tests override live in the
// market, so the extension that carries them has to be registered first.
loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** Completions cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

/** A file whose diagnostic doubles as the "server is up" signal. */
const READY_FILE = { 'a.ts': 'oops\n' }

const lspConfig = {
  lsp: true,
  // The market's eslint and oxlint extensions serve typescript too; these tests
  // are about the one server they name, so the rest are turned off rather than
  // spawned.
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

  // No Ctrl+Space: the identifier characters themselves must open the menu.
  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  // All three fake items match the prefix, with their kinds and details drawn.
  expect(t.captureCharFrame()).toContain('drukBeta')
  expect(t.captureCharFrame()).toContain('ƒ')
  expect(t.captureCharFrame()).toContain('() => void')

  await press(t, input => input.pressEnter())
  // drukAlpha's insertText carries the call parens; the prefix is replaced.
  await untilFrame(t, 'drukAlpha()oops', LSP_WAIT)
  await untilGone(t, 'drukBeta')
}, 30_000)

test('the menu draws the origin, the kind and the resolved documentation', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  // labelDetails: the signature beside the label, the origin at the right edge.
  expect(t.captureCharFrame()).toContain('(alpha)')
  expect(t.captureCharFrame()).toContain('druk/alpha')
  // The counter row names what the selection is, not just where it is — and the
  // key that takes it, which nothing else on screen says while the menu is up.
  expect(t.captureCharFrame()).toContain('function · Tab accepts')
  expect(t.captureCharFrame()).toContain('1/4')
  // The panel shows the detail that came with the list, then the documentation
  // the server withholds until `completionItem/resolve` — markdown flattened.
  expect(t.captureCharFrame()).toContain('() => void')
  await untilFrame(t, 'Alpha greets the caller.', LSP_WAIT)

  // A row with no docs of its own leaves the panel with only its detail.
  await press(t, input => input.pressArrow('down'))
  await untilGone(t, 'Alpha greets the caller.', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('variable')
}, 30_000)

test('the panel paints the signature as code and names where the symbol comes from', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, '() => void', LSP_WAIT)

  // The signature is a declaration, not a sentence: the panel parses it as the
  // open file's language, so the arrow and the type are not one flat run.
  const spans = spansOf(t, '() => void')
  const colorOf = (text: string) => spans.find(span => span.text === text)?.fg
  expect(colorOf('void')).toBeDefined()
  expect(colorOf('()')).toBeDefined()
  expect(colorOf('void')).not.toBe(colorOf('()'))

  // The origin is drawn into a row the panel would otherwise leave blank — the
  // list row cuts it, and on a narrow menu drops it altogether.
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
  // The document text itself survives untouched.
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

  // Down past the first two rows, then accept the third (the auto-import one).
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'import { drukImported } from "druk"', LSP_WAIT)
}, 30_000)

test('a dot typed over the open menu asks again at the member position', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)

  // The dot closes the identifier menu and is itself the trigger for a member
  // ask — the fake answers positions after a `.` with the member list.
  await press(t, input => void input.typeText('.'))
  await untilFrame(t, 'memTable', LSP_WAIT)
  await untilGone(t, 'drukAlpha')
  expect(t.captureCharFrame()).toContain('memOther')
}, 30_000)

test('a trigger retyped after a backspace is asked at the member position', async () => {
  const t = await readyEditor()

  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)

  // Backspacing over the dot puts the buffer back to the text the server was
  // last sent — which used to leave the edit queued for the backspace itself
  // standing, so the next ask flushed a document one keystroke behind the
  // column it was about and the server answered for the scope before the dot.
  for (let round = 0; round < 3; round++) {
    await press(t, input => void input.typeText('.'))
    await untilFrame(t, 'memTable', LSP_WAIT)
    // Back-to-back, inside the didChange debounce: that is the window where the
    // queued edit and the buffer disagree.
    await press(t, input => input.pressBackspace())
    await press(t, input => void input.typeText('.'))
    await untilFrame(t, 'memTable', LSP_WAIT)
    // The global list is what a stale document answers with, 400ms later.
    await settle(t, 600)
    expect(t.captureCharFrame()).not.toContain('drukAlpha')
    await press(t, input => input.pressBackspace())
    await untilGone(t, 'memTable', LSP_WAIT)
  }
}, 30_000)

test('a keystroke that leaves the scope cancels the ask the trigger scheduled', async () => {
  const t = await readyEditor()

  // The dot schedules the member ask; the `)` lands before the debounce is up
  // and carries the cursor out of the scope the dot named. Asking there is what
  // put file-scope globals under a `from '@opentui/'` whose closing quote was
  // typed a moment after the slash.
  await press(t, input => void input.typeText('druk'))
  await untilFrame(t, 'drukAlpha', LSP_WAIT)
  await press(t, input => void input.typeText('.'))
  await press(t, input => void input.typeText(')'))
  // Longer than the fake's 400ms delay on the global list: the menu must stay
  // shut rather than open on an answer for the wrong position.
  await settle(t, 800)
  expect(t.captureCharFrame()).not.toContain('memTable')
  expect(t.captureCharFrame()).not.toContain('drukAlpha')
}, 30_000)

test('a reply overtaken by a scope-changing keystroke is dropped', async () => {
  const t = await readyEditor()

  // The global ask departs after the debounce; the fake sits on its answer for
  // 400ms, long enough for the `(` to land first. The reply then describes the
  // scope before the paren and must not open a menu over the new one.
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
  // Tall: the page windows its rows, and the language-server rows come last.
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
