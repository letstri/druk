import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { worktrees } from '../src/core/git'
import { resolvedPath, workspaceEntries, worktreePath } from '../src/core/workspaces'
import { fixture, launch, openFile, press, runCommand, settle, until, untilFrame } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

// Both inside one registered temp directory, or the checkout outlives the sweep.
function repoWithWorktree(branch: string) {
  const base = tempDir('druk-ws-')
  const main = join(base, 'main')
  const side = join(base, 'side')
  mkdirSync(main, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: main })
  initRepo(main)
  writeFileSync(join(main, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('worktree', 'add', '-q', '-b', branch, side)
  return { main, side }
}

// The Opt modifier is an ESC prefix ahead of the Ctrl byte.
const ctrlOpt = (letter: string) =>
  `${String.fromCharCode(27)}${String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)}`

async function openFolder(t: Harness, dir: string) {
  await runCommand(t, 'Open folder')
  await press(t, input => void input.typeText(dir))
  await press(t, input => input.pressEnter())
}

test('opens another folder as the workspace', async () => {
  const here = fixture({ 'alpha.ts': 'const alpha = 1\n' })
  const there = fixture({ 'beta.ts': 'const beta = 2\n' })
  const t = await launch(here)
  expect(t.captureCharFrame()).toContain('alpha.ts')

  await openFolder(t, there)

  await untilFrame(t, 'beta.ts')
  expect(t.captureCharFrame()).not.toContain('alpha.ts')
})

test('a folder that is not there is refused, and the workspace stays', async () => {
  const here = fixture({ 'alpha.ts': 'const alpha = 1\n' })
  const t = await launch(here)

  await openFolder(t, join(here, 'nope'))

  await untilFrame(t, 'Not a folder')
  expect(t.captureCharFrame()).toContain('alpha.ts')
})

test('unsaved edits stop the switch until the confirm is answered', async () => {
  const here = fixture({ 'alpha.ts': 'const alpha = 1\n' })
  const there = fixture({ 'beta.ts': 'const beta = 2\n' })
  const t = await launch(here)
  await openFile(t, 'alpha.ts')
  await press(t, input => void input.typeText('x'))

  await openFolder(t, there)
  await untilFrame(t, 'switch without saving')
  expect(t.captureCharFrame()).not.toContain('beta.ts')

  await press(t, input => input.pressEnter())
  await untilFrame(t, 'beta.ts')
})

test('the switcher lists the repository worktrees and where you are', async () => {
  const { main } = repoWithWorktree('feat')

  const t = await launch(main, {}, { width: 120 })
  await runCommand(t, 'Switch workspace')
  await settle(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('Switch workspace')
  expect(frame).toContain('side')
  expect(frame).toContain('feat')
  expect(frame).toContain('current')
})

test('Ctrl+Opt+W opens the switcher', async () => {
  const t = await launch(fixture({ 'alpha.ts': 'const alpha = 1\n' }))

  await press(t, input => void input.pressKeys([ctrlOpt('w')]))

  expect(t.captureCharFrame()).toContain('Switch workspace')
})

test('a folder opened before is offered again by the switcher', async () => {
  const here = fixture({ 'alpha.ts': 'const alpha = 1\n' })
  const there = fixture({ 'beta.ts': 'const beta = 2\n' })
  const t = await launch(here, {}, { width: 120 })
  await openFolder(t, there)
  await untilFrame(t, 'beta.ts')

  await runCommand(t, 'Switch workspace')
  await untilFrame(t, basename(here))
})

test('the saved tabs of a folder come back when it is opened again', async () => {
  const here = fixture({ 'alpha.ts': 'const alpha = 1\n' })
  const there = fixture({ 'beta.ts': 'const beta = 2\n' })
  const t = await launch(here)
  await openFile(t, 'alpha.ts')
  await untilFrame(t, 'const alpha = 1')

  await openFolder(t, there)
  await untilFrame(t, 'beta.ts')
  await openFolder(t, here)

  await untilFrame(t, 'const alpha = 1')
})

test('worktrees reads the porcelain, slashed branch names included', () => {
  const { main } = repoWithWorktree('feat/one')

  const found = worktrees(main)
  expect(found.map(tree => tree.branch)).toEqual(['main', 'feat/one'])
  expect(found[1]!.path.endsWith('side')).toBe(true)
})

test('a long project name stays on its one header row', async () => {
  const base = fixture({})
  const long = join(
    base,
    'A-FOLDER-NAMED-after-the-whole-issue-title-it-was-opened-for-and-then-some-more',
  )
  mkdirSync(long)
  writeFileSync(join(long, 'alpha.ts'), '')
  const t = await launch(long, {}, { width: 60 })

  const lines = t.captureCharFrame().split('\n')
  expect(lines[1]).toContain('EXPLORER')
  expect(lines[2]).toContain('A-FOLDER-NAMED')
  expect(lines[3]).toContain('alpha.ts')
})

test('the open folder heads the list even when git has never heard of it', () => {
  const plain = fixture({ 'a.ts': '' })
  const entries = workspaceEntries(plain, [])
  expect(entries[0]!.current).toBe(true)
  expect(entries[0]!.path).toBe(resolvedPath(plain))
})

test('worktreePath puts a new checkout beside the repository, slashes flattened', () => {
  expect(worktreePath('/tmp/proj', 'feat/one')).toBe(join('/tmp', 'proj-feat-one'))
})

test('a new worktree is created and opened, and the branch comes with it', async () => {
  const { main } = repoWithWorktree('feat')
  const t = await launch(main, {}, { width: 120 })

  await runCommand(t, 'New worktree')
  await press(t, input => void input.typeText('spike'))
  await press(t, input => input.pressEnter())

  const at = worktreePath(resolvedPath(main), 'spike')
  await until(t, () => existsSync(join(at, 'a.ts')))
  await untilFrame(t, basename(at))
})

test('the worktree switcher lists the other checkouts, not the one you are in', async () => {
  const { main } = repoWithWorktree('feat')
  const t = await launch(main, {}, { width: 120 })

  await runCommand(t, 'Switch worktree')
  await settle(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('Switch worktree — 1')
  expect(frame).toContain('feat')
})

test('removing a worktree confirms first, then deletes the checkout', async () => {
  const { main, side } = repoWithWorktree('feat')
  const t = await launch(main, {}, { width: 120 })

  await runCommand(t, 'Remove worktree')
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'remove it')

  await press(t, input => input.pressEnter())
  await until(t, () => !existsSync(side))
})
