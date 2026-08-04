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

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

/** A repository whose changes sit at three different depths. */
function repo() {
  const dir = fixture({ 'root.ts': 'root\n' })
  mkdirSync(join(dir, 'src/app'), { recursive: true })
  mkdirSync(join(dir, 'src/ui'), { recursive: true })
  writeFileSync(join(dir, 'src/app/actions.ts'), 'actions\n')
  writeFileSync(join(dir, 'src/ui/panel.ts'), 'panel\n')
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'root.ts'), 'ROOT\n')
  writeFileSync(join(dir, 'src/app/actions.ts'), 'ACTIONS\n')
  writeFileSync(join(dir, 'src/ui/panel.ts'), 'PANEL\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()
/** The sidebar's rows, trailing blanks trimmed, in screen order. */
const panelRows = (t: Harness) =>
  frame(t)
    .split('\n')
    .map(line => line.slice(0, 30).trimEnd())
    .filter(line => line.trim().length > 0)

const openPanel = async (t: Harness) => runCommand(t, 'Source control')

test('the panel nests the changes under folder rows', async () => {
  const t = await launch(repo())
  await openPanel(t)

  const rows = panelRows(t)
  // The file at the root, then the folder that holds the rest — and `src` is
  // joined with nothing, since it has two children.
  expect(rows.some(row => row.includes('root.ts'))).toBe(true)
  expect(rows.some(row => row.includes('▾ src'))).toBe(true)
  expect(rows.some(row => row.includes('▾ app'))).toBe(true)
  expect(rows.some(row => row.includes('▾ ui'))).toBe(true)
  // Leaves carry their own name only: the path is what the folder rows say.
  expect(rows.some(row => row.endsWith('actions.ts            M'))).toBe(true)
  expect(frame(t)).not.toContain('src/app/actions.ts')
})

test('a folder folds on ← and says how many changes it hides, and unfolds on →', async () => {
  const t = await launch(repo())
  await openPanel(t)

  // Rows: root.ts, src, app, actions.ts, ui, panel.ts — the cursor starts at 0.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('left'))

  let rows = panelRows(t)
  expect(rows.some(row => row.includes('▸ src'))).toBe(true)
  expect(rows.some(row => row.includes('actions.ts'))).toBe(false)
  // The count stands in for the two files behind the fold.
  expect(rows.find(row => row.includes('▸ src'))).toContain('2')

  await press(t, i => i.pressArrow('right'))
  rows = panelRows(t)
  expect(rows.some(row => row.includes('▾ src'))).toBe(true)
  expect(rows.some(row => row.includes('actions.ts'))).toBe(true)
})

test('the arrows page the diff through the files and step over the folders', async () => {
  const t = await launch(repo())
  await openPanel(t)
  await press(t, i => i.pressArrow('up')) // a landing on the first row: the root file
  // The diff renderable assembles its panes on a queued microtask, so poll.
  await untilFrame(t, '+ ROOT')

  // Down onto `src`, a folder row: the page stays where it was rather than
  // clearing, and the folder is not folded by the cursor passing over it.
  await press(t, i => i.pressArrow('down'))
  const shown = frame(t)
  expect(shown).toContain('+ ROOT')
  expect(shown).toContain('▾ src')

  // Two more rows down is `actions.ts`, the next file.
  await pressTimes(t, 2, i => i.pressArrow('down'))
  await untilFrame(t, '+ ACTIONS')
})

test('Enter folds the folder under the cursor', async () => {
  const t = await launch(repo())
  await openPanel(t)

  await press(t, i => i.pressArrow('down')) // src
  await press(t, i => i.pressEnter())
  expect(panelRows(t).some(row => row.includes('▸ src'))).toBe(true)

  await press(t, i => i.pressEnter()) // and back
  expect(panelRows(t).some(row => row.includes('▾ src'))).toBe(true)
})

test('the flat list is one command away, and shows whole paths again', async () => {
  const t = await launch(repo())
  await openPanel(t)
  // The flip lives on the settings page's Git section, not in the palette.
  await toggleSetting(t, 'Changed files')

  const rows = panelRows(t)
  expect(rows.some(row => row.includes('src/app/actions.ts'))).toBe(true)
  expect(rows.some(row => row.includes('▾'))).toBe(false)
})

test('"Diff current file" lands on the file even with its folder folded', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openPanel(t)
  await press(t, i => i.pressArrow('down')) // src
  await press(t, i => i.pressEnter()) // folded away
  expect(panelRows(t).some(row => row.includes('actions.ts'))).toBe(false)

  // Open the folded file and ask for its diff: the fold has to give way, or the
  // cursor would point at a row that is not on screen.
  await runCommand(t, 'Open file…')
  await press(t, i => void i.typeText('actions'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')

  await untilFrame(t, '+ ACTIONS')
  expect(panelRows(t).some(row => row.includes('actions.ts'))).toBe(true)
})
