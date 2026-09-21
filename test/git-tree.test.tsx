import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  press,
  pressTimes,
  runCommand,
  toggleSetting,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString())
  }
}

function repo() {
  const dir = fixture({ 'root.ts': 'root\n' })
  mkdirSync(join(dir, 'src/app'), { recursive: true })
  mkdirSync(join(dir, 'src/ui'), { recursive: true })
  writeFileSync(join(dir, 'src/app/actions.ts'), 'actions\n')
  writeFileSync(join(dir, 'src/ui/panel.ts'), 'panel\n')
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'root.ts'), 'ROOT\n')
  writeFileSync(join(dir, 'src/app/actions.ts'), 'ACTIONS\n')
  writeFileSync(join(dir, 'src/ui/panel.ts'), 'PANEL\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()
const panelRows = (t: Harness) =>
  frame(t)
    .split('\n')
    .map((line) => line.slice(0, 30).trimEnd())
    .filter((line) => line.trim().length > 0)

const openPanel = (t: Harness) => runCommand(t, 'Source control')

test('the panel nests the changes under folder rows', async () => {
  const t = await launch(repo())
  await openPanel(t)

  const rows = panelRows(t)
  expect(rows.some((row) => row.includes('root.ts'))).toBe(true)
  expect(rows.some((row) => row.includes('▾ src'))).toBe(true)
  expect(rows.some((row) => row.includes('▾ app'))).toBe(true)
  expect(rows.some((row) => row.includes('▾ ui'))).toBe(true)
  expect(
    rows.some(
      (row) => row.includes('actions.ts') && row.trimEnd().endsWith('M')
    )
  ).toBe(true)
  expect(frame(t)).not.toContain('src/app/actions.ts')
})

test('a folder folds on ← and says how many changes it hides, and unfolds on →', async () => {
  const t = await launch(repo())
  await openPanel(t)

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressArrow('left'))

  let rows = panelRows(t)
  expect(rows.some((row) => row.includes('▸ src'))).toBe(true)
  expect(rows.some((row) => row.includes('actions.ts'))).toBe(false)
  expect(rows.find((row) => row.includes('▸ src'))).toContain('2')

  await press(t, (i) => i.pressArrow('right'))
  rows = panelRows(t)
  expect(rows.some((row) => row.includes('▾ src'))).toBe(true)
  expect(rows.some((row) => row.includes('actions.ts'))).toBe(true)
})

test('the arrows page the diff through the files and step over the folders', async () => {
  const t = await launch(repo())
  await openPanel(t)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressArrow('up'))
  await untilFrame(t, '+ ROOT')

  await press(t, (i) => i.pressArrow('down'))
  const shown = frame(t)
  expect(shown).toContain('+ ROOT')
  expect(shown).toContain('▾ src')

  await pressTimes(t, 2, (i) => i.pressArrow('down'))
  await untilFrame(t, '+ ACTIONS')
})

test('Enter folds the folder under the cursor', async () => {
  const t = await launch(repo())
  await openPanel(t)

  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  expect(panelRows(t).some((row) => row.includes('▸ src'))).toBe(true)

  await press(t, (i) => i.pressEnter())
  expect(panelRows(t).some((row) => row.includes('▾ src'))).toBe(true)
})

test('the flat list is one command away, and shows whole paths again', async () => {
  const t = await launch(repo())
  await openPanel(t)
  await toggleSetting(t, 'Changed files')

  const rows = panelRows(t)
  expect(rows.some((row) => row.includes('src/app/actions.ts'))).toBe(true)
  expect(rows.some((row) => row.includes('▾ src'))).toBe(false)
})

test('"Diff current file" lands on the file even with its folder folded', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openPanel(t)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  expect(panelRows(t).some((row) => row.includes('actions.ts'))).toBe(false)

  await runCommand(t, 'Open file…')
  await press(t, (i) => i.typeText('actions'))
  await press(t, (i) => i.pressEnter())
  await runCommand(t, 'Diff current file')

  await untilFrame(t, '+ ACTIONS')
  expect(panelRows(t).some((row) => row.includes('actions.ts'))).toBe(true)
})
