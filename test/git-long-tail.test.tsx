import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('Stashes… lists the stash and Apply brings its change back', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'a.ts'), 'stashed work\n')
  git(dir, 'stash', 'push', '-m', 'my half-thought')
  const t = await launch(dir)

  await runCommand(t, 'Stashes')
  await untilFrame(t, 'my half-thought')
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Apply — keep the stash')
  await press(t, i => i.pressEnter())

  await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'stashed work\n')
  // Apply keeps the stash — pop is the one that drops it.
  expect(git(dir, 'stash', 'list').toString()).toContain('my half-thought')
})

test('a tag is created from a prompt and deleted from the picker', async () => {
  const dir = repo()
  const t = await launch(dir)

  await runCommand(t, 'Create tag')
  await untilFrame(t, 'New tag name')
  await press(t, i => void i.typeText('v1.0'))
  await press(t, i => i.pressEnter())
  await until(t, () => git(dir, 'tag').toString().includes('v1.0'))

  await runCommand(t, 'Delete tag')
  await untilFrame(t, 'v1.0')
  await press(t, i => i.pressEnter())
  await until(t, () => !git(dir, 'tag').toString().includes('v1.0'))
})

test('a remote is added name-then-url and removed behind a confirm', async () => {
  const dir = repo()
  const t = await launch(dir)

  await runCommand(t, 'Add remote')
  await untilFrame(t, 'Remote name')
  await press(t, i => void i.typeText('upstream'))
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'URL for upstream')
  await press(t, i => void i.typeText('https://example.com/repo.git'))
  await press(t, i => i.pressEnter())
  await until(t, () => git(dir, 'remote').toString().includes('upstream'))

  await runCommand(t, 'Remove remote')
  await untilFrame(t, 'example.com')
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Remove remote "upstream"')
  await press(t, i => i.pressEnter())
  await until(t, () => !git(dir, 'remote').toString().includes('upstream'))
})

test('File history lists the commits that touched the open file', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'a.ts'), 'alpha two\n')
  git(dir, 'commit', '-aqm', 'second pass')
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // open a.ts

  await runCommand(t, 'File history')
  await untilFrame(t, 'second pass')
  expect(frame(t)).toContain('init')

  // Enter on the newest commit opens its page — the diff carries the old line,
  // which the editor behind it does not, so it is what says the page loaded.
  await press(t, i => i.pressEnter())
  await untilFrame(t, '- alpha')
  expect(frame(t)).toContain('second pass')
})
