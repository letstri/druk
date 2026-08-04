import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, openComparison, press, pressTimes, runCommand, untilFrame } from './helpers'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-compare-ui-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'trunk')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'init.defaultBranch', 'trunk')
  writeFileSync(join(dir, 'auth.ts'), 'export const auth = false\n')
  git('add', '.')
  git('commit', '-q', '-m', 'seed')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'auth.ts'), 'export const auth = true\n')
  writeFileSync(join(dir, 'session.ts'), 'export const session = true\n')
  git('add', '.')
  git('commit', '-q', '-m', 'add authentication')
  return { dir, git }
}

test('B enters comparison with the default base and feature summary', async () => {
  const { dir } = repo()
  const t = await launch(dir)

  await openComparison(t)
  await untilFrame(t, '2 files')

  const frame = t.captureCharFrame()
  expect(frame).toContain('feature')
  expect(frame).toContain('compare')
  expect(frame).toContain('base  trunk')
  expect(frame).toContain('↑1')
  expect(frame).toContain('2 files')
  expect(frame).toContain('+2 −1')
  expect(frame).toContain('auth.ts')
  expect(frame).toContain('session.ts')
})

test('B in comparison opens the fuzzy base picker', async () => {
  const { dir, git } = repo()
  git('branch', 'develop', 'trunk')
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')

  await press(t, input => input.pressKey('b', { shift: true }))
  await untilFrame(t, 'Compare against branch')
  await press(t, input => void input.typeText('develop'))
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'base  develop')

  expect(t.captureCharFrame()).toContain('2 files')
})

test('lowercase b keeps branch switching available inside comparison', async () => {
  const { dir } = repo()
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')

  await press(t, input => input.pressKey('b'))
  await untilFrame(t, 'Switch to branch')

  expect(t.captureCharFrame()).toContain('trunk')
})

test('/ filters comparison files without another Git selection', async () => {
  const { dir } = repo()
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')

  await press(t, input => input.pressKey('/'))
  await untilFrame(t, 'Filter comparison')
  await press(t, input => void input.typeText('session'))
  await press(t, input => input.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('session.ts')
  expect(frame).not.toContain('auth.ts')
})

test('Enter opens a lazy file diff and d switches its layout', async () => {
  const { dir } = repo()
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')

  await press(t, input => input.pressEnter())
  await press(t, input => input.pressTab())
  await untilFrame(t, '+ export const auth = true')
  expect(t.captureCharFrame()).toContain('- export const auth = false')

  await press(t, input => input.pressKey('d'))
  expect(t.captureCharFrame()).toContain('side-by-side')
})

test('commit mode opens metadata, changed files and the first file diff', async () => {
  const { dir } = repo()
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')

  await press(t, input => input.pressKey('c'))
  expect(t.captureCharFrame()).toContain('add authentication')
  await press(t, input => input.pressEnter())
  await untilFrame(t, '+ export const auth = true')
  await press(t, input => input.pressTab())

  const frame = t.captureCharFrame()
  expect(frame).toContain('add authentication')
  expect(frame).toContain('Test <test@example.com>')
  expect(frame).toContain('2 files')

  // ←→ page through the commit's files; ↑↓ stay the diff's own scroll.
  await press(t, input => input.pressArrow('right'))
  await untilFrame(t, '+ export const session = true')
  expect(t.captureCharFrame()).toContain('session.ts')
})

test('Esc closes detail before leaving comparison', async () => {
  const { dir } = repo()
  const t = await launch(dir)
  await openComparison(t)
  await untilFrame(t, '2 files')
  await press(t, input => input.pressEnter())
  await press(t, input => input.pressTab())
  await untilFrame(t, '+ export const auth = true')

  t.mockInput.pressEscape()
  await new Promise(resolve => setTimeout(resolve, 60))
  await untilFrame(t, '[Files]')
  expect(t.captureCharFrame()).toContain('compare')

  t.mockInput.pressEscape()
  await new Promise(resolve => setTimeout(resolve, 60))
  await untilFrame(t, '◆ review')
  expect(t.captureCharFrame()).not.toContain('base  trunk')
})

test('the command palette opens Source Control directly in comparison mode', async () => {
  const { dir } = repo()
  const t = await launch(dir)

  await runCommand(t, 'Compare branches')
  await untilFrame(t, 'base  trunk')

  expect(t.captureCharFrame()).toContain('2 files')
})

test('a branch with no introduced work has a clean comparison state', async () => {
  const { dir } = repo()
  execFileSync('git', ['config', 'init.defaultBranch', 'feature'], { cwd: dir })
  const t = await launch(dir)

  await openComparison(t)
  await untilFrame(t, 'no differences')

  expect(t.captureCharFrame()).toContain('0 files')
})

test('a long comparison windows its rows as the cursor moves', async () => {
  const { dir, git } = repo()
  for (let index = 0; index < 40; index++) {
    writeFileSync(join(dir, `file-${index.toString().padStart(2, '0')}.ts`), `${index}\n`)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'many files')
  const t = await launch(dir, {}, { height: 20 })

  await openComparison(t)
  await untilFrame(t, '42 files')
  await pressTimes(t, 25, input => input.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('file-24.ts')
  expect(frame).not.toContain('auth.ts')
})

test('binary, deleted and renamed rows retain their comparison status', async () => {
  const { dir, git } = repo()
  git('switch', '-q', 'trunk')
  writeFileSync(join(dir, 'deleted.txt'), 'remove me\n')
  const oldName = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n'
  writeFileSync(join(dir, 'old-name.txt'), oldName)
  git('add', '.')
  git('commit', '-q', '-m', 'more base files')
  git('branch', '-f', 'feature', 'trunk')
  git('switch', '-q', 'feature')
  execFileSync('git', ['rm', '-q', 'deleted.txt'], { cwd: dir })
  git('mv', 'old-name.txt', 'new-name.txt')
  writeFileSync(join(dir, 'new-name.txt'), oldName.replace('one', 'ONE'))
  writeFileSync(join(dir, 'binary.bin'), new Uint8Array([0, 1, 2]))
  git('add', '-A')
  git('commit', '-q', '-m', 'mixed statuses')
  const t = await launch(dir)

  await openComparison(t)
  await untilFrame(t, '3 files')
  const frame = t.captureCharFrame()
  expect(frame).toContain('binary.bin')
  expect(frame).toContain('binary A')
  expect(frame).toContain('deleted.txt')
  expect(frame).toContain('D ')
  expect(frame).toContain('new-name.txt')
  expect(frame).toContain('R ')

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Binary file')
  expect(t.captureCharFrame()).toContain('textual diff is not available')
})
