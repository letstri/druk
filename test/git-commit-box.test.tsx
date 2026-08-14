import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, runCommand, settle, until } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/** A repository with one commit and one modified file, so the panel has a row. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

/**
 * A clone whose upstream has moved on while it has a fresh edit of its own —
 * the shape where sync's pull half and push half both have work to do.
 */
function behindWithEdit() {
  const base = tempDir('druk-sync-')
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

  const clone = (name: string) => {
    const dir = join(base, name)
    execFileSync('git', ['clone', '-q', origin, dir])
    git(dir, 'config', 'user.email', `${name}@example.com`)
    git(dir, 'config', 'user.name', name)
    git(dir, 'config', 'commit.gpgsign', 'false')
    return dir
  }

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

/** Every subject on origin's main, newest first. */
const remoteLog = (origin: string) =>
  execFileSync('git', ['log', '--format=%s', 'main'], { cwd: origin }).toString()

const frame = (t: Harness) => t.captureCharFrame()

test('the commit box keeps its message across Esc, and Enter needs one', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))

  // Enter with an empty box refuses rather than committing nothing — and the
  // box keeps the keyboard, so the message can be typed without reopening it.
  await press(t, i => void i.typeText('c'))
  await press(t, i => i.pressEnter())
  await until(t, () => frame(t).includes('Enter a commit message'))

  await press(t, i => void i.typeText('half a thought'))
  await pressEscape(t)

  // The keyboard is back on the rows — the words stay where they were typed.
  expect(frame(t)).toContain('half a thought')
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString()
  expect(log).not.toContain('half a thought')
})

test('↑ in the commit box walks past subjects, ↓ comes back to the draft', async () => {
  const dir = repo()
  git(dir, 'commit', '--allow-empty', '-qm', 'second thoughts')
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))

  await press(t, i => void i.typeText('c'))
  await press(t, i => void i.typeText('half a thought'))
  await until(t, () => frame(t).includes('half a thought'))

  await press(t, i => i.pressArrow('up'))
  await until(t, () => frame(t).includes('second thoughts'))
  await press(t, i => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
  // Walking forward again ends on what was being typed, not on an empty box.
  await press(t, i => i.pressArrow('down'))
  await until(t, () => frame(t).includes('second thoughts'))
  await press(t, i => i.pressArrow('down'))
  await until(t, () => frame(t).includes('half a thought'))
})

test('a recalled subject is committed as it stands', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))

  await press(t, i => void i.typeText('c'))
  await press(t, i => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
  await press(t, i => i.pressEnter())

  await until(t, () => {
    const log = execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString()
    return log.split('\n').filter(line => line === 'init').length === 2
  })
})

test('the commit message prompt walks the same history', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)

  await runCommand(t, 'Commit & push')
  await until(t, () => frame(t).includes('↑↓ history'))
  await press(t, i => i.pressArrow('up'))
  await until(t, () => frame(t).includes('init'))
})

test('Commit & sync lands the commit on origin and pulls what it had', async () => {
  const { mine, origin } = behindWithEdit()
  const t = await launch(mine)

  await runCommand(t, 'Commit & sync')
  // Nothing staged: the file picker carries the variant through.
  await until(t, () => frame(t).includes('Commit —'))
  await press(t, i => i.pressEnter())
  await until(t, () => frame(t).includes('Commit message'))
  await press(t, i => void i.typeText('mine via sync'))
  await press(t, i => i.pressEnter())

  await until(t, () => remoteLog(origin).includes('mine via sync'))
  // The pull half brought origin's commit home.
  const local = execFileSync('git', ['log', '--format=%s'], { cwd: mine }).toString()
  expect(local).toContain('from elsewhere')
})

test('Commit (amend) folds staged work into the last commit', async () => {
  const dir = repo()
  git(dir, 'add', 'a.ts')
  const t = await launch(dir)

  await runCommand(t, 'Commit (amend)')
  // The prompt opens carrying the old subject; Enter hands the same words back.
  await until(t, () => frame(t).includes('Amend commit message'))
  await press(t, i => i.pressEnter())

  await until(t, () => {
    const out = execFileSync('git', ['log', '-1', '--name-only', '--format=%s'], {
      cwd: dir,
    }).toString()
    return out.includes('init') && out.includes('a.ts')
  })
  const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir })
  expect(count.toString().trim()).toBe('1')
})

test('s in the panel syncs: origin gains nothing, the branch gains theirs', async () => {
  const { mine } = behindWithEdit()
  // The edit stays uncommitted; sync's pull must still land origin's commit.
  git(mine, 'stash', '-u')
  const t = await launch(mine)
  await press(t, i => void i.pressKeys([TOGGLE]))
  await settle(t, 200)

  await press(t, i => void i.typeText('s'))
  await until(t, () => {
    const local = execFileSync('git', ['log', '--format=%s'], { cwd: mine }).toString()
    return local.includes('from elsewhere')
  })
})
