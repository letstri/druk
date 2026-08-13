import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  launch,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  untilFrame,
  untilGone,
} from './helpers'

/** A real repository with committed files. */
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-changes-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

const many = (tag: string) => `${Array.from({ length: 40 }, (_, i) => `${tag}${i}`).join('\n')}\n`

test('Show all changes stacks every file in the editor slot', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')

  const frame = t.captureCharFrame()
  expect(frame).toContain('Uncommitted')
  expect(frame).toContain('+ ALPHA')
  expect(frame).toContain('+ BETA')
  expect(frame).toContain('a.ts')
  expect(frame).toContain('b.ts')
  expect(frame).not.toContain('⇄')
})

test('Esc closes the all-changes page back to the editor', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await pressEscape(t)
  await untilGone(t, 'Uncommitted')
})

test('arrows in the panel do not open a one-file diff over the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  await press(t, i => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('Uncommitted')
  expect(frame).not.toContain('⇄')
})

test('a save under the page refreshes the stacked diffs', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 40 })
  // The file has to be an open tab: that is what the watcher reloads, and the
  // reload is what tells the page to re-read.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Show all changes')
  await untilFrame(t, '+ ALPHA')
  writeFileSync(join(dir, 'a.ts'), 'GAMMA\n')
  await untilFrame(t, '+ GAMMA')
  expect(t.captureCharFrame()).toContain('+ BETA')
})

test('a in the source-control panel opens the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'Changes')
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, 'Uncommitted')
  expect(t.captureCharFrame()).toContain('+ ALPHA')
})

test('a path staged and then edited is two sections', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'BETA\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(join(dir, 'a.ts'), 'GAMMA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'staged')
  const frame = t.captureCharFrame()
  expect(frame).toContain('staged')
  expect(frame).toContain('+ BETA')
  expect(frame).toContain('+ GAMMA')
})

test('Enter on an Incoming commit closes the page so the commit is visible', async () => {
  const base = mkdtempSync(join(tmpdir(), 'druk-changes-sync-'))
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  const mine = join(base, 'mine')
  execFileSync('git', ['clone', '-q', origin, mine])
  const git = (...args: string[]) => execFileSync('git', args, { cwd: mine })
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-qm', 'first')
  git('push', '-q', '-u', 'origin', 'main')

  const theirs = join(base, 'theirs')
  execFileSync('git', ['clone', '-q', origin, theirs])
  execFileSync('git', ['config', 'user.email', 'theirs@example.com'], { cwd: theirs })
  execFileSync('git', ['config', 'user.name', 'Theirs'], { cwd: theirs })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: theirs })
  writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
  execFileSync('git', ['add', '.'], { cwd: theirs })
  execFileSync('git', ['commit', '-qm', 'from elsewhere'], { cwd: theirs })
  execFileSync('git', ['push', '-q'], { cwd: theirs })
  git('fetch', '-q')
  writeFileSync(join(mine, 'a.ts'), 'dirty\n')

  const t = await launch(mine, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await untilFrame(t, 'from elsewhere')
  // Changes heading, the dirty file, Incoming, then the commit.
  await pressTimes(t, 8, i => i.pressArrow('up'))
  await pressTimes(t, 3, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
  await untilFrame(t, 'const r = 1')
})

test('Enter in the panel opens the file and closes the page', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
  expect(t.captureCharFrame()).toContain('ALPHA')
})

test('opening the page scrolls to the file under the panel cursor', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'b.ts')
  // Heading or a.ts: two downs land on b.ts and stay there.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, 'Uncommitted')
  await untilFrame(t, '+ BETA')
  expect(t.captureCharFrame()).not.toContain('+ new0')
})

test('the page closes once nothing is left to show', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { height: 40 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'Uncommitted')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('d'))
  await untilFrame(t, 'Discard changes')
  await press(t, i => i.pressEnter())
  await untilGone(t, 'Uncommitted')
})

test('after the list shrinks the page still follows the highlighted file', async () => {
  const dir = repo({ 'a.ts': many('old'), 'b.ts': 'beta\n', 'c.ts': 'gamma\n' })
  writeFileSync(join(dir, 'a.ts'), many('new'))
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')
  writeFileSync(join(dir, 'c.ts'), 'GAMMA\n')

  const t = await launch(dir, {}, { height: 24 })
  await runCommand(t, 'Source control')
  await untilFrame(t, 'c.ts')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressKey('a'))
  await untilFrame(t, '+ GAMMA')
  await press(t, i => void i.typeText('d'))
  await untilFrame(t, 'Discard changes')
  await press(t, i => i.pressEnter())
  await untilGone(t, '+ GAMMA')
  await untilFrame(t, '+ BETA')
  expect(t.captureCharFrame()).not.toContain('+ new0')
})
