import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { watchGitRefs } from '../src/core/fs'
import { git, initRepo } from './repo'
import { tempDir } from './temp'

async function watched(dir: string) {
  const fired = { count: 0 }
  const stop = watchGitRefs(dir, () => {
    fired.count += 1
  })
  // fs.watch arms a beat after it returns; an event sent into that gap is lost.
  await Bun.sleep(200)
  return {
    stop,
    async woke(act: () => void) {
      fired.count = 0
      act()
      for (let i = 0; i < 100 && fired.count === 0; i += 1) {
        await Bun.sleep(20)
      }
      return fired.count > 0
    },
  }
}

function seeded(prefix: string) {
  const dir = initRepo(tempDir(prefix))
  writeFileSync(join(dir, 'a.ts'), 'alpha\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

test('staging outside druk wakes the watcher', async () => {
  const dir = seeded('druk-watch-')
  writeFileSync(join(dir, 'a.ts'), 'beta\n')
  const w = await watched(dir)
  expect(await w.woke(() => git(dir, 'add', '.'))).toBe(true)
  expect(await w.woke(() => git(dir, 'reset', '-q'))).toBe(true)
  w.stop()
})

test('a commit and a branch switch wake the watcher', async () => {
  const dir = seeded('druk-watch-')
  const w = await watched(dir)
  writeFileSync(join(dir, 'a.ts'), 'beta\n')
  expect(await w.woke(() => git(dir, 'commit', '-qam', 'second'))).toBe(true)
  expect(await w.woke(() => git(dir, 'checkout', '-q', '-b', 'other'))).toBe(
    true
  )
  w.stop()
})

test('a linked worktree is watched through its gitdir file', async () => {
  const dir = seeded('druk-watch-')
  const tree = join(tempDir('druk-watch-tree-'), 'wt')
  git(dir, 'worktree', 'add', '-q', tree, '-b', 'side')
  const w = await watched(tree)
  writeFileSync(join(tree, 'a.ts'), 'gamma\n')
  expect(await w.woke(() => git(tree, 'add', '.'))).toBe(true)
  w.stop()
})
