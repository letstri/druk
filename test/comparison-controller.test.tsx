import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRoot } from 'solid-js'

import { createComparison } from '../src/app/comparison'
import { createGit } from '../src/app/git'
import { createStatus } from '../src/app/status'
import { tempDir } from './temp'

function repo() {
  const dir = tempDir('druk-controller-')
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'trunk')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'init.defaultBranch', 'trunk')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  git('add', '.')
  git('commit', '-q', '-m', 'seed')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'auth.ts'), 'export const auth = true\n')
  writeFileSync(join(dir, 'other.ts'), 'export const other = true\n')
  git('add', '.')
  git('commit', '-q', '-m', 'add authentication')
  return { dir, git }
}

async function until(condition: () => boolean, timeout = 4000) {
  const started = Date.now()
  while (!condition() && Date.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(condition()).toBe(true)
}

test('controller loads, filters and keeps independent file and commit cursors', async () => {
  const { dir } = repo()
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()
  expect(root.comparison.active()).toBe(true)
  expect(root.comparison.state()).toBe('loading')
  await until(() => root.comparison.state() === 'ready')
  expect(root.comparison.result()).toMatchObject({
    base: { name: 'trunk' },
    compare: { name: 'feature' },
  })
  expect(root.comparison.filteredFiles()).toHaveLength(2)

  root.comparison.setFilter('auth')
  expect(root.comparison.filteredFiles().map(file => file.path)).toEqual(['auth.ts'])
  root.comparison.move(4)
  expect(root.comparison.fileCursor()).toBe(0)

  root.comparison.setFilter('')
  root.comparison.move(1)
  expect(root.comparison.fileCursor()).toBe(1)
  root.comparison.toggleMode()
  expect(root.comparison.mode()).toBe('commits')
  expect(root.comparison.commitCursor()).toBe(0)
  root.comparison.toggleMode()
  expect(root.comparison.fileCursor()).toBe(1)
  root.dispose()
})

test('controller changes base through the existing branch model', async () => {
  const { dir, git: runGit } = repo()
  runGit('branch', 'develop', 'trunk')
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()
  await until(() => root.comparison.state() === 'ready')
  root.comparison.openBasePicker()
  const develop = root.comparison.basePick()?.find(branch => branch.name === 'develop')
  expect(develop).toBeDefined()
  root.comparison.chooseBase(develop!)
  await until(
    () => root.comparison.state() === 'ready' && root.comparison.result()?.base.name === 'develop',
  )
  expect(root.comparison.basePick()).toBeNull()
  root.dispose()
})

test('controller lazily opens selected file content and closes detail first', async () => {
  const { dir } = repo()
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()
  await until(() => root.comparison.state() === 'ready')
  expect(root.comparison.selectedContent()).toBeNull()
  root.comparison.openSelection()
  await until(() => root.comparison.selectedContent() !== null)
  expect(root.comparison.selectedContent()).toMatchObject({
    binary: false,
    newText: 'export const auth = true\n',
  })
  root.comparison.closeDetail()
  expect(root.comparison.selectedFile()).toBeNull()
  expect(root.comparison.active()).toBe(true)
  root.dispose()
})

test('controller opens the base picker instead of guessing main', () => {
  const { dir, git: runGit } = repo()
  runGit('config', '--unset', 'init.defaultBranch')
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()

  expect(root.comparison.state()).toBe('idle')
  expect(root.comparison.basePick()?.map(branch => branch.name)).toContain('trunk')
  root.dispose()
})

test('controller reports detached HEAD as an explicit comparison error', async () => {
  const { dir, git: runGit } = repo()
  runGit('switch', '--detach', '-q')
  const root = createRoot(dispose => {
    const comparison = createComparison({
      rootDir: dir,
      git: createGit(dir, () => 'tree'),
      status: createStatus(),
    })
    return { comparison, dispose }
  })

  root.comparison.open()
  await until(() => root.comparison.state() === 'error')

  expect(root.comparison.error()).toContain('checked-out branch')
  root.dispose()
})

test('controller opens commit metadata and its first file diff lazily', async () => {
  const { dir } = repo()
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()
  await until(() => root.comparison.state() === 'ready')
  root.comparison.toggleMode()
  root.comparison.openSelection()
  await until(
    () => root.comparison.selectedCommit() !== null && root.comparison.selectedContent() !== null,
  )

  expect(root.comparison.selectedCommit()?.commit.subject).toBe('add authentication')
  expect(root.comparison.selectedFile()?.path).toBe('auth.ts')
  root.comparison.moveDetail(1)
  await until(() => {
    const content = root.comparison.selectedContent()
    return (
      root.comparison.selectedFile()?.path === 'other.ts' &&
      content?.binary === false &&
      content.newText === 'export const other = true\n'
    )
  })
  expect(root.comparison.selectedContent()).toMatchObject({
    binary: false,
    newText: 'export const other = true\n',
  })
  root.dispose()
})

test('a newer base choice wins over an earlier load still in flight', async () => {
  const { dir, git: runGit } = repo()
  runGit('branch', 'develop', 'trunk')
  const root = createRoot(dispose => {
    const git = createGit(dir, () => 'tree')
    git.setBranch('feature')
    const comparison = createComparison({ rootDir: dir, git, status: createStatus() })
    return { comparison, dispose }
  })

  root.comparison.open()
  root.comparison.openBasePicker()
  const develop = root.comparison.basePick()?.find(branch => branch.name === 'develop')
  expect(develop).toBeDefined()
  root.comparison.chooseBase(develop!)
  await until(() => root.comparison.state() === 'ready')

  expect(root.comparison.result()?.base.name).toBe('develop')
  root.dispose()
})
