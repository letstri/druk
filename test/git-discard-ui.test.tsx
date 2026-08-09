import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, runCommand, settle, until } from './helpers'

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir })

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'folder/keep.ts': 'keep\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'changed\n')
  return dir
}

test('d and the panel-only palette command share the discard confirmation', async () => {
  for (const invoke of [
    (t: Awaited<ReturnType<typeof launch>>) => press(t, input => void input.typeText('d')),
    (t: Awaited<ReturnType<typeof launch>>) => runCommand(t, 'Discard changes'),
  ]) {
    const dir = repo()
    const t = await launch(dir)
    await runCommand(t, 'Source control')
    await invoke(t)

    const confirm = t.captureCharFrame()
    expect(confirm).toContain('Discard changes')
    expect(confirm).toContain('a.ts')
    expect(confirm).toContain('Unsaved edits in its open buffer')
    expect(confirm).toContain('also be lost')
    await press(t, input => input.pressEnter())
    await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'alpha\n')
    expect(t.captureCharFrame()).toContain('Discarded changes in a.ts')
  }
}, 20_000)

test('left click still opens a diff', async () => {
  const dir = repo()
  const t = await launch(dir)
  await runCommand(t, 'Source control')

  // Row 3 is the `Changes` heading now; the first file sits under it.
  await t.mockMouse.click(4, 4)
  await until(t, () => t.captureCharFrame().includes('+1 −1'))
}, 20_000)

test('discard reloads a dirty tracked buffer and resets the visible editor', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  await press(t, input => void input.typeText('unsaved '))
  expect(t.captureCharFrame()).toContain('unsaved changed')

  await runCommand(t, 'Source control')
  await press(t, input => void input.typeText('d'))
  await press(t, input => input.pressEnter())
  await until(t, () => t.captureCharFrame().includes('alpha'))

  expect(t.captureCharFrame()).not.toContain('unsaved changed')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('alpha\n')
  await press(t, input => input.pressKey('z', { ctrl: true }))
  expect(t.captureCharFrame()).not.toContain('unsaved changed')
}, 20_000)

test('discarding an untracked file closes its tab and matching diff', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'new.ts'), 'new\n')
  const t = await launch(dir, { gitPanelView: 'list' })
  await openFile(t, 'new.ts')
  await runCommand(t, 'Source control')
  await press(t, input => input.pressArrow('down'))
  await press(t, input => void input.typeText('d'))
  expect(t.captureCharFrame()).toContain('permanently delete')
  await press(t, input => input.pressEnter())
  await until(t, () => !existsSync(join(dir, 'new.ts')))

  const frame = t.captureCharFrame()
  expect(frame).not.toContain('⇄ new.ts')
  expect(frame.split('\n')[0]).not.toContain('new.ts')
}, 20_000)

test('palette discard refuses outside the panel and on folder rows', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'folder/keep.ts'), 'changed\n')
  const t = await launch(dir)

  await runCommand(t, 'Discard changes')
  expect(t.captureCharFrame()).toContain('Open the Git panel and select a changed file')

  await runCommand(t, 'Source control')
  await press(t, input => input.pressArrow('down'))
  await runCommand(t, 'Discard changes')
  expect(t.captureCharFrame()).toContain('Select a changed file, not a folder')
}, 20_000)

test('palette discard refuses comparison mode', async () => {
  const dir = repo()
  const t = await launch(dir)

  await runCommand(t, 'Compare branches')
  await runCommand(t, 'Discard changes')
  expect(t.captureCharFrame()).toContain('Discard is unavailable while comparing branches')
}, 20_000)

test('a stale confirmation changes neither the dirty buffer nor disk', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  await press(t, input => void input.typeText('unsaved '))
  await runCommand(t, 'Source control')
  await press(t, input => void input.typeText('d'))

  git(dir, 'checkout', '-q', 'HEAD', '--', 'a.ts')
  await press(t, input => input.pressEnter())
  // The refusal is asserted on the buffer, not on the status bar: that same
  // checkout is a clash the watcher reports, and which of the two messages
  // lands last is a race. What the refusal means is that the buffer was never
  // reloaded — `discardChange`'s own wording is pinned in `git-discard.test.ts`.
  await settle(t, 600)

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('alpha\n')
  await press(t, input => input.pressTab())
  expect(t.captureCharFrame()).toContain('unsaved changed')
}, 20_000)
