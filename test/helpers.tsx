import { expect } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RGBA } from '@opentui/core'
import { testRender } from '@opentui/solid'

import { MARKET_DIR } from '../scripts/extensions'
import { Root } from '../src/app/Root'
import { DEFAULTS } from '../src/core/config'
import type { Config } from '../src/core/config'
import { loadExtensions } from '../src/extensions'
import { tempDir } from './temp'

export type Harness = Awaited<ReturnType<typeof launch>>

export function loadMarketExtensions(): void {
  loadExtensions(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)
}

// An undestroyed harness keeps `App`'s fs watchers and git timers alive for the process.
export const liveHarnesses = new Set<Harness>()

export function fixture(files: Record<string, string>): string {
  const dir = tempDir()
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

export async function launch(
  dir: string,
  config: Partial<Config> = {},
  size: { width?: number; height?: number } = {},
  options: {
    openFile?: string
    openLine?: number
    openCol?: number
    checkUpdates?: boolean
    kittyKeyboard?: boolean
  } = {},
) {
  const t = await testRender(
    () =>
      Root({
        rootDir: dir,
        openFile: options.openFile ?? null,
        openLine: options.openLine ?? null,
        openCol: options.openCol ?? null,
        initialConfig: {
          ...DEFAULTS,
          lsp: false,
          lspAutoInstall: false,
          themeSync: false,
          extensionUpdates: false,
          ...config,
        },
        checkUpdates: options.checkUpdates ?? false,
      }),
    {
      width: size.width ?? 80,
      height: size.height ?? 20,
      kittyKeyboard: options.kittyKeyboard ?? false,
      exitOnCtrlC: false,
    },
  )
  await settle(t)
  liveHarnesses.add(t)
  return t
}

// The reconciler flushes on a macrotask: a frame captured straight after an event is stale.
export async function settle(t: { flush: () => Promise<void> }, waitMs = 0): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, waitMs))
  await t.flush()
}

export async function press(t: Harness, action: (input: Harness['mockInput']) => void) {
  action(t.mockInput)
  await settle(t)
}

export async function pressTimes(
  t: Harness,
  times: number,
  action: (input: Harness['mockInput']) => void,
) {
  for (let n = 0; n < times; n++) action(t.mockInput)
  await settle(t)
}

export async function openFile(t: Harness, name: string) {
  t.mockInput.pressKey('o', { ctrl: true })
  t.mockInput.typeText(name)
  t.mockInput.pressEnter()
  await settle(t)
}

export async function until(t: Harness, cond: () => boolean, timeoutMs = 4000) {
  const started = Date.now()
  while (!cond() && Date.now() - started < timeoutMs) await settle(t, 15)
  expect(cond()).toBe(true)
}

export function spansOf(t: Harness, text: string): { text: string; fg: string; bg: string }[] {
  const hex = (c: RGBA) =>
    [c.buffer[0], c.buffer[1], c.buffer[2]]
      .map(v => (v ?? 0).toString(16).padStart(2, '0'))
      .join('')
  const line = t.captureSpans().lines.find(row =>
    row.spans
      .map(span => span.text)
      .join('')
      .includes(text),
  )
  return (line?.spans ?? []).map(span => ({
    text: span.text,
    fg: hex(span.fg),
    bg: hex(span.bg),
  }))
}

export function untilFrame(t: Harness, text: string, timeoutMs?: number) {
  return until(t, () => t.captureCharFrame().includes(text), timeoutMs)
}

export function untilGone(t: Harness, text: string, timeoutMs?: number) {
  return until(t, () => !t.captureCharFrame().includes(text), timeoutMs)
}

// Esc is the prefix of every arrow/function-key sequence, so the parser holds it.
export async function pressEscape(t: Harness) {
  t.mockInput.pressEscape()
  await new Promise(resolve => setTimeout(resolve, 60))
  await settle(t)
}

// F1 as the terminal sends it (SS3 P).
export const F1 = '\u001BOP'

export async function openPalette(t: Harness) {
  await press(t, input => void input.pressKeys([F1]))
}

export async function runCommand(t: Harness, label: string) {
  await openPalette(t)
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

export async function openDiff(t: Harness, row = 0) {
  await runCommand(t, 'Source control')
  // Not Enter: on a folder row it folds instead; ↓ then ↑ lands on the first, undiffed row.
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressArrow('up'))
  let seen = header(t) ? 0 : -1
  let shown = header(t)
  for (let step = 0; seen < row && step < 60; step++) {
    await press(t, input => input.pressArrow('down'))
    const now = header(t)
    if (now && now !== shown) {
      shown = now
      seen++
    }
  }
}

function header(t: Harness): string {
  return (
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('−')) ?? ''
  )
}

export async function openComparison(t: Harness) {
  await runCommand(t, 'Source control')
  await press(t, input => input.pressKey('b', { shift: true }))
  await untilFrame(t, 'compare')
}

export async function toggleSetting(t: Harness, label: string) {
  await runCommand(t, 'Settings')
  // A bound, not a row index: every setting added moves the rows under it.
  for (let i = 0; i < 60; i++) {
    const row = t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes(label))
    if (row?.includes('▌')) break
    await press(t, input => input.pressArrow('down'))
  }
  await press(t, input => input.pressEnter())
  await pressEscape(t)
}
