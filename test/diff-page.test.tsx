import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  launch,
  openDiff,
  openFile,
  press,
  pressTimes,
  runCommand,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** A repository with two committed, then modified, files. */
function repo() {
  const dir = tempDir('druk-diffpage-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), 'alpha\n')
  writeFileSync(join(dir, 'b.ts'), 'beta\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')
  return dir
}

const tabRow = (t: Harness) => t.captureCharFrame().split('\n')[0]!

test('the panel cursor opens the stacked page, and it is no tab of its own', async () => {
  const t = await launch(repo(), {}, { height: 40 })
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  const frame = t.captureCharFrame()
  // Every change at once, whichever row the cursor landed on.
  expect(frame).toContain('+ BETA')
  expect(tabRow(t)).not.toContain('a.ts')
})

test('opening a file from the tree closes the page — it is a layer, not a tab', async () => {
  const t = await launch(repo(), {}, { height: 40 })
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  // Back to the file tree, then open a file with the keyboard.
  // Git → Review → Ext → Files: the strip is a cycle over the sidebar's views.
  await pressTimes(t, 3, i => i.pressTab({ shift: true }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await untilGone(t, '+ ALPHA')
  expect(t.captureCharFrame()).toContain('BETA') // the file the tree opened
})

test('the page survives switching the sidebar back to the tree', async () => {
  const t = await launch(repo(), {}, { height: 40 })
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  // Git → Review → Ext → Files: the strip is a cycle over the sidebar's views.
  await pressTimes(t, 3, i => i.pressTab({ shift: true }))
  const frame = t.captureCharFrame()
  expect(frame).toContain('explorer') // the tree is back in the sidebar…
  expect(frame).toContain('+ ALPHA') // …and the changes are still on screen
})

test('the settings page also gives way to a file being opened', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Follow OS appearance')

  await openFile(t, 'b.ts')
  const frame = t.captureCharFrame()
  expect(frame).toContain('BETA')
  expect(frame).not.toContain('Follow OS appearance')
})
