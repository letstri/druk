import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { statusMap } from '../src/core/git'
import { fixture, launch, press, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString())
  }
}

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
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

  expect([...statusMap(dir)]).toEqual([[join(dir, 'c.ts'), 'untracked']])

  const against = statusMap(dir, 'main')
  expect(against.get(join(dir, 'b.ts'))).toBe('modified')
  expect(against.get(join(dir, 'renamed.ts'))).toBe('modified')
  expect(against.has(join(dir, 'a.ts'))).toBe(false)
  expect(against.get(join(dir, 'c.ts'))).toBe('untracked')
})

test('comparing against a branch shows work that is already committed', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  expect(frame(t)).toContain('no changes')

  await runCommand(t, 'Compare against branch')
  await press(t, (i) => i.typeText('main'))
  await press(t, (i) => i.pressEnter())

  await untilFrame(t, 'vs main')
  await untilFrame(t, 'b.ts')

  await press(t, (i) => i.pressArrow('up'))
  await untilFrame(t, 'beta on feature')

  await runCommand(t, 'Compare against HEAD')
  await untilFrame(t, 'no changes')
  expect(frame(t)).not.toContain('vs main')
}, 20_000)
