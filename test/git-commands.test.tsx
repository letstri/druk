import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** A real repository with one committed file. */
function repo(committed: string) {
  const dir = tempDir('druk-git-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), committed)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

const subject = (dir: string) =>
  execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim()
const porcelain = (dir: string) =>
  execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()

/** Git mutations finish off the render clock; poll instead of guessing a delay. */
async function until(t: Harness, cond: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await settle(t, 25)
  expect(cond()).toBe(true)
}

test('commit picker shows every change and commits them all on Enter', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  writeFileSync(join(dir, 'b.ts'), 'new\n')

  const t = await launch(dir)
  await runCommand(t, 'Commit')
  const picker = t.captureCharFrame()
  expect(picker).toContain('2 of 2 files')
  expect(picker).toContain('[x] M a.ts')
  expect(picker).toContain('[x] U b.ts')

  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('Commit message')
  await press(t, i => void i.typeText('add things'))
  await press(t, i => i.pressEnter())

  await until(t, () => subject(dir) === 'add things')
  expect(porcelain(dir)).toBe('')
}, 20000)

test('a file unchecked in the picker stays out of the commit', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  writeFileSync(join(dir, 'b.ts'), 'new\n')

  const t = await launch(dir)
  await runCommand(t, 'Commit')
  await press(t, i => i.pressArrow('down')) // onto b.ts
  await press(t, i => void i.typeText(' ')) // uncheck it
  expect(t.captureCharFrame()).toContain('1 of 2 files')
  expect(t.captureCharFrame()).toContain('[ ] U b.ts')

  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('only a'))
  await press(t, i => i.pressEnter())

  await until(t, () => subject(dir) === 'only a')
  const status = porcelain(dir)
  expect(status).toContain('?? b.ts')
  expect(status).not.toContain('a.ts')
}, 20000)

test('the picker refuses an empty selection and A toggles everything', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')

  const t = await launch(dir)
  await runCommand(t, 'Commit')
  await press(t, i => void i.typeText('a')) // uncheck all
  expect(t.captureCharFrame()).toContain('0 of 1 files')
  await press(t, i => i.pressEnter()) // must not open the message prompt
  expect(t.captureCharFrame()).not.toContain('Commit message')
  await press(t, i => void i.typeText('a')) // back to all checked
  expect(t.captureCharFrame()).toContain('1 of 1 files')
}, 20000)

test('a hand-built index is the selection: no picker, and it commits just that', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(join(dir, 'b.ts'), 'new\n')

  const t = await launch(dir)
  await runCommand(t, 'Commit')
  // Straight to the message — staging is a selection already made, and the
  // panel's Space is how it is made.
  const shown = t.captureCharFrame()
  expect(shown).toContain('Commit message')
  expect(shown).not.toContain('of 2 files')

  await press(t, i => void i.typeText('staged only'))
  await press(t, i => i.pressEnter())

  await until(t, () => subject(dir) === 'staged only')
  expect(porcelain(dir)).toContain('?? b.ts')
  expect(porcelain(dir)).not.toContain('a.ts')
}, 20000)

test('undo last commit asks first, then leaves the changes staged', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  execFileSync('git', ['commit', '-q', '-am', 'second'], { cwd: dir })

  const t = await launch(dir)
  await runCommand(t, 'Undo last commit')
  // The confirm modal names the commit it is about to undo.
  expect(t.captureCharFrame()).toContain('second')
  await press(t, i => i.pressEnter())

  await until(t, () => subject(dir) === 'init')
  expect(porcelain(dir)).toContain('M  a.ts')
}, 20000)

test('stash reverts the working tree and pop brings it back', async () => {
  const dir = repo('one\ntwo\n')
  writeFileSync(join(dir, 'a.ts'), 'CHANGED\ntwo\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('CHANGED')

  await runCommand(t, 'Stash changes')
  await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'one\ntwo\n')
  // The open buffer follows the disk, without waiting for the watcher.
  await until(t, () => !t.captureCharFrame().includes('CHANGED'))

  await runCommand(t, 'Stash pop')
  await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'CHANGED\ntwo\n')
  await until(t, () => t.captureCharFrame().includes('CHANGED'))
}, 20000)

test('push sets an upstream on a local bare remote, and fetch succeeds after', async () => {
  const dir = repo('one\n')
  const bare = tempDir('druk-bare-')
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir })

  const t = await launch(dir)
  await runCommand(t, 'Push')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim()
  await until(t, () => {
    try {
      return execFileSync('git', ['rev-parse', 'main'], { cwd: bare }).toString().trim() === head
    } catch {
      return false
    }
  })
  await until(t, () =>
    execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: dir })
      .toString()
      .includes('origin/main'),
  )

  await runCommand(t, 'Fetch')
  await until(t, () => t.captureCharFrame().includes('Fetched'))
}, 20000)

test('outside a repository the commands refuse with a warning', async () => {
  const t = await launch(fixture({ 'a.ts': 'x\n' }))
  await runCommand(t, 'Commit')
  await until(t, () => t.captureCharFrame().includes('Not a git repository'))
}, 20000)
