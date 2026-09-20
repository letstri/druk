import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ALT } from '../src/ui/keys'
import { fixture, launch, openFile, press, pressTimes, runCommand, settle, until } from './helpers'

const FILE = [
  'function outer() {',
  '  const secret = 1',
  '  return secret',
  '}',
  '',
  'const after = 2',
  '',
].join('\n')

test('folding hides the block and says how much it took', async () => {
  const dir = fixture({ 'a.ts': FILE })
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  expect(t.captureCharFrame()).toContain('const secret = 1')

  await runCommand(t, 'Fold block at cursor')
  const folded = t.captureCharFrame()
  expect(folded).not.toContain('const secret = 1')
  expect(folded).not.toContain('return secret')
  expect(folded).toContain('function outer() {')
  expect(folded).toContain('⋯ 2 lines')
  expect(folded).toMatch(/4\s+\}/)
  expect(folded).toMatch(/6\s+const after = 2/)

  expect(folded).toContain(`⋯ 2 lines Ctrl+${ALT}+E`)

  await runCommand(t, 'Unfold block at cursor')
  expect(t.captureCharFrame()).toContain('const secret = 1')
})

test('a fold never reaches the file, however the buffer is edited', async () => {
  const dir = fixture({ 'a.ts': FILE })
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  await runCommand(t, 'Fold block at cursor')

  await pressTimes(t, 5, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('const tail = 3'))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)

  const saved = readFileSync(join(dir, 'a.ts'), 'utf8')
  expect(saved).toContain('const secret = 1')
  expect(saved).toContain('return secret')
  expect(saved).toContain('const tail = 3')
  expect(saved.startsWith('function outer() {\n  const secret = 1')).toBe(true)
})

test('typing on a folded line opens the block rather than editing past it', async () => {
  const dir = fixture({ 'a.ts': FILE })
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  await runCommand(t, 'Fold block at cursor')
  expect(t.captureCharFrame()).not.toContain('const secret = 1')

  await press(t, i => void i.typeText(' '))
  const frame = t.captureCharFrame()
  expect(frame).toContain('const secret = 1')
  expect(frame).not.toContain('⋯')

  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)
  const saved = readFileSync(join(dir, 'a.ts'), 'utf8')
  expect(saved.split('\n')[1]).toBe('  const secret = 1')
})

test('every foldable block carries a marker, and clicking it toggles the block', async () => {
  const dir = fixture({ 'a.ts': FILE })
  const t = await launch(dir)
  await openFile(t, 'a.ts')

  const rows = t.captureCharFrame().split('\n')
  const y = rows.findIndex(row => row.includes('▾'))
  expect(y).toBeGreaterThan(-1)
  expect(rows[y]).toMatch(/1▾ function outer\(\) \{/)
  expect(rows.filter(row => row.includes('▾'))).toHaveLength(1)

  const x = rows[y]!.indexOf('▾')
  await press(t, () => void t.mockMouse.click(x, y))
  await until(t, () => t.captureCharFrame().includes('⋯ 2 lines'))
  expect(t.captureCharFrame()).not.toContain('const secret = 1')
  expect(t.captureCharFrame()).toContain('▸ function outer() {')

  await press(t, () => void t.mockMouse.click(x, y))
  await until(t, () => t.captureCharFrame().includes('const secret = 1'))
})

test('folding leaves the view where it was', async () => {
  const lines = Array.from({ length: 200 }, (_, index) =>
    index % 40 === 0 ? `function f${index}() {` : `  const x${index} = ${index}`,
  )
  const dir = fixture({ 'big.ts': `${lines.join('\n')}\n` })
  const t = await launch(dir, {}, {}, { openFile: join(dir, 'big.ts') })

  await pressTimes(t, 50, i => i.pressArrow('down'))
  await settle(t)
  const topRow = (): string | undefined =>
    t
      .captureCharFrame()
      .split('\n')
      .find(row => /const x|function f/.test(row))
  const before = topRow()
  expect(before).toContain('const x36 = 36')

  await runCommand(t, 'Fold block at cursor')
  expect(topRow()).toBe(before)
  await runCommand(t, 'Unfold block at cursor')
  expect(topRow()).toBe(before)
})

test('a file with nothing to fold keeps the gutter it always had', async () => {
  const dir = fixture({ 'flat.txt': 'one\ntwo\nthree\n' })
  const t = await launch(dir)
  await openFile(t, 'flat.txt')

  const frame = t.captureCharFrame()
  expect(frame).not.toContain('▾')
  expect(frame).toContain('1 one')
})

test('fold everything closes every block, and unfold everything opens them', async () => {
  const dir = fixture({ 'a.ts': FILE })
  const t = await launch(dir)
  await openFile(t, 'a.ts')

  await runCommand(t, 'Fold everything')
  expect(t.captureCharFrame()).not.toContain('return secret')

  await runCommand(t, 'Unfold everything')
  expect(t.captureCharFrame()).toContain('return secret')
})
