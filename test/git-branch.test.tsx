import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { listBranches } from '../src/core/git'
import {
  fixture,
  launch,
  press,
  pressEscape,
  runCommand,
  settle,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

function repo(...branches: string[]) {
  const dir = tempDir('druk-branch-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  writeFileSync(join(dir, 'a.ts'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  for (const name of branches) {
    git('branch', name)
  }
  return dir
}

const head = (dir: string) =>
  execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    .toString()
    .trim()
const branchNames = (dir: string) =>
  execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: dir })
    .toString()
    .split('\n')
    .filter(Boolean)

async function until(t: Harness, cond: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) {
    await settle(t, 25)
  }
  expect(cond()).toBe(true)
}

test('listBranches marks the current branch and reads upstreams', () => {
  const dir = repo('feature')
  expect(listBranches(dir).map((b) => [b.name, b.current, b.remote])).toEqual(
    expect.arrayContaining([
      ['main', true, false],
      ['feature', false, false],
    ])
  )

  const bare = tempDir('druk-bare-')
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir })
  execFileSync('git', ['push', '-q', '--set-upstream', 'origin', 'main'], {
    cwd: dir,
  })

  const after = listBranches(dir)
  expect(after.find((b) => b.name === 'main')?.upstream).toBe('origin/main')
  expect(after.find((b) => b.name === 'origin/main')?.remote).toBe(true)
  expect(after.some((b) => b.name.endsWith('/HEAD'))).toBe(false)
})

test('switch branch lists the others and checks the picked one out', async () => {
  const dir = repo('feature')

  const t = await launch(dir)
  await runCommand(t, 'Switch branch')
  const picker = t.captureCharFrame()
  expect(picker).toContain('Switch to branch — 1')
  expect(picker).toContain('feature')

  await press(t, (i) => i.pressEnter())
  await until(t, () => head(dir) === 'feature')
}, 20_000)

test('b in the source-control panel opens the branch picker', async () => {
  const dir = repo('feature')

  const t = await launch(dir)
  await runCommand(t, 'Source control')
  await press(t, (i) => i.typeText('b'))
  expect(t.captureCharFrame()).toContain('Switch to branch')
}, 20_000)

test('new branch prompts for a name and lands on it', async () => {
  const dir = repo()

  const t = await launch(dir)
  await runCommand(t, 'New branch…')
  expect(t.captureCharFrame()).toContain('New branch name')
  await press(t, (i) => i.typeText('spike'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => head(dir) === 'spike')
}, 20_000)

test('new branch from names its start point and branches off it', async () => {
  const dir = repo('feature')
  execFileSync('git', ['checkout', '-q', 'feature'], { cwd: dir })
  writeFileSync(join(dir, 'b.ts'), 'only on feature\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], { cwd: dir })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir })

  const t = await launch(dir)
  await runCommand(t, 'New branch from')
  await press(t, (i) => i.typeText('feature'))
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).toContain('New branch from feature')

  await press(t, (i) => i.typeText('spike'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => head(dir) === 'spike')
  await until(
    t,
    () => readFileSync(join(dir, 'b.ts'), 'utf-8') === 'only on feature\n'
  )
}, 20_000)

test('rename branch starts from the current name', async () => {
  const dir = repo('feature')

  const t = await launch(dir)
  await runCommand(t, 'Rename branch')
  await press(t, (i) => i.typeText('feature'))
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Rename branch to')

  await press(t, (i) => i.typeText('-2'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => branchNames(dir).includes('feature-2'))
  expect(branchNames(dir)).not.toContain('feature')
}, 20_000)

test('delete branch asks first, and force is offered for unmerged work', async () => {
  const dir = repo()
  execFileSync('git', ['checkout', '-q', '-b', 'stray'], { cwd: dir })
  writeFileSync(join(dir, 'b.ts'), 'unmerged\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'stray work'], { cwd: dir })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir })

  const t = await launch(dir)
  await runCommand(t, 'Delete branch…')
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Delete "stray"')
  await press(t, (i) => i.pressEnter())

  await until(t, () => t.captureCharFrame().includes('unmerged commits'))
  expect(branchNames(dir)).toContain('stray')

  await runCommand(t, 'Delete branch (force)')
  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressEnter())
  await until(t, () => !branchNames(dir).includes('stray'))
}, 20_000)

test('merge brings the other branch into this one', async () => {
  const dir = repo()
  execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir })
  writeFileSync(join(dir, 'b.ts'), 'from feature\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], { cwd: dir })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir })

  const t = await launch(dir)
  await runCommand(t, 'Merge branch')
  await press(t, (i) => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Merge "feature"')
  await press(t, (i) => i.pressEnter())

  await until(t, () => {
    try {
      return readFileSync(join(dir, 'b.ts'), 'utf-8') === 'from feature\n'
    } catch {
      return false
    }
  })
  expect(head(dir)).toBe('main')
}, 20_000)

test('a picker with nothing to offer says so instead of opening empty', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Switch branch')
  expect(t.captureCharFrame()).toContain('No other branch to switch to')
  expect(t.captureCharFrame()).not.toContain('Switch to branch')
}, 20_000)

test('outside a repository the branch commands refuse with a warning', async () => {
  const t = await launch(fixture({ 'a.ts': 'x\n' }))
  await runCommand(t, 'Switch branch')
  expect(t.captureCharFrame()).toContain('Not a git repository')
  await runCommand(t, 'New branch…')
  expect(t.captureCharFrame()).toContain('Not a git repository')
}, 20_000)

test('Esc closes the branch picker without touching the repository', async () => {
  const dir = repo('feature')

  const t = await launch(dir)
  await runCommand(t, 'Switch branch')
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('Switch to branch')
  expect(head(dir)).toBe('main')
}, 20_000)

test('a blocked switch offers to take the changes along', async () => {
  const dir = repo()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(dir, 'a.ts'), 'from feature\n')
  git('commit', '-q', '-am', 'feature')
  git('checkout', '-q', 'main')
  writeFileSync(join(dir, 'a.ts'), 'mine\n')

  const t = await launch(dir)
  await runCommand(t, 'Switch branch')
  await press(t, (i) => i.pressEnter())
  await until(t, () => t.captureCharFrame().includes('Switch blocked'))
  expect(head(dir)).toBe('main')

  await press(t, (i) => i.pressEnter())
  await until(t, () => head(dir) === 'feature')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('mine')
}, 20_000)

test('declining a blocked switch leaves the branch and the changes alone', async () => {
  const dir = repo()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(dir, 'a.ts'), 'from feature\n')
  git('commit', '-q', '-am', 'feature')
  git('checkout', '-q', 'main')
  writeFileSync(join(dir, 'a.ts'), 'mine\n')

  const t = await launch(dir)
  await runCommand(t, 'Switch branch')
  await press(t, (i) => i.pressEnter())
  await until(t, () => t.captureCharFrame().includes('Switch blocked'))
  await pressEscape(t)

  expect(t.captureCharFrame()).toContain('this would overwrite them')
  expect(head(dir)).toBe('main')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('mine\n')
}, 20_000)
