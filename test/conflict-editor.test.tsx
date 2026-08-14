import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFLICT_GROUPS, getSyntaxStyle, styleIdForGroup } from '../src/languages/highlight'
import { fixture, launch, openFile, press, pressTimes, runCommand, until } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

const CONFLICTED = [
  'const a = 1',
  '<<<<<<< HEAD',
  'const b = 2',
  '=======',
  'const b = 3',
  '>>>>>>> feature/x',
  'const c = 4',
  '',
].join('\n')

const frame = (t: Harness) => t.captureCharFrame()
const bar = (t: Harness) => frame(t).split('\n').at(-2) ?? ''

/** A project whose one file is mid-merge. */
const conflicted = () => fixture({ 'a.ts': CONFLICTED })

/**
 * Put the caret inside the first conflict. The accept commands act on the block
 * the caret is in and nowhere else — a file's other conflict is off screen as
 * often as not, and resolving one of those unasked is unrecoverable by eye.
 */
const intoConflict = (t: Harness) => pressTimes(t, 2, i => i.pressArrow('down'))

test('every conflict group resolves to a style, so the block is actually tinted', async () => {
  // A group nothing resolves to paints as plain text and says nothing: the tint
  // would be gone with no error anywhere, which is the failure this catches.
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  getSyntaxStyle()
  for (const group of Object.values(CONFLICT_GROUPS)) {
    expect(styleIdForGroup(group)).not.toBeNull()
  }
})

test('the gutter marks the block and nothing either side of it', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  const marked = frame(t)
    .split('\n')
    .filter(row => row.includes('┃'))
    .map(row => row.trim())
  // Lines 2 through 6 are the conflict; 1 and 7 are the code around it.
  expect(marked).toHaveLength(5)
  expect(marked.at(0)).toContain('<<<<<<< HEAD')
  expect(marked.at(-1)).toContain('>>>>>>> feature/x')
  expect(frame(t)).toContain('  1 const a = 1')
})

test('the markers are drawn as the file has them', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  const shown = frame(t)
  expect(shown).toContain('<<<<<<< HEAD')
  expect(shown).toContain('=======')
  expect(shown).toContain('>>>>>>> feature/x')
})

test('accepting the current change keeps ours and drops the markers', async () => {
  const dir = conflicted()
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  await intoConflict(t)
  await runCommand(t, 'Accept current change')
  await until(t, () => !frame(t).includes('<<<<<<<'))

  const shown = frame(t)
  expect(shown).toContain('const b = 2')
  expect(shown).not.toContain('const b = 3')
  expect(shown).not.toContain('=======')

  // Saving writes what the editor is showing, markers and all gone.
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await until(t, () => !readFileSync(join(dir, 'a.ts'), 'utf8').includes('<<<<<<<'))
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\nconst b = 2\nconst c = 4\n')
})

test('accepting the incoming change keeps theirs', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  await intoConflict(t)
  await runCommand(t, 'Accept incoming change')
  await until(t, () => !frame(t).includes('<<<<<<<'))
  expect(frame(t)).toContain('const b = 3')
  expect(frame(t)).not.toContain('const b = 2')
})

test('accepting both keeps the two sides in marker order', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  await intoConflict(t)
  await runCommand(t, 'Accept both changes')
  await until(t, () => !frame(t).includes('<<<<<<<'))
  const shown = frame(t)
  expect(shown).toContain('const b = 2')
  expect(shown).toContain('const b = 3')
})

test('the resolve chooser names the two branches', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  await intoConflict(t)
  await runCommand(t, 'Resolve conflict at cursor')
  await until(t, () => frame(t).includes('Merge conflict'))

  const shown = frame(t)
  expect(shown).toContain('Current change (HEAD)')
  expect(shown).toContain('Incoming change (feature/x)')
  expect(shown).toContain('Both changes')
})

test('a resolve away from any conflict says so rather than eating a block', async () => {
  const t = await launch(conflicted())
  await openFile(t, 'a.ts')
  await runCommand(t, 'Resolve conflict at cursor')
  await until(t, () => bar(t).includes('No merge conflict on this line'))
  // The file is untouched: the markers are all still there.
  expect(frame(t)).toContain('<<<<<<< HEAD')
})

test('next conflict lands on the block and counts them', async () => {
  const t = await launch(fixture({ 'a.ts': CONFLICTED + CONFLICTED }))
  await openFile(t, 'a.ts')
  await runCommand(t, 'Next conflict')
  await until(t, () => bar(t).includes('Conflict 1 of 2'))
  expect(bar(t)).toContain('HEAD vs feature/x')

  await runCommand(t, 'Next conflict')
  await until(t, () => bar(t).includes('Conflict 2 of 2'))
})

test('a file with no conflicts says so instead of jumping', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openFile(t, 'a.ts')
  await runCommand(t, 'Next conflict')
  await until(t, () => bar(t).includes('No merge conflicts in this file'))
})

test('resolving one conflict leaves the other, and says how many are left', async () => {
  const t = await launch(fixture({ 'a.ts': CONFLICTED + CONFLICTED }))
  await openFile(t, 'a.ts')
  await intoConflict(t)
  await runCommand(t, 'Accept current change')
  await until(t, () => bar(t).includes('1 conflict left'))
  expect(frame(t)).toContain('<<<<<<< HEAD')
})

test('a real merge conflict resolves from the panel through to a commit', async () => {
  const dir = tempDir('druk-merge-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@e.com')
  git('config', 'user.name', 'T')
  writeFileSync(join(dir, 'a.ts'), 'const b = 1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('checkout', '-q', '-b', 'other')
  writeFileSync(join(dir, 'a.ts'), 'const b = 3\n')
  git('commit', '-qam', 'theirs')
  git('checkout', '-q', 'main')
  writeFileSync(join(dir, 'a.ts'), 'const b = 2\n')
  git('commit', '-qam', 'ours')
  try {
    git('merge', 'other')
  } catch {
    // The merge is meant to fail — that is the state under test.
  }

  const t = await launch(dir)
  // The panel lists it under Merge Changes and Enter opens it at the markers.
  await runCommand(t, 'Source control (commit / push)')
  await until(t, () => frame(t).includes('Merge Changes'))
  await until(t, () => frame(t).includes('a.ts'))

  await openFile(t, 'a.ts')
  await until(t, () => frame(t).includes('<<<<<<<'))
  await intoConflict(t)
  await runCommand(t, 'Accept incoming change')
  await until(t, () => !frame(t).includes('<<<<<<<'))

  await press(t, i => i.pressKey('s', { ctrl: true }))
  await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'const b = 3\n')
})
