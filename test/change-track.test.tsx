import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, openFile, press, settle } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

const SOURCE = `${Array.from({ length: 400 }, (_, index) => `const value${index} = ${index}`).join(
  '\n',
)}\n`

interface Frame {
  lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
}

const hex = (fg?: { buffer: Uint8Array }) =>
  fg ? `#${Array.from(fg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}` : ''

const track = (t: Harness) => {
  const frame = t.captureSpans() as unknown as Frame
  return frame.lines
    .slice(1)
    .flatMap(line => line.spans.filter(span => span.text.includes('▎')).map(span => hex(span.fg)))
}

async function repoWith(edit: (lines: string[]) => void) {
  const dir = tempDir('druk-track-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  writeFileSync(join(dir, 'big.ts'), SOURCE)
  git('add', '.')
  git('commit', '-q', '-m', 'init')

  const lines = SOURCE.split('\n')
  edit(lines)
  writeFileSync(join(dir, 'big.ts'), lines.join('\n'))
  return dir
}

async function open(dir: string) {
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'big.ts')
  await settle(t, 300)
  return t
}

describe('the change track', () => {
  test('shows changes far below the viewport, which is the point of it', async () => {
    const t = await open(await repoWith(lines => (lines[380] = '// changed down here')))

    expect(track(t)).toContain(ui.gitModified)
  })

  test('an unchanged file draws no track at all', async () => {
    const t = await open(await repoWith(() => {}))

    expect(track(t)).toEqual([])
  })

  test('a file outside a repository draws none either', async () => {
    const t = await open(fixture({ 'big.ts': SOURCE }))

    expect(track(t)).toEqual([])
  })

  test('marks are git colours only — the minimap’s syntax bars are gone', async () => {
    const t = await open(await repoWith(lines => (lines[5] = '// changed')))
    const marks = track(t)

    expect(marks).toContain(ui.gitModified)
    const gitColors = new Set([ui.gitAdded, ui.gitModified, ui.gitDeleted])
    expect(marks.every(color => gitColors.has(color))).toBe(true)
  })
})

describe('the track agrees with the scrollbar', () => {
  const WRAPPED = `${Array.from(
    { length: 300 },
    (_, index) => `const value${index} = ${'x'.repeat(160)} // ${index}`,
  ).join('\n')}\n`

  async function wrappedRepo(changeAt: number) {
    const dir = tempDir('druk-wrapped-')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
    initRepo(dir)
    writeFileSync(join(dir, 'big.ts'), WRAPPED)
    git('add', '.')
    git('commit', '-q', '-m', 'init')

    const lines = WRAPPED.split('\n')
    lines[changeAt] = '// changed'
    writeFileSync(join(dir, 'big.ts'), lines.join('\n'))
    return dir
  }

  // Row 0 is skipped rather than sliced away: the rows after it keep their indices.
  const rowsOf = (t: Harness, glyph: string) =>
    t
      .captureCharFrame()
      .split('\n')
      .filter(row => row.length > 0)
      .flatMap((row, index) => (index > 0 && row.includes(glyph) ? [index] : []))

  test('scrolling to a mark puts the thumb beside it', async () => {
    const t = await open(await wrappedRepo(150))
    const mark = rowsOf(t, '▎')[0]!

    await press(t, input => input.pressKey('g', { ctrl: true }))
    await press(t, input => void input.typeText('150'))
    await press(t, input => input.pressEnter())
    await settle(t, 300)

    const thumb = rowsOf(t, '█')
    expect(thumb.length).toBeGreaterThan(0)
    expect(Math.min(...thumb.map(row => Math.abs(row - mark)))).toBeLessThanOrEqual(2)
  }, 30000)

  test('a change near the end is marked near the end', async () => {
    const t = await open(await wrappedRepo(290))
    const rows = t
      .captureCharFrame()
      .split('\n')
      .filter(row => row.length > 0)
    const mark = rowsOf(t, '▎')[0]!

    expect(mark).toBeGreaterThan(rows.length * 0.8)
  }, 30000)
})
