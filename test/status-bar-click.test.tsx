import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, openFile, settle } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (color?: { buffer: Uint8Array }) =>
  color
    ? `#${Array.from(color.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
    : ''

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

/** Row and column of `text` in the status bar — the bar is the last drawn row. */
function at(t: Harness, text: string) {
  const lines = t.captureCharFrame().split('\n')
  const y = lines.findLastIndex(line => line.includes(text))
  expect(y).toBeGreaterThan(0)
  return { x: lines[y]!.indexOf(text), y }
}

const bgsAt = (t: Harness, y: number) => {
  const frame = t.captureSpans() as unknown as Frame
  return frame.lines[y]?.spans.map(span => hex(span.bg)) ?? []
}

test('the F1 hint opens the command palette, and tints under the pointer', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))

  const hint = at(t, 'F1 commands')
  expect(bgsAt(t, hint.y)).not.toContain(ui.hoverBg)

  await t.mockMouse.moveTo(hint.x, hint.y)
  await settle(t)
  expect(bgsAt(t, hint.y)).toContain(ui.hoverBg)

  await t.mockMouse.click(hint.x, hint.y)
  await settle(t)
  expect(t.captureCharFrame()).toContain('Commands')
})

test('the keys hint opens the peek strip', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))

  const hint = at(t, 'Ctrl+K keys')
  await t.mockMouse.click(hint.x, hint.y)
  await settle(t)
  expect(t.captureCharFrame()).toContain('Keys · file tree')
})

test('the changed-file count opens the source-control panel', async () => {
  const t = await launch(repo())
  await settle(t, 200)

  const count = at(t, '~1')
  await t.mockMouse.click(count.x, count.y)
  await settle(t)

  const shown = t.captureCharFrame()
  expect(shown).toContain('Changes')
  expect(shown).not.toContain('explorer')
})

test('the branch offers the branches to switch to', async () => {
  const dir = repo()
  git(dir, 'branch', 'feature')
  const t = await launch(dir)
  await settle(t, 200)

  const branch = at(t, '⎇ ')
  await t.mockMouse.click(branch.x, branch.y)
  await settle(t)
  expect(t.captureCharFrame()).toContain('feature')
})

test('the cursor position asks which line to go to', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' }))
  await openFile(t, 'a.ts')

  const cursor = at(t, 'Ln 1, Col 1')
  await t.mockMouse.click(cursor.x, cursor.y)
  await settle(t)
  expect(t.captureCharFrame()).toContain('Go to line')
})
