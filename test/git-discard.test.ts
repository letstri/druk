import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { discardChange, discardTarget } from '../src/core/git'
import { tempDir } from './temp'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function repo(files: Record<string, string> = { 'a.txt': 'base\n', 'other.txt': 'other\n' }) {
  const dir = tempDir('druk-discard-')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

async function discard(dir: string, path: string) {
  const target = discardTarget(dir, join(dir, path))
  expect(target).not.toBeNull()
  const result = await discardChange(target!)
  expect(result).toEqual({ ok: true, detail: '' })
}

const porcelain = (dir: string) => git(dir, 'status', '--porcelain')
const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8')

describe('discardChange', () => {
  test('restores unstaged, staged, mixed, and deleted tracked files from HEAD', async () => {
    for (const setup of [
      (dir: string) => writeFileSync(join(dir, 'a.txt'), 'working\n'),
      (dir: string) => {
        writeFileSync(join(dir, 'a.txt'), 'staged\n')
        git(dir, 'add', 'a.txt')
      },
      (dir: string) => {
        writeFileSync(join(dir, 'a.txt'), 'staged\n')
        git(dir, 'add', 'a.txt')
        writeFileSync(join(dir, 'a.txt'), 'working\n')
      },
      (dir: string) => git(dir, 'rm', '-q', 'a.txt'),
    ]) {
      const dir = repo()
      setup(dir)
      await discard(dir, 'a.txt')
      expect(read(dir, 'a.txt')).toBe('base\n')
      expect(porcelain(dir)).toBe('')
    }
  })

  test('permanently deletes untracked, staged-added, and intent-to-add files', async () => {
    for (const setup of [
      (dir: string) => writeFileSync(join(dir, 'new file.txt'), 'new\n'),
      (dir: string) => {
        writeFileSync(join(dir, 'new file.txt'), 'new\n')
        git(dir, 'add', 'new file.txt')
      },
      (dir: string) => {
        writeFileSync(join(dir, 'new file.txt'), 'new\n')
        git(dir, 'add', '-N', 'new file.txt')
      },
    ]) {
      const dir = repo()
      setup(dir)
      const target = discardTarget(dir, join(dir, 'new file.txt'))
      expect(target?.mode).toBe('delete')
      await discard(dir, 'new file.txt')
      expect(existsSync(join(dir, 'new file.txt'))).toBe(false)
      expect(porcelain(dir)).toBe('')
    }
  })

  test('handles an addition on an unborn branch without resolving HEAD', async () => {
    const dir = tempDir('druk-discard-unborn-')
    git(dir, 'init', '-q', '-b', 'main')
    writeFileSync(join(dir, '新 file.txt'), 'new\n')
    git(dir, 'add', '新 file.txt')

    await discard(dir, '新 file.txt')

    expect(existsSync(join(dir, '新 file.txt'))).toBe(false)
    expect(porcelain(dir)).toBe('')
  })

  test('restores a tracked intent-to-add path from HEAD instead of deleting it', async () => {
    const dir = repo()
    git(dir, 'rm', '-q', '--cached', 'a.txt')
    git(dir, 'add', '-N', 'a.txt')
    expect(porcelain(dir)).toContain('DA a.txt')

    const target = discardTarget(dir, join(dir, 'a.txt'))
    expect(target?.mode).toBe('restore')
    await discard(dir, 'a.txt')

    expect(read(dir, 'a.txt')).toBe('base\n')
    expect(porcelain(dir)).toBe('')
  })

  test('restores a staged rename while preserving unrelated index and worktree changes', async () => {
    const dir = repo({ 'old name.txt': 'old\n', 'staged.txt': 'one\n', 'working.txt': 'one\n' })
    git(dir, 'mv', 'old name.txt', 'renamed ü.txt')
    writeFileSync(join(dir, 'staged.txt'), 'staged\n')
    git(dir, 'add', 'staged.txt')
    writeFileSync(join(dir, 'working.txt'), 'working\n')

    const target = discardTarget(dir, join(dir, 'renamed ü.txt'))
    expect(target?.entry).toMatchObject({ xy: 'R ', source: 'old name.txt' })
    expect(target?.affectedPaths).toEqual([join(dir, 'renamed ü.txt'), join(dir, 'old name.txt')])
    await discard(dir, 'renamed ü.txt')

    expect(read(dir, 'old name.txt')).toBe('old\n')
    expect(existsSync(join(dir, 'renamed ü.txt'))).toBe(false)
    expect(porcelain(dir)).toContain('M  staged.txt')
    expect(porcelain(dir)).toContain(' M working.txt')
  })

  test('deletes a copied destination while preserving the changed source', async () => {
    const original = `${Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')}\n`
    const dir = repo({ 'source.txt': original })
    writeFileSync(join(dir, 'copy ü.txt'), original)
    writeFileSync(join(dir, 'source.txt'), 'source changed\n')
    git(dir, 'add', 'source.txt', 'copy ü.txt')
    git(dir, 'config', 'status.renames', 'copies')

    const target = discardTarget(dir, join(dir, 'copy ü.txt'))
    expect(target?.entry).toMatchObject({ xy: 'C ', source: 'source.txt' })
    expect(target?.mode).toBe('delete')
    await discard(dir, 'copy ü.txt')

    expect(existsSync(join(dir, 'copy ü.txt'))).toBe(false)
    expect(read(dir, 'source.txt')).toBe('source changed\n')
    expect(porcelain(dir)).toContain('M  source.txt')
  })

  test('restores a conflicted path from HEAD without touching another staged file', async () => {
    const dir = repo({ 'a.txt': 'base\n', 'keep.txt': 'base\n' })
    git(dir, 'switch', '-qc', 'other')
    writeFileSync(join(dir, 'a.txt'), 'other\n')
    git(dir, 'commit', '-qam', 'other')
    git(dir, 'switch', '-q', 'main')
    writeFileSync(join(dir, 'a.txt'), 'main\n')
    git(dir, 'commit', '-qam', 'main')
    try {
      git(dir, 'merge', 'other')
    } catch {
      // Expected content conflict.
    }
    writeFileSync(join(dir, 'keep.txt'), 'keep staged\n')
    git(dir, 'add', 'keep.txt')

    await discard(dir, 'a.txt')

    expect(read(dir, 'a.txt')).toBe('main\n')
    expect(porcelain(dir)).not.toContain('a.txt')
    expect(porcelain(dir)).toContain('M  keep.txt')
  })

  test('removes a conflict path when HEAD records its deletion', async () => {
    const dir = repo({ 'a.txt': 'base\n' })
    git(dir, 'switch', '-qc', 'other')
    writeFileSync(join(dir, 'a.txt'), 'other changed\n')
    git(dir, 'commit', '-qam', 'other changes it')
    git(dir, 'switch', '-q', 'main')
    git(dir, 'rm', '-q', 'a.txt')
    git(dir, 'commit', '-qm', 'main deletes it')
    try {
      git(dir, 'merge', 'other')
    } catch {
      // Expected modify/delete conflict.
    }

    await discard(dir, 'a.txt')

    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    expect(porcelain(dir)).toBe('')
  })

  test('leaves the files a glob in the selected name would have matched alone', async () => {
    // `[id].tsx` is what every Next.js and SvelteKit route directory is full of,
    // and git reads a path after `--` as a pathspec: without `:(literal)` the
    // brackets are a character class and `i.tsx` is discarded along with it.
    const dir = repo({ '[id].tsx': 'route\n', 'i.tsx': 'innocent\n', 'd.tsx': 'other\n' })
    writeFileSync(join(dir, '[id].tsx'), 'changed route\n')
    writeFileSync(join(dir, 'i.tsx'), 'changed innocent\n')
    writeFileSync(join(dir, 'd.tsx'), 'changed other\n')

    await discard(dir, '[id].tsx')

    expect(read(dir, '[id].tsx')).toBe('route\n')
    expect(read(dir, 'i.tsx')).toBe('changed innocent\n')
    expect(read(dir, 'd.tsx')).toBe('changed other\n')
  })

  test('deletes only the untracked file named, not the ones its brackets match', async () => {
    const dir = repo()
    writeFileSync(join(dir, '[id].tsx'), 'route\n')
    writeFileSync(join(dir, 'i.tsx'), 'innocent\n')

    const target = discardTarget(dir, join(dir, '[id].tsx'))
    expect(target?.mode).toBe('delete')
    await discard(dir, '[id].tsx')

    expect(existsSync(join(dir, '[id].tsx'))).toBe(false)
    expect(read(dir, 'i.tsx')).toBe('innocent\n')
  })

  test('refuses a stale target and a target whose discard mode changed', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    const stale = discardTarget(dir, join(dir, 'a.txt'))!
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    expect(await discardChange(stale)).toMatchObject({ ok: false })

    writeFileSync(join(dir, 'new.txt'), 'new\n')
    const changedMode = discardTarget(dir, join(dir, 'new.txt'))!
    git(dir, 'add', 'new.txt')
    git(dir, 'commit', '-qm', 'track it')
    writeFileSync(join(dir, 'new.txt'), 'changed\n')
    expect(await discardChange(changedMode)).toMatchObject({
      ok: false,
      detail: expect.stringContaining('changed'),
    })
  })

  test('refuses content changed after the discard was offered even when status is unchanged', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'first change\n')
    const stale = discardTarget(dir, join(dir, 'a.txt'))!

    writeFileSync(join(dir, 'a.txt'), 'second change\n')
    expect(porcelain(dir)).toContain(' M a.txt')
    expect(await discardChange(stale)).toMatchObject({
      ok: false,
      detail: expect.stringContaining('changed'),
    })
    expect(read(dir, 'a.txt')).toBe('second change\n')
  })
})
