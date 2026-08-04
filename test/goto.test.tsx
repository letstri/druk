import { expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  fixture,
  launch,
  loadMarketExtensions,
  press,
  pressTimes,
  runCommand,
  untilFrame,
} from './helpers'

// druk ships no language servers: the specs these tests override live in the
// market, so the extension that carries them has to be registered first.
loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** A definition answer crosses a process boundary; give the fake server room. */
const LSP_WAIT = 15_000

/** Put the cursor inside the specifier of `import './b'` on the first line. */
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

  // The alias goes through the project's own tsconfig, which is the case a
  // plain path join cannot answer.
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
  // The fake answers with a LocationLink whose selection range is line 2,
  // col 7 — the name, not the comment the declaration range starts at.
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
