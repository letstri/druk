import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, settle, until } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

const ESC = String.fromCharCode(27)
// Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07).
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

function button(t: Harness) {
  for (const [y, row] of t.captureCharFrame().split('\n').entries()) {
    const x = row.indexOf('▴')
    if (x >= 0) return { x, y }
  }
  return null
}

const files = { 'a.ts': 'const a = 1\n', 'src/deep/b.ts': 'const b = 2\n' }

describe('the file tree collapses everything', () => {
  test('the header button appears once a folder is open, and shuts it', async () => {
    const t = await launch(fixture(files))
    expect(button(t)).toBeNull()

    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressArrow('right'))
    await until(t, () => t.captureCharFrame().includes('deep'))

    const at = button(t)!
    await press(t, () => void t.mockMouse.click(at.x, at.y))

    expect(t.captureCharFrame()).not.toContain('deep')
    expect(t.captureCharFrame()).toContain('a.ts')
    expect(button(t)).toBeNull()
  })

  test('the palette runs it, and the cursor walks out of what it folded', async () => {
    const t = await launch(fixture(files))
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressArrow('right'))
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressArrow('right'))
    await until(t, () => t.captureCharFrame().includes('b.ts'))

    await runCommand(t, 'Collapse folders in sidebar')
    await settle(t)

    expect(t.captureCharFrame()).not.toContain('b.ts')
    await press(t, i => i.pressArrow('right'))
    expect(t.captureCharFrame()).toContain('deep')
  })
})

describe('the source-control panel collapses everything', () => {
  function repo() {
    const dir = fixture({ 'src/app/one.ts': 'before\n', 'src/ui/two.ts': 'before\n' })
    initRepo(dir)
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'init')
    writeFileSync(join(dir, 'src/app/one.ts'), 'after\n')
    writeFileSync(join(dir, 'src/ui/two.ts'), 'after\n')
    return dir
  }

  test('the button folds every folder row', async () => {
    const t = await launch(repo(), {}, { width: 100, height: 24 })
    await press(t, i => void i.pressKeys([TOGGLE]))
    await until(t, () => t.captureCharFrame().includes('one.ts'))

    const at = button(t)!
    await press(t, () => void t.mockMouse.click(at.x, at.y))

    const sidebar = t
      .captureCharFrame()
      .split('\n')
      .map(row => row.slice(0, 30))
      .join('\n')
    expect(sidebar).not.toContain('one.ts')
    expect(sidebar).not.toContain('two.ts')
    expect(sidebar).toContain('src')
    expect(button(t)).toBeNull()
  })
})
