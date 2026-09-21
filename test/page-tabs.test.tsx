import { expect, test } from 'bun:test'

import {
  fixture,
  launch,
  openFile,
  press,
  runCommand,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const alpha = 1\n', 'b.ts': 'const beta = 2\n' }

const tabRow = (t: Harness) => t.captureCharFrame().split('\n')[0]!

const occurrences = (row: string, word: string) => row.split(word).length - 1

test('a page opens as one tab, however often it is asked for', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Follow OS appearance')

  await openFile(t, 'b.ts')
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Follow OS appearance')

  expect(occurrences(tabRow(t), 'Settings')).toBe(1)
  expect(tabRow(t)).toContain('a.ts')
  expect(tabRow(t)).toContain('b.ts')
})

test('a page tab closes like any other, leaving the file it covered', async () => {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  await runCommand(t, 'Settings')
  await untilFrame(t, 'Follow OS appearance')

  await press(t, (input) => input.pressKey('w', { ctrl: true }))
  await untilGone(t, 'Follow OS appearance')

  expect(tabRow(t)).not.toContain('Settings')
  expect(t.captureCharFrame()).toContain('const alpha = 1')
})
