import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, openDiff, openFile, press, pressTimes, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'

/** A repository with two committed, then modified, files. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-difftab-'))
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

test('the diff sits in the tab strip, marked as its own tab', async () => {
  const t = await launch(repo())
  await openDiff(t)

  expect(tabRow(t)).toContain('⇄ a.ts')
  await untilFrame(t, '+ ALPHA')
})

test('opening a file from the tree closes the diff — it is a tab, not a layer', async () => {
  const t = await launch(repo())
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  // Back to the file tree, then open a file with the keyboard: the page used to
  // stay up over it, so the editor showed a diff of whatever was open before.
  // Git → Ext → Files: the strip is a cycle over the sidebar's views.
  await pressTimes(t, 2, i => i.pressTab({ shift: true }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('BETA') // the file the tree opened
  expect(frame).not.toContain('+ ALPHA') // …and not the diff that was up
  // The diff tab is still on the strip, as a file tab would be: switched away
  // from, not closed.
  expect(tabRow(t)).toContain('⇄ a.ts')
})

test('"Next tab" walks off the diff tab onto the file and back', async () => {
  const t = await launch(repo())
  // A file tab first, so the strip holds a file and the diff.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  await runCommand(t, 'Next tab')
  expect(t.captureCharFrame()).not.toContain('+ ALPHA') // the file, not the page
  expect(tabRow(t)).toContain('⇄ a.ts') // and the diff tab is still open

  await runCommand(t, 'Next tab')
  await untilFrame(t, '+ ALPHA') // back onto the diff tab
})

test('the diff tab survives switching the sidebar back to the tree', async () => {
  const t = await launch(repo())
  await openDiff(t)
  await untilFrame(t, '+ ALPHA')

  // Git → Ext → Files: the strip is a cycle over the sidebar's views.
  await pressTimes(t, 2, i => i.pressTab({ shift: true }))
  const frame = t.captureCharFrame()
  expect(frame).toContain('explorer') // the tree is back in the sidebar…
  expect(frame).toContain('+ ALPHA') // …and the diff is still the open tab
  expect(tabRow(t)).toContain('⇄ a.ts')
})

test('the settings page also gives way to a file being opened', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Trim trailing whitespace')

  await openFile(t, 'b.ts')
  const frame = t.captureCharFrame()
  expect(frame).toContain('BETA')
  expect(frame).not.toContain('Trim trailing whitespace')
})
