import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ctrlOpt, fixture, launch, press, until, untilFrame } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const TOGGLE = ctrlOpt('g')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd })

function conflicted() {
  const dir = fixture({ 'a.ts': 'shared\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')

  git(dir, 'checkout', '-q', '-b', 'side')
  writeFileSync(join(dir, 'a.ts'), 'side version\n')
  git(dir, 'commit', '-aqm', 'side edit')

  git(dir, 'checkout', '-q', 'main')
  writeFileSync(join(dir, 'a.ts'), 'main version\n')
  git(dir, 'commit', '-aqm', 'main edit')

  try {
    git(dir, 'merge', 'side')
  } catch {
    // The merge is meant to fail: that is the state under test.
  }
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()
const porcelain = (dir: string) =>
  execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()

test('a conflicted path sits alone under Merge Changes', async () => {
  const dir = conflicted()
  expect(porcelain(dir)).toContain('UU a.ts')
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await untilFrame(t, 'Merge Changes')
  const shown = frame(t)
  expect(shown).toContain('a.ts')
  expect(shown).not.toContain('Staged Changes')
})

test('Space on a merge row stages it — the resolve moves it to Staged Changes', async () => {
  const dir = conflicted()
  writeFileSync(join(dir, 'a.ts'), 'resolved\n')
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await untilFrame(t, 'Merge Changes')

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.typeText(' '))
  await until(t, () => porcelain(dir).startsWith('M  a.ts'))
  await untilFrame(t, 'Staged Changes')
  await until(t, () => !frame(t).includes('Merge Changes'))
})

test('Enter opens a conflicted file at its first conflict marker', async () => {
  const dir = conflicted()
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await untilFrame(t, 'Merge Changes')

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, '<<<<<<<')
  expect(frame(t)).toContain('main version')
})
