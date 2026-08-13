import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/** A repository mid-merge: `a.ts` edited on both sides of the fork, left UU. */
function conflicted() {
  const dir = fixture({ 'a.ts': 'shared\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
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
    // The conflict is the point.
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
  await press(t, i => void i.pressKeys([TOGGLE]))

  await untilFrame(t, 'Merge Changes')
  const shown = frame(t)
  expect(shown).toContain('a.ts')
  // One row, one heading: the conflict is not also a staged or unstaged change.
  expect(shown).not.toContain('Staged Changes')
})

test('Space on a merge row stages it — the resolve moves it to Staged Changes', async () => {
  const dir = conflicted()
  writeFileSync(join(dir, 'a.ts'), 'resolved\n')
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))
  await untilFrame(t, 'Merge Changes')

  await press(t, i => i.pressArrow('down')) // onto the file row
  await press(t, i => void i.typeText(' '))
  await until(t, () => porcelain(dir).startsWith('M  a.ts'))
  await untilFrame(t, 'Staged Changes')
  await until(t, () => !frame(t).includes('Merge Changes'))
})

test('Enter opens a conflicted file at its first conflict marker', async () => {
  const dir = conflicted()
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))
  await untilFrame(t, 'Merge Changes')

  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await untilFrame(t, '<<<<<<<')
  // The status bar's line number should be the marker's, not line 1 — the
  // marker is the first line here, so the frame carrying it is enough.
  expect(frame(t)).toContain('main version')
})
