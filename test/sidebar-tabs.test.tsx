import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, settle } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const TABS_ROW = 0
const FILES_X = 3
const GIT_X = 9

interface Span {
  text: string
  bg?: { buffer: Uint8Array }
}

const hex = (bg: Span['bg']) =>
  bg ? `#${Array.from(bg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}` : ''

function fillBehind(t: Harness, label: string): string {
  const spans = t.captureSpans() as unknown as { lines: { spans: Span[] }[] }
  const span = spans.lines[TABS_ROW]?.spans.find(s => s.text.includes(label))
  return hex(span?.bg)
}

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('the tab strip switches the sidebar between its two views', async () => {
  const t = await launch(repo())
  expect(frame(t)).toContain('EXPLORER')

  await t.mockMouse.click(GIT_X, TABS_ROW)
  await settle(t)
  const panel = frame(t)
  expect(panel).toContain('▾ Changes')
  expect(panel).not.toContain('EXPLORER')

  await t.mockMouse.click(FILES_X, TABS_ROW)
  await settle(t)
  expect(frame(t)).toContain('EXPLORER')
})

test('the view on screen is the filled button, and the fill follows the click', async () => {
  const t = await launch(repo())
  expect(fillBehind(t, 'Files')).toBe(ui.statusBg.toLowerCase())
  expect(fillBehind(t, 'Git')).toBe(ui.panelBg.toLowerCase())

  await t.mockMouse.click(GIT_X, TABS_ROW)
  await settle(t)
  expect(fillBehind(t, 'Git')).toBe(ui.statusBg.toLowerCase())
  expect(fillBehind(t, 'Files')).toBe(ui.panelBg.toLowerCase())
})

test('the strip is there outside a repository too', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n' }))
  expect(frame(t)).toContain('Files')

  await t.mockMouse.click(GIT_X, TABS_ROW)
  await settle(t)
  expect(frame(t)).toContain('open a repository to use git')
})
