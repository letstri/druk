import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { watchTree } from '../src/core/fs'
import { statusEntriesAsync } from '../src/core/git'
import { launch, untilFrame, untilGone } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

function repo() {
  const dir = tempDir('druk-outside-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  return { dir, git }
}

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
    const { dir } = repo()
    const hits = { count: 0 }
    // The first read refreshes the index's stat cache; only a later one could rewrite it.
    await statusEntriesAsync(dir)
    const stop = watchTree(dir, () => {
      hits.count += 1
    })
    try {
      await sleep(200)
      for (let n = 0; n < 5; n += 1) {
        await statusEntriesAsync(dir)
      }
      await sleep(400)
      // A plain `git status` rewrites .git/index, which is watched: the refresh would never settle.
      expect(hits.count).toBe(0)
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
