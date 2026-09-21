import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, openDiff, press, settle, untilFrame } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

function repo(files: Record<string, string>) {
  const dir = tempDir('druk-changeopen-')
  initRepo(dir)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

const lines = (n: number, word: string) =>
  `${Array.from({ length: n }, (_, i) => `${word}${i}`).join('\n')}\n`

test('Enter on the changes page opens the file at its first change', async () => {
  const dir = repo({ 'a.ts': lines(20, 'line') })
  writeFileSync(
    join(dir, 'a.ts'),
    lines(20, 'line').replace('line7', 'CHANGED')
  )
  const t = await launch(dir, {}, { height: 30, width: 100 })
  await openDiff(t)
  await untilFrame(t, 'CHANGED')

  // Tab moves the keyboard from the panel into the page.
  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'Ln 8')
  expect(t.captureCharFrame()).toContain('Ln 8')
})

test('a click in the diff picks the line Enter opens at', async () => {
  const dir = repo({ 'a.ts': lines(20, 'line') })
  writeFileSync(
    join(dir, 'a.ts'),
    lines(20, 'line').replace('line15', 'CHANGED')
  )
  const t = await launch(dir, {}, { height: 30, width: 100 })
  await openDiff(t)
  await untilFrame(t, 'CHANGED')
  await press(t, (i) => i.pressTab())

  // A context row two below the change: the line it opens at is the one clicked, not the change.
  const rows = t.captureCharFrame().split('\n')
  const row = rows.findIndex((line) => line.includes('line17'))
  await t.mockMouse.click(rows[row]!.indexOf('line17'), row)
  await settle(t)
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'Ln 18')
  expect(t.captureCharFrame()).toContain('Ln 18')
})

test('the footer names the changes page keys', async () => {
  const dir = repo({ 'a.ts': lines(4, 'line') })
  writeFileSync(join(dir, 'a.ts'), lines(4, 'line').replace('line2', 'CHANGED'))
  // Wide: the footer cuts from the tail, and these hints sit behind the panel's own.
  const t = await launch(dir, {}, { height: 30, width: 170 })
  await openDiff(t)
  await untilFrame(t, 'CHANGED')

  // From the panel, Tab is the only one of the three that does anything yet.
  const footer = () => t.captureCharFrame().split('\n').at(-2) ?? ''
  await untilFrame(t, 'Tab file')
  expect(footer()).toContain('Tab file')
  expect(footer()).not.toContain('Enter open')

  await press(t, (i) => i.pressTab())
  await untilFrame(t, 'Enter open')
  expect(footer()).toContain('Tab file')
  expect(footer()).toContain('Enter open')
  expect(footer()).toContain('Esc sidebar')
})
