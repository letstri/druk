import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { watchTree } from '../src/core/fs'
import { launch, untilFrame, untilGone } from './helpers'
import { tempDir } from './temp'

function repo() {
  const dir = tempDir('druk-outside-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@e.com')
  git('config', 'user.name', 'T')
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  return { dir, git }
}

/**
 * `.git` is otherwise unwatched — reading status rewrites `.git/index`, which would
 * feed the watcher its own tail. HEAD and the refs are the exception, and these are
 * why: a commit or a checkout made elsewhere touches no working-tree file, so
 * nothing else would ever tell druk that history moved.
 */
describe('git work done in another terminal', () => {
  test('a commit clears the tree marks and the changed count', async () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    const t = await launch(dir)
    await untilFrame(t, '~1')

    git('commit', '-aqm', 'outside')
    await untilGone(t, '~1')
  })

  test('reading status never feeds the watcher its own tail', async () => {
    const { dir, git } = repo()
    let hits = 0
    const stop = watchTree(dir, () => hits++)
    try {
      await new Promise(resolve => setTimeout(resolve, 200))
      for (let n = 0; n < 5; n++) git('status', '--porcelain')
      await new Promise(resolve => setTimeout(resolve, 400))
      // `git status` refreshes .git/index. If that reached the watcher, the refresh
      // it triggers would write the index again, and this would never settle.
      expect(hits).toBe(0)
    } finally {
      stop()
    }
  })

  test('a branch switch is reflected in the status bar', async () => {
    const { dir, git } = repo()
    const t = await launch(dir)
    await untilFrame(t, 'main')

    git('checkout', '-q', '-b', 'sidequest')
    await untilFrame(t, 'sidequest')
  })
})
