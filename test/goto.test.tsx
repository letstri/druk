import { expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  fixture,
  launch,
  loadMarketExtensions,
  openFile,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  servedBy,
  settle,
  spansOf,
  until,
  untilFrame,
  untilGone,
} from './helpers'

loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

const LSP_WAIT = 15_000

const intoSpecifier = (t: Parameters<typeof pressTimes>[0]) =>
  pressTimes(t, 10, (input) => input.pressArrow('right'))

test('the file under the cursor opens, relative specifier and alias alike', async () => {
  const dir = fixture({
    'src/a.ts': "import './b'\n",
    'src/aliased.ts': "import '@/deep/c'\n",
    'src/b.ts': 'const beta = 2\n',
    'src/deep/c.ts': 'const gamma = 3\n',
    'tsconfig.json':
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
  })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'src/a.ts') })

  await intoSpecifier(t)
  await runCommand(t, 'Open file under cursor')
  await untilFrame(t, 'const beta = 2')

  await runCommand(t, 'Open file')
  await untilFrame(t, 'Open file')
  const picker = t.mockInput
  picker.typeText('aliased')
  picker.pressEnter()
  await untilFrame(t, "import '@/deep/c'")
  await pressTimes(t, 12, (input) => input.pressArrow('right'))
  await runCommand(t, 'Open file under cursor')
  await untilFrame(t, 'const gamma = 3')
}, 20_000)

test('a specifier that resolves to nothing says so', async () => {
  const dir = fixture({ 'a.ts': "import './nope'\n" })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'a.ts') })

  await intoSpecifier(t)
  await runCommand(t, 'Open file under cursor')
  await untilFrame(t, 'Cannot find')
}, 15_000)

test('go to definition opens where the server points', async () => {
  const dir = fixture({
    'a.ts': 'const a = beta\n',
    'def.ts': '// the declaration\nconst beta = 1\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, 'Ln 2, Col 7', LSP_WAIT)
}, 30_000)

test('go to definition with LSP off says why nothing happened', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: false },
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'LSP is off')
}, 15_000)

test('go to definition scrolls the definition into view', async () => {
  const filler = Array.from(
    { length: 80 },
    (_, i) => `const pad${i} = ${i}`
  ).join('\n')
  const dir = fixture({
    'a.ts': `${filler}\nconst a = beta\n`,
    'def.ts': '// the declaration\nconst beta = 1\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await pressTimes(t, 60, (input) => input.pressArrow('down'))
  await untilFrame(t, 'const pad59')
  expect(t.captureCharFrame()).not.toContain('const pad0 = 0')

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, '// the declaration', LSP_WAIT)
}, 30_000)

test('go to line scrolls the line into view', async () => {
  const filler = Array.from(
    { length: 80 },
    (_, i) => `const pad${i} = ${i}`
  ).join('\n')
  const dir = fixture({ 'big.ts': `const target = 0\n${filler}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await pressTimes(t, 60, (input) => input.pressArrow('down'))
  await untilFrame(t, 'const pad58')
  expect(t.captureCharFrame()).not.toContain('const target = 0')

  await press(t, (input) => input.pressKey('g', { ctrl: true }))
  await press(t, (input) => input.typeText('1'))
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'const target = 0')
}, 20_000)

test('go to line from deep in the file replaces what is on screen', async () => {
  const body = Array.from(
    { length: 120 },
    (_, i) => `const line${i} = ${i}`
  ).join('\n')
  const dir = fixture({ 'big.ts': `${body}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await press(t, (input) => input.pressKey('g', { ctrl: true }))
  await press(t, (input) => input.typeText('111'))
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'const line110 = 110')
  expect(t.captureCharFrame()).not.toContain('const line0 = 0')

  await press(t, (input) => input.pressKey('g', { ctrl: true }))
  await press(t, (input) => input.typeText('1'))
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'const line0 = 0')
  expect(t.captureCharFrame()).not.toContain('const line110 = 110')
}, 20_000)

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `const line${i} = ${i}`).join('\n')

const gotoLine = async (
  t: Awaited<ReturnType<typeof launch>>,
  line: string
) => {
  await press(t, (input) => input.pressKey('g', { ctrl: true }))
  await press(t, (input) => input.typeText(line))
  await press(t, (input) => input.pressEnter())
}

test('a jump off screen centres the target, with the lines after it drawn', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await gotoLine(t, '111')
  await untilFrame(t, 'const line110 = 110')
  expect(t.captureCharFrame()).toContain('const line116 = 116')
}, 20_000)

test('a jump to a line already drawn leaves the viewport alone', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await gotoLine(t, '100')
  await untilFrame(t, 'const line99 = 99')
  const top = 'const line91 = 91'
  expect(t.captureCharFrame()).toContain(top)

  await gotoLine(t, '104')
  await untilFrame(t, 'Ln 104')
  expect(t.captureCharFrame()).toContain(top)
}, 20_000)

const pick = async (t: Awaited<ReturnType<typeof launch>>, query: string) => {
  await runCommand(t, 'Open file…')
  await untilFrame(t, 'Open file')
  await press(t, (input) => input.typeText(query))
}

test('the file picker takes a :line:col suffix and lands on it', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir)

  await pick(t, 'big.ts:111:7')
  expect(t.captureCharFrame()).toContain('at 111:7')
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 111, Col 7')
  expect(t.captureCharFrame()).toContain('const line110 = 110')
}, 20_000)

test('a bare :line in the picker opens at the first column', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir)

  await pick(t, 'big.ts:40')
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 40, Col 1')
}, 20_000)

test('a line past the end of the file lands on its last one', async () => {
  const dir = fixture({ 'small.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(dir)

  await pick(t, 'small.ts:999')
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 3')
}, 20_000)

test('a jump tints its landing row for a moment', async () => {
  const lines = `${Array.from({ length: 40 }, (_, i) => `const line${i} = ${i}`).join('\n')}\n`
  const dir = fixture({ 'a.ts': lines })
  const t = await launch(
    dir,
    {},
    { height: 24, width: 100 },
    { openFile: join(dir, 'a.ts') }
  )
  await untilFrame(t, 'const line0 = 0')

  await runCommand(t, 'Go to line')
  t.mockInput.typeText('30')
  t.mockInput.pressEnter()
  await untilFrame(t, 'Ln 30, Col 1')
  const bg = (row: string) =>
    spansOf(t, row).find((span) => span.text.trim() === 'const')?.bg
  const other = bg('const line31 = 31')
  expect(bg('const line29 = 29')).not.toBe(other)
  await until(t, () => bg('const line29 = 29') === other, 3000)
}, 15_000)

test('find references lists every hit and opens the chosen one', async () => {
  const dir = fixture({
    'a.ts': 'const a = beta\n',
    'use.ts': '// first\nconst again = beta\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await runCommand(t, 'Find references')
  await untilFrame(t, 'const again = beta', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('use.ts:2')

  await pressTimes(t, 1, (input) => input.pressArrow('down'))
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 2, Col 1', LSP_WAIT)
}, 30_000)

test('implementation and type definition jump straight there', async () => {
  const dir = fixture({
    'a.ts': 'const a = beta\n',
    'def.ts': '// the declaration\nconst beta = 1\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await runCommand(t, 'Go to implementation')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, 'Ln 2, Col 7', LSP_WAIT)

  await runCommand(t, 'Go back')
  await untilFrame(t, 'Ln 1, Col 1', LSP_WAIT)
  await runCommand(t, 'Go to type definition')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, 'Ln 2, Col 7', LSP_WAIT)
}, 30_000)

test('symbols in the file and in the project reach their line', async () => {
  const dir = fixture({
    'a.ts': 'class Bell {\n  ring() {}\n}\n',
    'def.ts': '// the declaration\nconst beta = 1\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    {},
    { openFile: join(dir, 'a.ts') }
  )

  await runCommand(t, 'Go to symbol in file')
  await untilFrame(t, 'Bell.ring', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('method')
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 1, Col 7', LSP_WAIT)

  await runCommand(t, 'Go to symbol in project')
  await untilFrame(t, 'Workspace symbol', LSP_WAIT)
  await press(t, (input) => input.typeText('beta'))
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'def.beta', LSP_WAIT)
  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
}, 40_000)

test('the call peek opens over the line with code beside the calls', async () => {
  const dir = fixture({
    'a.ts': 'function beta() {\n  return 1\n}\n',
    'def.ts': '// the declaration\nconst beta = 1\n',
    'use.ts': '// first\nconst again = beta()\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    { height: 28, width: 100 },
    // kitty, so the chord arrives as one key rather than as an escape and a control byte.
    { kittyKeyboard: true, openFile: join(dir, 'a.ts') }
  )

  // The chord, not the palette: Ctrl+Opt+H is the whole point of the peek.
  await press(t, (input) => input.pressKey('h', { ctrl: true, meta: true }))
  await untilFrame(t, 'Calls · beta', LSP_WAIT)

  // One list, both ways: the caller and the callee, told apart by their arrows.
  await untilFrame(t, 'caller', LSP_WAIT)
  const frame = t.captureCharFrame()
  expect(frame).toContain('callee')
  expect(frame).toContain('use.ts:2')
  expect(frame).toContain('def.ts:2')
  // The symbol itself is row 0 and starts selected, so where it is declared is what shows first.
  expect(frame).toContain('a.ts:1')
  expect(frame).toContain('return 1')
  // The line that asked is still above the peek, and the caret never moved.
  expect(frame).toContain('Ln 1, Col 1')
  // Direct calls only: a caller's own callers are how a peek ends up at the entry point.
  expect(frame.split('\n').filter((row) => row.includes('.ts:'))).toHaveLength(
    3
  )

  // Walking the list repaints the code beside it.
  await press(t, (input) => input.pressArrow('down'))
  await untilFrame(t, 'const again = beta()', LSP_WAIT)
  await press(t, (input) => input.pressArrow('down'))
  await untilFrame(t, 'const beta = 1', LSP_WAIT)

  await press(t, (input) => input.pressEnter())
  await untilFrame(t, 'Ln 2, Col 1', LSP_WAIT)
  expect(t.captureCharFrame()).not.toContain('Calls · beta')
}, 40_000)

test('the peek opens on the row for the line it was asked from', async () => {
  const dir = fixture({
    'a.ts': 'function beta() {\n  return 1\n}\n',
    'def.ts': '// the declaration\nconst beta = 1\n',
    'use.ts': '// first\nconst again = beta()\n',
  })
  const t = await launch(
    dir,
    servedBy(process.execPath, FAKE),
    { height: 26, width: 100 },
    { kittyKeyboard: true, openFile: join(dir, 'use.ts') }
  )
  // Onto the call site, which is a row of the peek in its own right.
  await press(t, (input) => input.pressArrow('down'))
  await untilFrame(t, 'Ln 2, Col 1')

  await runCommand(t, 'Peek calls')
  await untilFrame(t, 'Calls · beta', LSP_WAIT)
  await untilFrame(t, 'caller', LSP_WAIT)

  // Enter takes the selected row: this line's, not the declaration the list starts with.
  await press(t, (input) => input.pressEnter())
  await settle(t, 200)
  const frame = t.captureCharFrame()
  expect(frame).toContain('Ln 2, Col 1')
  expect(frame).not.toContain('function beta() {')
}, 30_000)

// Opened through the picker, so the sidebar is up: with one, Esc is the tree's key, and the
// editor is unfocused before it ever sees the press.
test('escape shuts the peek with the sidebar open', async () => {
  const dir = fixture({ 'a.ts': 'function beta() {}\n', 'use.ts': 'beta()\n' })
  const t = await launch(dir, servedBy(process.execPath, FAKE), {
    height: 28,
    width: 100,
  })
  await openFile(t, 'a.ts')
  await untilFrame(t, 'EXPLORER')

  await runCommand(t, 'Peek calls')
  await untilFrame(t, 'Calls · beta', LSP_WAIT)
  await pressEscape(t)
  await untilGone(t, 'Calls · beta')
  expect(t.captureCharFrame()).toContain('function beta() {}')
  // The keyboard stayed in the editor: Esc shut the peek rather than jumping to the tree.
  await press(t, (input) => input.typeText('x'))
  await untilFrame(t, 'xfunction beta() {}')
}, 30_000)
