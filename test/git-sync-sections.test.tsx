import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ctrlOpt,
  launch,
  press,
  pressEscape,
  pressTimes,
  until,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'
import { originWithClones } from './repo'

const TOGGLE = ctrlOpt('g')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd })

function adrift() {
  const { clone } = originWithClones('druk-adrift-')

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
  git(mine, 'fetch', '-q')
  return mine
}

const frame = (t: Harness) => t.captureCharFrame()

test('the panel lists incoming and outgoing commits under their headings', async () => {
  const t = await launch(adrift())
  await press(t, (i) => i.pressKeys([TOGGLE]))

  await untilFrame(t, 'Incoming')
  const shown = frame(t)
  expect(shown).toContain('Outgoing')
  expect(shown).toContain('from elsewhere')
  expect(shown).toContain('mine alone')
})

test('Enter on an incoming commit opens its page, Esc puts the panel back', async () => {
  const t = await launch(adrift())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await untilFrame(t, 'from elsewhere')

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'const r = 1')

  await pressEscape(t)
  await until(t, () => !frame(t).includes('const r = 1'))
  expect(frame(t)).toContain('Incoming')
})

test('a sync heading folds its commits away and keeps the count', async () => {
  const t = await launch(adrift())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await untilFrame(t, 'from elsewhere')

  await press(t, (i) => i.pressArrow('left'))
  await until(t, () => !frame(t).includes('from elsewhere'))
  const shown = frame(t)
  expect(shown).toContain('Incoming')
  expect(shown).toContain('mine alone')
})

test('opening a file closes the commit page it would open behind', async () => {
  const t = await launch(adrift())
  await press(t, (i) => i.pressKeys([TOGGLE]))
  await untilFrame(t, 'from elsewhere')

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'const r = 1')

  await pressTimes(t, 3, (i) => i.pressTab({ shift: true }))
  await press(t, (i) => i.pressEnter())

  await until(t, () => frame(t).includes('const a = 1'))
  expect(frame(t)).not.toContain('const r = 1')
})
