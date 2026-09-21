import { expect, test, afterAll } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, setTransparency, THEMES } from '../src/themes'
import {
  fixture,
  launch,
  openDiff,
  openFile,
  openPalette,
  settle,
  toggleSetting,
} from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'

interface Span {
  text: string
  bg?: { buffer: Record<string, number> }
}

function bgAlpha(t: Harness, text: string): number {
  const { lines } = t.captureSpans() as unknown as {
    lines: { spans: Span[] }[]
  }
  for (const line of lines) {
    const span = line.spans.find((s) => s.text.includes(text))
    if (span) {
      return span.bg?.buffer['3'] ?? -1
    }
  }
  throw new Error(`no span showing ${JSON.stringify(text)}`)
}

// The theme store is module-global and outlives a harness.
afterAll(() => {
  setTransparency(false)
  setTheme('dark')
  invalidateSyntaxStyle()
})

test('transparency leaves the editor unpainted, and off paints it', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })

  const opaque = await launch(dir)
  await openFile(opaque, 'a.ts')
  expect(bgAlpha(opaque, 'const')).toBe(255)

  const clear = await launch(dir, { transparent: true })
  await openFile(clear, 'a.ts')
  expect(bgAlpha(clear, 'const')).toBe(0)
})

test('transparency never empties a floating panel', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    transparent: true,
  })
  await openFile(t, 'a.ts')
  await openPalette(t)
  expect(bgAlpha(t, 'Open file')).toBe(255)
})

test('the settings page toggles transparency, and a launch starts from its own config', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir)
  await openFile(t, 'a.ts')

  await toggleSetting(t, 'Transparent')
  expect(bgAlpha(t, 'const')).toBe(0)

  const reopened = await launch(dir, { transparent: false })
  await openFile(reopened, 'a.ts')
  expect(bgAlpha(reopened, 'const')).toBe(255)
})

test('the diff page stays painted — it is a layer over the editor', async () => {
  const dir = fixture({ 'a.ts': 'alpha\n' })
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd: dir })
    if (run.exitCode !== 0) {
      throw new Error(run.stderr.toString())
    }
  }
  initRepo(dir)
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')

  const t = await launch(dir, { transparent: true })
  await openDiff(t)
  expect(bgAlpha(t, 'alpha changed')).toBe(255)
})

test('a theme switch keeps transparency on', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    transparent: true,
  })
  await openFile(t, 'a.ts')
  setTheme('light')
  await settle(t)
  expect(bgAlpha(t, 'const')).toBe(0)
  expect(THEMES.light.ui.bg).not.toBe('transparent')
})

test('a modal over a transparent editor leaves the editor unpainted', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
    transparent: true,
  })
  await openFile(t, 'a.ts')
  await openPalette(t)
  expect(bgAlpha(t, 'EXPLORER')).toBe(0)

  const painted = (
    t.captureSpans() as unknown as { lines: { spans: Span[] }[] }
  ).lines
    .flatMap((line) => line.spans)
    .filter((span) => {
      const bg = span.bg?.buffer
      return (
        bg?.['3'] === 255 && bg['0'] === 0 && bg['1'] === 0 && bg['2'] === 0
      )
    })
  expect(painted).toEqual([])
})
