import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, pressEscape, until, untilFrame } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/**
 * A clone one commit behind its upstream and one ahead of it — one row in each
 * sync section — with a clean working tree, so the sections are all there is.
 */
function adrift() {
  const base = tempDir('druk-adrift-')
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
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'mine alone')
  // The incoming side is measured against origin/main, which only moves here.
  git(mine, 'fetch', '-q')
  return mine
}

const frame = (t: Harness) => t.captureCharFrame()

test('the panel lists incoming and outgoing commits under their headings', async () => {
  const t = await launch(adrift())
  await press(t, i => void i.pressKeys([TOGGLE]))

  await untilFrame(t, 'Incoming')
  const shown = frame(t)
  expect(shown).toContain('Outgoing')
  expect(shown).toContain('from elsewhere')
  expect(shown).toContain('mine alone')
})

test('Enter on an incoming commit opens its page, Esc puts the panel back', async () => {
  const t = await launch(adrift())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await untilFrame(t, 'from elsewhere')

  // The cursor opens on the Incoming heading; the first commit sits under it.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  // The commit's own diff: the file it added, with its content.
  await untilFrame(t, 'const r = 1')

  await pressEscape(t)
  await until(t, () => !frame(t).includes('const r = 1'))
  expect(frame(t)).toContain('Incoming')
})

test('a sync heading folds its commits away and keeps the count', async () => {
  const t = await launch(adrift())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await untilFrame(t, 'from elsewhere')

  await press(t, i => i.pressArrow('left'))
  await until(t, () => !frame(t).includes('from elsewhere'))
  const shown = frame(t)
  expect(shown).toContain('Incoming')
  expect(shown).toContain('mine alone') // the other section is untouched
})
