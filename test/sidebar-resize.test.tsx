import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SIDEBAR_MIN } from '../src/core/config'
import { ui } from '../src/themes'
import { fixture, launch, openFile, press, pressEscape, runCommand, settle } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

const PROJECT = { 'alpha.ts': 'const a = 1\n', 'beta.ts': 'const b = 2\n' }

interface Span {
  text: string
  bg?: { buffer: Uint8Array }
}

const hex = (bg: Span['bg']) =>
  bg ? `#${Array.from(bg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}` : ''

function dividerAt(t: Harness): number {
  const frame = t.captureSpans() as unknown as { lines: { spans: Span[] }[] }
  const panel = ui.panelBg.toLowerCase()
  for (const line of frame.lines) {
    if (hex(line.spans[0]?.bg) !== panel) continue
    let column = 0
    for (const span of line.spans) {
      if (hex(span.bg) !== panel) return column
      column += span.text.length
    }
  }
  return -1
}

describe('resizing the sidebar', () => {
  test('] widens it and [ narrows it, from the tree', async () => {
    const t = await launch(fixture(PROJECT))
    const start = dividerAt(t)
    expect(start).toBeGreaterThan(0)

    await press(t, input => void input.typeText(']'))
    await settle(t)
    const wider = dividerAt(t)
    expect(wider).toBeGreaterThan(start)

    await press(t, input => void input.typeText('['))
    await press(t, input => void input.typeText('['))
    await settle(t)
    expect(dividerAt(t)).toBeLessThan(wider)
  })

  test('dragging the divider sets the width to the pointer', async () => {
    const t = await launch(fixture(PROJECT))
    expect(dividerAt(t)).toBe(30)

    await t.mockMouse.drag(dividerAt(t), 5, 44, 5)
    await settle(t)
    expect(dividerAt(t)).toBe(44)

    await t.mockMouse.drag(dividerAt(t), 5, 22, 5)
    await settle(t)
    expect(dividerAt(t)).toBe(22)
  })

  test('it will not collapse past the minimum', async () => {
    const t = await launch(fixture(PROJECT))
    await t.mockMouse.drag(dividerAt(t), 5, 2, 5)
    await settle(t)
    expect(dividerAt(t)).toBe(SIDEBAR_MIN)
  })

  test('a width saved on a wider screen is clamped to fit this one', async () => {
    const t = await launch(fixture(PROJECT), { sidebarWidth: 200 })
    const at = dividerAt(t)
    expect(at).toBeGreaterThanOrEqual(SIDEBAR_MIN)
    expect(at).toBeLessThanOrEqual(60)
  })

  test('the handle is a short grip, centred, not a rule down the whole edge', async () => {
    const t = await launch(fixture(PROJECT))
    const at = dividerAt(t)
    expect(at).toBe(30)

    const column = t
      .captureCharFrame()
      .split('\n')
      .filter(row => row.length > 0)
      .slice(1, -1)
      .map(row => row[at] ?? ' ')

    const drawn = column.filter(glyph => glyph === '│').length
    expect(drawn).toBeGreaterThanOrEqual(3)
    expect(drawn).toBeLessThan(column.length)
    const first = column.indexOf('│')
    expect(column.slice(first, first + drawn).every(glyph => glyph === '│')).toBe(true)
    expect(Math.abs(first - (column.length - first - drawn))).toBeLessThanOrEqual(1)
  })

  test('the grip itself drags too, not only the bare column', async () => {
    const t = await launch(fixture(PROJECT))
    const at = dividerAt(t)
    const rows = t.captureCharFrame().split('\n')
    const grip = rows.findIndex(row => row[at] === '│')
    expect(grip).toBeGreaterThan(0)

    await t.mockMouse.drag(at, grip, 40, grip)
    await settle(t)
    expect(dividerAt(t)).toBe(40)
  })

  test('the whole column drags, not only the part that is drawn', async () => {
    const t = await launch(fixture(PROJECT))
    const at = dividerAt(t)

    await t.mockMouse.drag(at, 1, 40, 1)
    await settle(t)
    expect(dividerAt(t)).toBe(40)
  })

  test('the tree still works at the new width', async () => {
    const t = await launch(fixture(PROJECT))
    await t.mockMouse.drag(dividerAt(t), 5, 20, 5)
    await settle(t)

    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressEnter())
    expect(t.captureCharFrame()).toContain('const a = 1')
  })
})

function sidebarStart(t: Harness): number {
  const frame = t.captureSpans() as unknown as { lines: { spans: Span[] }[] }
  const panel = ui.panelBg.toLowerCase()
  for (const line of frame.lines) {
    let column = 0
    let start = -1
    for (const span of line.spans) {
      if (hex(span.bg) === panel) {
        if (start < 0) start = column
      } else if (start >= 0) {
        start = -1
      }
      column += span.text.length
    }
    if (start > 0) return start
  }
  return -1
}

describe('sidebar on the right', () => {
  test('the panel sits at the terminal edge, past the editor', async () => {
    const t = await launch(fixture(PROJECT), { sidebarPosition: 'right', sidebarWidth: 30 })
    expect(sidebarStart(t)).toBe(50)
    expect(dividerAt(t)).toBe(-1)
  })

  test('the palette command moves it to the other edge and back', async () => {
    const t = await launch(fixture(PROJECT), { sidebarWidth: 30 })
    expect(dividerAt(t)).toBe(30)
    expect(sidebarStart(t)).toBe(-1)

    await runCommand(t, 'Toggle sidebar position')
    expect(dividerAt(t)).toBe(-1)
    expect(sidebarStart(t)).toBe(50)

    await runCommand(t, 'Toggle sidebar position')
    expect(dividerAt(t)).toBe(30)
    expect(sidebarStart(t)).toBe(-1)
  })

  test('flipping the settings row moves the panel on screen', async () => {
    const t = await launch(fixture(PROJECT), { sidebarWidth: 30 })
    expect(dividerAt(t)).toBe(30)

    await runCommand(t, 'Settings')
    let onRow = false
    for (let step = 0; step < 40; step++) {
      const row = t
        .captureCharFrame()
        .split('\n')
        .find(line => line.includes('Sidebar position'))
      if (row?.includes('▌')) {
        onRow = true
        break
      }
      await press(t, i => i.pressArrow('down'))
    }
    expect(onRow).toBe(true)
    await press(t, i => i.pressArrow('right'))
    await pressEscape(t)
    await settle(t)

    expect(dividerAt(t)).toBe(-1)
    expect(sidebarStart(t)).toBe(50)
  })

  test('dragging the divider sets the width from the right edge', async () => {
    const t = await launch(fixture(PROJECT), { sidebarPosition: 'right', sidebarWidth: 30 })
    expect(sidebarStart(t)).toBe(50)

    await t.mockMouse.drag(sidebarStart(t) - 1, 5, 39, 5)
    await settle(t)
    expect(sidebarStart(t)).toBe(40)

    await t.mockMouse.drag(sidebarStart(t) - 1, 5, 57, 5)
    await settle(t)
    expect(sidebarStart(t)).toBe(58)
  })

  test('] and [ still widen and narrow from the tree', async () => {
    const t = await launch(fixture(PROJECT), { sidebarPosition: 'right', sidebarWidth: 30 })
    const start = sidebarStart(t)

    await press(t, input => void input.typeText(']'))
    await settle(t)
    const wider = sidebarStart(t)
    expect(wider).toBeLessThan(start)

    await press(t, input => void input.typeText('['))
    await press(t, input => void input.typeText('['))
    await settle(t)
    expect(sidebarStart(t)).toBeGreaterThan(wider)
  })
})

describe('what must not move when the sidebar does', () => {
  test('the tab bar stays inside the editor column, whatever the sidebar takes', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 8; i++) files[`file-number-${i}.ts`] = `const a${i} = 1\n`
    const t = await launch(fixture(files))
    for (let i = 0; i < 5; i++) {
      await openFile(t, `file-number-${i}.ts`)
    }
    await settle(t)

    const stripStart = (t: Harness) => t.captureCharFrame().split('\n')[0]!.indexOf('←')

    await t.mockMouse.drag(dividerAt(t), 5, 50, 5)
    await settle(t)
    expect(stripStart(t)).toBeGreaterThan(dividerAt(t))

    await t.mockMouse.drag(dividerAt(t), 5, 20, 5)
    await settle(t)
    expect(stripStart(t)).toBeGreaterThan(dividerAt(t))
    expect(t.captureCharFrame().split('\n')[0]).toContain('file-number-4.ts')
  })

  test('git marks line up at the panel edge, and follow it on a resize', async () => {
    const dir = tempDir('druk-marks-')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
    initRepo(dir)
    writeFileSync(join(dir, 'tracked.ts'), 'const a = 1\n')
    writeFileSync(join(dir, 'a-much-longer-name.ts'), 'const b = 2\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    writeFileSync(join(dir, 'tracked.ts'), 'changed\n')
    writeFileSync(join(dir, 'fresh.ts'), 'new\n')

    const t = await launch(dir)
    await settle(t)

    const markColumns = () =>
      t
        .captureCharFrame()
        .split('\n')
        .map(row => Math.max(row.indexOf(' U '), row.indexOf(' M ')))
        .filter(at => at >= 0)

    const before = markColumns()
    expect(before.length).toBe(2)
    expect(new Set(before).size).toBe(1)
    expect(before[0]).toBeGreaterThan(dividerAt(t) - 4)

    await t.mockMouse.drag(dividerAt(t), 5, 46, 5)
    await settle(t)
    const after = markColumns()
    expect(new Set(after).size).toBe(1)
    expect(after[0]).toBeGreaterThan(before[0]!)
    expect(after[0]).toBeGreaterThan(dividerAt(t) - 4)
  })
})

describe('rows hold their shape when names overflow', () => {
  const NAMES = {
    'tests/b.ts': 'x\n',
    'tests/config.ts': 'x\n',
    'tests/ctrl-c-really-long-name.ts': 'x\n',
    'tests/deeply-long-filename-here.ts': 'x\n',
  }

  const nameColumns = (t: Harness) =>
    t
      .captureCharFrame()
      .split('\n')
      .map(row => row.slice(0, 16))
      .filter(row => /^\s+[a-z]/.test(row))
      .map(row => row.search(/\S/))

  test('a name starts at one column whatever the names do', async () => {
    const t = await launch(fixture(NAMES), { sidebarWidth: 22 })
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressEnter())
    await settle(t)

    expect(new Set(nameColumns(t)).size).toBe(1)
  })

  test('and keeps that column across a resize', async () => {
    const t = await launch(fixture(NAMES), { sidebarWidth: 22 })
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressEnter())
    await settle(t)
    const before = nameColumns(t)

    await t.mockMouse.drag(dividerAt(t), 5, 40, 5)
    await settle(t)
    expect(nameColumns(t)).toEqual(before)

    await t.mockMouse.drag(dividerAt(t), 5, 18, 5)
    await settle(t)
    expect(nameColumns(t)).toEqual(before)
  })
})

describe('the automatic default width', () => {
  test('is unchanged on an 80-column terminal', async () => {
    const t = await launch(fixture(PROJECT))
    expect(dividerAt(t)).toBe(30)
  })

  test('grows with the terminal', async () => {
    const wide = await launch(fixture(PROJECT), {}, { width: 200 })
    expect(dividerAt(wide)).toBeGreaterThan(30)

    const wider = await launch(fixture(PROJECT), {}, { width: 240 })
    expect(dividerAt(wider)).toBeGreaterThan(dividerAt(wide))
  })

  test('never takes more than the editor can spare', async () => {
    const t = await launch(fixture(PROJECT), {}, { width: 200 })
    expect(dividerAt(t)).toBeLessThan(100)
  })

  test('an explicit width wins over it, and resizing pins one', async () => {
    const t = await launch(fixture(PROJECT), { sidebarWidth: 22 }, { width: 200 })
    expect(dividerAt(t)).toBe(22)

    const auto = await launch(fixture(PROJECT), {}, { width: 200 })
    const before = dividerAt(auto)
    await press(auto, input => void input.typeText(']'))
    await settle(auto)
    expect(dividerAt(auto)).toBe(before + 2)
  })
})
