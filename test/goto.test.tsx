import { expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  fixture,
  launch,
  loadMarketExtensions,
  press,
  pressTimes,
  runCommand,
  spansOf,
  until,
  untilFrame,
} from './helpers'

loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

const LSP_WAIT = 15_000

const intoSpecifier = (t: Parameters<typeof pressTimes>[0]) =>
  pressTimes(t, 10, input => input.pressArrow('right'))

test('the file under the cursor opens, relative specifier and alias alike', async () => {
  const dir = fixture({
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
    'src/a.ts': "import './b'\n",
    'src/b.ts': 'const beta = 2\n',
    'src/aliased.ts': "import '@/deep/c'\n",
    'src/deep/c.ts': 'const gamma = 3\n',
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
  await pressTimes(t, 12, input => input.pressArrow('right'))
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
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, 'Ln 2, Col 7', LSP_WAIT)
}, 30_000)

test('go to definition with LSP off says why nothing happened', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { lsp: false }, {}, { openFile: join(dir, 'a.ts') })

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'LSP is off')
}, 15_000)

test('go to definition scrolls the definition into view', async () => {
  const filler = Array.from({ length: 80 }, (_, i) => `const pad${i} = ${i}`).join('\n')
  const dir = fixture({
    'a.ts': `${filler}\nconst a = beta\n`,
    'def.ts': '// the declaration\nconst beta = 1\n',
  })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  await pressTimes(t, 60, input => input.pressArrow('down'))
  await untilFrame(t, 'const pad59')
  expect(t.captureCharFrame()).not.toContain('const pad0 = 0')

  await runCommand(t, 'Go to definition')
  await untilFrame(t, 'const beta = 1', LSP_WAIT)
  await untilFrame(t, '// the declaration', LSP_WAIT)
}, 30_000)

test('go to line scrolls the line into view', async () => {
  const filler = Array.from({ length: 80 }, (_, i) => `const pad${i} = ${i}`).join('\n')
  const dir = fixture({ 'big.ts': `const target = 0\n${filler}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await pressTimes(t, 60, input => input.pressArrow('down'))
  await untilFrame(t, 'const pad58')
  expect(t.captureCharFrame()).not.toContain('const target = 0')

  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText('1'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'const target = 0')
}, 20_000)

test('go to line from deep in the file replaces what is on screen', async () => {
  const body = Array.from({ length: 120 }, (_, i) => `const line${i} = ${i}`).join('\n')
  const dir = fixture({ 'big.ts': `${body}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText('111'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'const line110 = 110')
  expect(t.captureCharFrame()).not.toContain('const line0 = 0')

  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText('1'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'const line0 = 0')
  expect(t.captureCharFrame()).not.toContain('const line110 = 110')
}, 20_000)

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `const line${i} = ${i}`).join('\n')

const gotoLine = async (t: Awaited<ReturnType<typeof launch>>, line: string) => {
  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText(line))
  await press(t, input => input.pressEnter())
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
  await press(t, input => void input.typeText(query))
}

test('the file picker takes a :line:col suffix and lands on it', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir)

  await pick(t, 'big.ts:111:7')
  expect(t.captureCharFrame()).toContain('at 111:7')
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 111, Col 7')
  expect(t.captureCharFrame()).toContain('const line110 = 110')
}, 20_000)

test('a bare :line in the picker opens at the first column', async () => {
  const dir = fixture({ 'big.ts': `${numbered(200)}\n` })
  const t = await launch(dir)

  await pick(t, 'big.ts:40')
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 40, Col 1')
}, 20_000)

test('a line past the end of the file lands on its last one', async () => {
  const dir = fixture({ 'small.ts': 'const a = 1\nconst b = 2\n' })
  const t = await launch(dir)

  await pick(t, 'small.ts:999')
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 3')
}, 20_000)

test('a jump tints its landing row for a moment', async () => {
  const lines = `${Array.from({ length: 40 }, (_, i) => `const line${i} = ${i}`).join('\n')}\n`
  const dir = fixture({ 'a.ts': lines })
  const t = await launch(dir, {}, { width: 100, height: 24 }, { openFile: join(dir, 'a.ts') })
  await untilFrame(t, 'const line0 = 0')

  await runCommand(t, 'Go to line')
  t.mockInput.typeText('30')
  t.mockInput.pressEnter()
  await untilFrame(t, 'Ln 30, Col 1')
  const bg = (row: string) => spansOf(t, row).find(span => span.text.trim() === 'const')?.bg
  const other = bg('const line31 = 31')
  expect(bg('const line29 = 29')).not.toBe(other)
  await until(t, () => bg('const line29 = 29') === other, 3_000)
}, 15_000)
