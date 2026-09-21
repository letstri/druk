import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ctrlOpt,
  fixture,
  launch,
  press,
  pressEscape,
  runCommand,
  settle,
  until,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo, originWithClones } from './repo'

const TOGGLE = ctrlOpt('g')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd })

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

function behindWithEdit() {
  const { origin, clone } = originWithClones('druk-sync-')

  const mine = clone('mine')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'first')
  git(mine, 'push', '-q', '-u', 'origin', 'main')

  const theirs = clone('theirs')
  writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
  git(theirs, 'add', '.')
  git(theirs, 'commit', '-qm', 'from elsewhere')
  git(theirs, 'push', '-q')

  writeFileSync(join(mine, 'local.ts'), 'const l = 1\n')
  return { mine, origin }
}

const remoteLog = (origin: string) =>
  execFileSync('git', ['log', '--format=%s', 'main'], {
    cwd: origin,
  }).toString()

const frame = (t: Harness) => t.captureCharFrame()

test('the commit box keeps its message across Esc, and Enter needs one', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await press(t, (i) => i.typeText('c'))
  await press(t, (i) => i.pressEnter())
  await until(t, () => frame(t).includes('Enter a commit message'))

  await press(t, (i) => i.typeText('half a thought'))
  await pressEscape(t)

  expect(frame(t)).toContain('half a thought')
  const log = execFileSync('git', ['log', '--format=%s'], {
    cwd: dir,
  }).toString()
  expect(log).not.toContain('half a thought')
})

test('↑ in the commit box walks past subjects, ↓ comes back to the draft', async () => {
  const dir = repo()
  git(dir, 'commit', '--allow-empty', '-qm', 'second thoughts')
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await press(t, (i) => i.typeText('c'))
  await press(t, (i) => i.typeText('half a thought'))
  await until(t, () => frame(t).includes('half a thought'))

  await press(t, (i) => i.pressArrow('up'))
  await until(t, () => frame(t).includes('second thoughts'))
  await press(t, (i) => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
  await press(t, (i) => i.pressArrow('down'))
  await until(t, () => frame(t).includes('second thoughts'))
  await press(t, (i) => i.pressArrow('down'))
  await until(t, () => frame(t).includes('half a thought'))
})

test('a recalled subject is committed as it stands', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await press(t, (i) => i.typeText('c'))
  await press(t, (i) => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => {
    const log = execFileSync('git', ['log', '--format=%s'], {
      cwd: dir,
    }).toString()
    return log.split('\n').filter((line) => line === 'init').length === 2
  })
})

test('the commit message prompt walks the same history', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)

  await runCommand(t, 'Commit & push')
  await until(t, () => frame(t).includes('↑↓ history'))
  await press(t, (i) => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
})

test('Commit & sync lands the commit on origin and pulls what it had', async () => {
  const { mine, origin } = behindWithEdit()
  const t = await launch(mine)

  await runCommand(t, 'Commit & sync')
  await until(t, () => frame(t).includes('Commit —'))
  await press(t, (i) => i.pressEnter())
  await until(t, () => frame(t).includes('Commit message'))
  await press(t, (i) => i.typeText('mine via sync'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => remoteLog(origin).includes('mine via sync'))
  const local = execFileSync('git', ['log', '--format=%s'], {
    cwd: mine,
  }).toString()
  expect(local).toContain('from elsewhere')
})

test('Commit (amend) folds staged work into the last commit', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)

  await runCommand(t, 'Commit (amend)')
  await until(t, () => frame(t).includes('Amend commit message'))
  await press(t, (i) => i.pressEnter())

  await until(t, () => {
    const out = execFileSync(
      'git',
      ['log', '-1', '--name-only', '--format=%s'],
      {
        cwd: dir,
      }
    ).toString()
    return out.includes('init') && out.includes('a.ts')
  })
  const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: dir,
  })
  expect(count.toString().trim()).toBe('1')
})

test('s in the panel syncs: origin gains nothing, the branch gains theirs', async () => {
  const { mine } = behindWithEdit()
  git(mine, 'stash', '-u')
  const t = await launch(mine)
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await settle(t, 200)

  await press(t, (i) => i.typeText('s'))
  await until(t, () => {
    const local = execFileSync('git', ['log', '--format=%s'], {
      cwd: mine,
    }).toString()
    return local.includes('from elsewhere')
  })
})
