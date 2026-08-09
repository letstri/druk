import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { fixture, launch, loadMarketExtensions, openFile, press, until } from './helpers'

// The fake server is declared by the market's typescript extension, whose spec
// the `lspServers` override replaces.
loadMarketExtensions()

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** Diagnostics cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

const tabRow = (t: Awaited<ReturnType<typeof launch>>) => t.captureCharFrame().split('\n')[0]!

const withFake = (dir: string) =>
  launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE], eslint: [], oxlint: [] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

test('a tab wears the mark of its file worst diagnostic', async () => {
  const t = await withFake(fixture({ 'a.ts': 'const a = 1\n' }))

  await press(t, input => void input.typeText('nag'))
  await until(t, () => tabRow(t).includes('▲ a.ts'), LSP_WAIT)

  // An error outranks the warning already there: one mark per tab, the worst.
  await press(t, input => void input.typeText('oops'))
  await until(t, () => tabRow(t).includes('● a.ts'), LSP_WAIT)
}, 30000)

test('the mark goes when the diagnostics do', async () => {
  const t = await withFake(fixture({ 'a.ts': 'const a = 1\n' }))

  await press(t, input => void input.typeText('oops'))
  await until(t, () => tabRow(t).includes('● a.ts'), LSP_WAIT)

  for (let at = 0; at < 4; at++) await press(t, input => input.pressBackspace())
  await until(t, () => !tabRow(t).includes('● a.ts'), LSP_WAIT)
  expect(tabRow(t)).toContain('a.ts')
}, 30000)

test('a modified tab is marked, and unmarked once it is saved', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'a.ts') })

  await press(t, input => void input.typeText('x'))
  expect(tabRow(t)).toContain('a.ts ●')

  await press(t, input => input.pressKey('s', { ctrl: true }))
  await until(t, () => !tabRow(t).includes('a.ts ●'))
})

test('the file icon reaches the tab only when tabIcons is on', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })

  const off = await launch(dir, { iconTheme: 'unicode' })
  await openFile(off, 'a.ts')
  expect(tabRow(off)).toContain('a.ts')
  expect(tabRow(off)).not.toContain('◆ a.ts')

  const on = await launch(dir, { iconTheme: 'unicode', tabIcons: true })
  await openFile(on, 'a.ts')
  expect(tabRow(on)).toContain('◆ a.ts')
})

test('an icon theme of none leaves the tab bare whatever tabIcons says', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { tabIcons: true })
  await openFile(t, 'a.ts')
  expect(tabRow(t)).toContain('a.ts')
  expect(tabRow(t)).not.toContain('◆')
})
