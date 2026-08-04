import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { statusMap } from '../src/core/git'
import { fixture, launch, press, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

/**
 * `main` with two committed files and a clean tree, plus a `feature` branch one
 * commit ahead. Nothing is uncommitted anywhere: against HEAD there is nothing to
 * show, which is what makes the branch comparison's answer unambiguous.
 */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  git(dir, 'checkout', '-qb', 'feature')
  writeFileSync(join(dir, 'b.ts'), 'beta on feature\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'feature work')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('statusMap against a ref sees committed work, renames and untracked files', () => {
  const dir = repo()
  git(dir, 'mv', 'a.ts', 'renamed.ts')
  git(dir, 'commit', '-qm', 'rename')
  writeFileSync(join(dir, 'c.ts'), 'new and unadded\n')

  // Nothing is uncommitted but the untracked file, so this is the control.
  expect([...statusMap(dir)]).toEqual([[join(dir, 'c.ts'), 'untracked']])

  const against = statusMap(dir, 'main')
  expect(against.get(join(dir, 'b.ts'))).toBe('modified')
  // A rename is one entry naming the new path; the old one no longer exists and
  // must not be reported as a file the tree could draw a mark against.
  expect(against.get(join(dir, 'renamed.ts'))).toBe('modified')
  expect(against.has(join(dir, 'a.ts'))).toBe(false)
  // `git diff` never mentions untracked files — they are the second query.
  expect(against.get(join(dir, 'c.ts'))).toBe('untracked')
})

test('comparing against a branch shows work that is already committed', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  // The working tree is clean: against HEAD the panel has nothing to list.
  expect(frame(t)).toContain('no changes')

  await runCommand(t, 'Compare against branch')
  await press(t, i => void i.typeText('main'))
  await press(t, i => i.pressEnter())

  await untilFrame(t, 'vs main')
  expect(frame(t)).toContain('b.ts')

  // And the diff page is against that branch too, not against HEAD.
  await press(t, i => i.pressArrow('up'))
  await untilFrame(t, 'beta on feature')

  await runCommand(t, 'Compare against HEAD')
  await untilFrame(t, '◆ review')
  expect(frame(t)).not.toContain('vs main')
}, 20000)
