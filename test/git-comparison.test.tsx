import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  comparisonCommitDetail,
  comparisonFileContent,
  defaultBranch,
  loadBranchComparison,
  resolveComparison,
} from '../src/core/git'
import { tempDir } from './temp'

function repo(initial = 'trunk') {
  const dir = tempDir('druk-compare-')
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', initial)
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  git('add', '.')
  git('commit', '-q', '-m', 'seed')
  return { dir, git }
}

test('default branch follows the configured remote HEAD without assuming main', () => {
  const { dir, git } = repo('trunk')
  git('remote', 'add', 'origin', dir)
  git('fetch', '-q', 'origin')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')

  expect(defaultBranch(dir)).toBe('origin/trunk')
})

test('origin HEAD wins over init.defaultBranch', () => {
  const { dir, git } = repo('trunk')
  git('branch', 'integration')
  git('config', 'init.defaultBranch', 'integration')
  git('remote', 'add', 'origin', dir)
  git('fetch', '-q', 'origin')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')

  expect(defaultBranch(dir)).toBe('origin/trunk')
})

test('an existing init.defaultBranch is the local fallback', () => {
  const { dir, git } = repo('trunk')
  git('config', 'init.defaultBranch', 'trunk')

  expect(defaultBranch(dir)).toBe('trunk')
})

test('default branch returns null when the repository has no configured default', () => {
  const { dir } = repo('topic')

  expect(defaultBranch(dir)).toBeNull()
})

test('comparison resolves the merge base and both directions of divergence', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature')
  git('switch', '-q', 'trunk')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('switch', '-q', 'feature')

  const result = await resolveComparison(dir, 'trunk')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.base.name).toBe('trunk')
  expect(result.value.compare.name).toBe('feature')
  expect(result.value.ahead).toBe(1)
  expect(result.value.behind).toBe(1)
  expect(result.value.mergeBase).toMatch(/^[0-9a-f]{40,64}$/)
})

test('comparison loads the current feature branch against main', async () => {
  const { dir, git } = repo('main')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature')

  const result = await loadBranchComparison(dir, 'main')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.base.name).toBe('main')
  expect(result.value.compare.name).toBe('feature')
  expect(result.value.files.map(file => file.path)).toEqual(['feature.txt'])
})

test('comparison refuses detached HEAD without calling it an invalid branch', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '--detach', '-q')

  const result = await resolveComparison(dir, 'trunk')

  expect(result).toMatchObject({ ok: false, reason: 'detachedHead' })
})

test('comparison distinguishes an unborn current branch', async () => {
  const dir = tempDir('druk-compare-unborn-')
  execFileSync('git', ['init', '-q', '-b', 'feature'], { cwd: dir })

  const result = await resolveComparison(dir, 'trunk')

  expect(result).toMatchObject({ ok: false, reason: 'unbornBranch' })
})

test('comparison reports a base name that does not resolve', async () => {
  const { dir } = repo('trunk')

  const result = await resolveComparison(dir, 'missing')

  expect(result).toMatchObject({ ok: false, reason: 'invalidBase' })
})

test('comparison reports branches with unrelated histories', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '--orphan', 'other')
  rmSync(join(dir, 'seed.txt'), { force: true })
  writeFileSync(join(dir, 'other.txt'), 'other\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'other root')

  const result = await resolveComparison(dir, 'trunk', 'other')

  expect(result).toMatchObject({ ok: false, reason: 'noMergeBase' })
})

test('comparison contains only feature work with complete file metadata', async () => {
  const { dir, git } = repo('trunk')
  writeFileSync(join(dir, 'changed.txt'), 'before\n')
  writeFileSync(join(dir, 'deleted.txt'), 'delete me\n')
  writeFileSync(join(dir, 'old-name.txt'), 'rename me\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base files')
  git('switch', '-q', '-c', 'feature')

  writeFileSync(join(dir, 'added.txt'), 'added\n')
  writeFileSync(join(dir, 'changed.txt'), 'after\n')
  rmSync(join(dir, 'deleted.txt'))
  git('mv', 'old-name.txt', 'new-name.txt')
  writeFileSync(join(dir, 'image.bin'), new Uint8Array([0, 1, 2, 3]))
  git('add', '-A')
  git('commit', '-q', '-m', 'feature files')

  git('switch', '-q', 'trunk')
  writeFileSync(join(dir, 'base-only.txt'), 'base\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base only')
  git('switch', '-q', 'feature')

  const result = await loadBranchComparison(dir, 'trunk', 'feature')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.files.map(file => [file.status, file.oldPath, file.path])).toEqual([
    ['added', null, 'added.txt'],
    ['modified', null, 'changed.txt'],
    ['deleted', null, 'deleted.txt'],
    ['added', null, 'image.bin'],
    ['renamed', 'old-name.txt', 'new-name.txt'],
  ])
  expect(result.value.files.some(file => file.path === 'base-only.txt')).toBe(false)
  expect(result.value.files.find(file => file.path === 'changed.txt')).toMatchObject({
    binary: false,
    additions: 1,
    deletions: 1,
  })
  expect(result.value.files.find(file => file.path === 'image.bin')).toMatchObject({
    binary: true,
    additions: null,
    deletions: null,
  })
  expect(result.value.files.find(file => file.path === 'new-name.txt')).toMatchObject({
    similarity: 100,
    additions: 0,
    deletions: 0,
  })
  expect(result.value.stats).toEqual({
    files: 5,
    additions: 2,
    deletions: 2,
    binaryFiles: 1,
  })
  expect(result.value.commits.map(commit => commit.subject)).toEqual(['feature files'])
})

test('comparison with the same branch has no commits or changed files', async () => {
  const { dir } = repo('trunk')

  const result = await loadBranchComparison(dir, 'trunk', 'trunk')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.files).toEqual([])
  expect(result.value.commits).toEqual([])
  expect(result.value.stats).toEqual({
    files: 0,
    additions: 0,
    deletions: 0,
    binaryFiles: 0,
  })
})

test('comparison preserves merge commits and all of their parents', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature work')
  git('switch', '-q', '-c', 'integration', 'trunk')
  writeFileSync(join(dir, 'integration.txt'), 'integration\n')
  git('add', '.')
  git('commit', '-q', '-m', 'integration work')
  git('switch', '-q', 'feature')
  git('merge', '-q', '--no-ff', 'integration', '-m', 'merge integration')

  const result = await loadBranchComparison(dir, 'trunk', 'feature')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  const merge = result.value.commits.find(commit => commit.subject === 'merge integration')
  expect(merge?.parents).toHaveLength(2)
  expect(result.value.files.map(file => file.path)).toEqual(['feature.txt', 'integration.txt'])
})

test('comparison preserves paths that porcelain output would quote', async () => {
  const { dir, git } = repo('trunk')
  const paths = ['line\nbreak.txt', 'space name.txt', 'tab\tname.txt', 'ümlaut.txt']
  git('switch', '-q', '-c', 'feature')
  for (const path of paths) writeFileSync(join(dir, path), `${path}\n`)
  git('add', '.')
  git('commit', '-q', '-m', 'unusual paths')

  const result = await loadBranchComparison(dir, 'trunk', 'feature')

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.files.map(file => file.path).toSorted()).toEqual(paths.toSorted())
})

test('comparison file content loads the exact object sides for every status', async () => {
  const { dir, git } = repo('trunk')
  const oldName = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n'
  const newName = 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n'
  writeFileSync(join(dir, 'deleted.txt'), 'deleted old\n')
  writeFileSync(join(dir, 'old-name.txt'), oldName)
  git('add', '.')
  git('commit', '-q', '-m', 'base files')
  git('switch', '-q', '-c', 'feature')
  rmSync(join(dir, 'deleted.txt'))
  git('mv', 'old-name.txt', 'new-name.txt')
  writeFileSync(join(dir, 'new-name.txt'), newName)
  writeFileSync(join(dir, 'added.txt'), 'added new\n')
  writeFileSync(join(dir, 'image.bin'), new Uint8Array([0, 1, 2, 3]))
  git('add', '-A')
  git('commit', '-q', '-m', 'feature files')
  const comparison = await loadBranchComparison(dir, 'trunk', 'feature')
  expect(comparison.ok).toBe(true)
  if (!comparison.ok) return
  const file = (path: string) => comparison.value.files.find(item => item.path === path)!

  expect(await comparisonFileContent(dir, file('added.txt'))).toEqual({
    ok: true,
    value: { binary: false, oldText: '', newText: 'added new\n' },
  })
  expect(await comparisonFileContent(dir, file('deleted.txt'))).toEqual({
    ok: true,
    value: { binary: false, oldText: 'deleted old\n', newText: '' },
  })
  expect(await comparisonFileContent(dir, file('new-name.txt'))).toEqual({
    ok: true,
    value: { binary: false, oldText: oldName, newText: newName },
  })
  expect(await comparisonFileContent(dir, file('image.bin'))).toEqual({
    ok: true,
    value: { binary: true },
  })
})

test('comparison metadata uses a fixed command set and defers blob reads', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'seed.txt'), 'changed\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature')
  const trace = join(dir, 'trace.json')
  const previousTrace = process.env.GIT_TRACE2_EVENT

  process.env.GIT_TRACE2_EVENT = trace
  try {
    const comparison = await loadBranchComparison(dir, 'trunk', 'feature')
    expect(comparison.ok).toBe(true)
    if (!comparison.ok) return

    const commandsBeforeDetail = readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { event?: string; argv?: string[] })
      .filter(event => event.event === 'start')
      .map(event => event.argv ?? [])
    expect(commandsBeforeDetail.length).toBeLessThanOrEqual(10)
    expect(commandsBeforeDetail.some(argv => argv.includes('cat-file'))).toBe(false)

    const detail = await comparisonFileContent(dir, comparison.value.files[0]!)
    expect(detail.ok).toBe(true)
    const commandsAfterDetail = readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { event?: string; argv?: string[] })
      .filter(event => event.event === 'start')
      .map(event => event.argv ?? [])
    expect(commandsAfterDetail.some(argv => argv.includes('cat-file'))).toBe(true)
  } finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT
    else process.env.GIT_TRACE2_EVENT = previousTrace
  }
})

test('commit detail contains metadata, files and line totals', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature work')
  const oid = git('rev-parse', 'HEAD')

  const detail = await comparisonCommitDetail(dir, oid)

  expect(detail.ok).toBe(true)
  if (!detail.ok) return
  expect(detail.value.commit).toMatchObject({
    oid,
    subject: 'feature work',
    authorName: 'Test',
    authorEmail: 'test@example.com',
  })
  expect(detail.value.files.map(file => file.path)).toEqual(['feature.txt'])
  expect(detail.value.stats).toEqual({
    files: 1,
    additions: 1,
    deletions: 0,
    binaryFiles: 0,
  })
})

test('root commit detail compares against the empty tree', async () => {
  const { dir, git } = repo('trunk')
  const oid = git('rev-parse', 'HEAD')

  const detail = await comparisonCommitDetail(dir, oid)

  expect(detail.ok).toBe(true)
  if (!detail.ok) return
  expect(detail.value.files.map(file => file.path)).toEqual(['seed.txt'])
  expect(detail.value.files[0]).toMatchObject({ status: 'added', additions: 1, deletions: 0 })
})

test('merge commit detail uses its first parent', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature')
  git('switch', '-q', '-c', 'integration', 'trunk')
  writeFileSync(join(dir, 'integration.txt'), 'integration\n')
  git('add', '.')
  git('commit', '-q', '-m', 'integration')
  git('switch', '-q', 'feature')
  git('merge', '-q', '--no-ff', 'integration', '-m', 'merge integration')
  const oid = git('rev-parse', 'HEAD')

  const detail = await comparisonCommitDetail(dir, oid)

  expect(detail.ok).toBe(true)
  if (!detail.ok) return
  expect(detail.value.commit.parents).toHaveLength(2)
  expect(detail.value.files.map(file => file.path)).toEqual(['integration.txt'])
})
