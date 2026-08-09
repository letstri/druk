import { expect } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testRender } from '@opentui/solid'

import { MARKET_DIR } from '../scripts/extensions'
import { App } from '../src/app/App'
import { DEFAULTS } from '../src/core/config'
import type { Config } from '../src/core/config'
import { loadExtensions } from '../src/extensions'

export type Harness = Awaited<ReturnType<typeof launch>>

/**
 * Register every extension in this repository's market folder — the themes, icon
 * sets and language servers druk used to ship in `src/`. The market folder has
 * the same shape as an extensions folder, so the loader reads it as one.
 *
 * Call it at the top of a file whose subject is one of those themes; it is
 * module state, so it lasts for that file's process and no further.
 */
export function loadMarketExtensions(): void {
  // The config home stands in for a project root: only `<rootDir>/.druk/extensions`
  // is read off it, and a temp directory per call is litter the suite does not
  // need — it already leaves one per fixture.
  loadExtensions(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)
}

/**
 * Every harness `launch()` has handed out and not yet destroyed. `App` opens fs
 * watchers and git-polling timers in `onMount`, which only close via Solid's
 * `onCleanup` — itself only wired to run on `renderer.destroy()`. Without this,
 * an undisposed harness keeps watching and polling for the rest of the worker
 * process's life: `test/setup.ts` sweeps this list in a global `afterEach` so a
 * file with many `launch()` calls (some run into the teens) doesn't pile up
 * dozens of live watchers and stall every test after it.
 */
export const liveHarnesses = new Set<Harness>()

/**
 * Every fixture this process made, deleted when it exits.
 *
 * A run of the suite creates some three thousand of these, and nothing used to
 * remove them: after a few dozen runs the temp folder held ~100k directories and
 * every `mkdtemp` in it slowed down, until whole test files started timing out
 * and being killed. `test/setup.ts` empties this in a global `afterAll` — once
 * per file rather than per test, since a file may hand one fixture to several.
 */
export const fixtures = new Set<string>()

/** Temp project used by a test. `files` maps relative paths to contents. */
export function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  fixtures.add(dir)
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
  /** Terminal size, for anything that has to degrade on a small screen. */
  size: { width?: number; height?: number } = {},
  /** `openFile` renders single-file mode, as `druk <file>` does. */
  options: {
    openFile?: string
    openLine?: number
    openCol?: number
    checkUpdates?: boolean
    /** Encode keys as the kitty protocol, which is what a modern terminal sends. */
    kittyKeyboard?: boolean
  } = {},
) {
  const t = await testRender(
    () =>
      App({
        rootDir: dir,
        openFile: options.openFile ?? null,
        openLine: options.openLine ?? null,
        openCol: options.openCol ?? null,
        // LSP is off unless a test opts in: the default would spawn whatever
        // real language server the machine has on PATH, per launch. The install
        // offer is off for a sharper reason — it is a modal, so on a machine
        // without the server it would swallow the keys a test is sending. Theme
        // sync is off because on, the machine's own light/dark setting would
        // decide which theme every test renders in.
        initialConfig: {
          ...DEFAULTS,
          lsp: false,
          lspAutoInstall: false,
          themeSync: false,
          // Off for the same reason as the install offer above: on, a file whose
          // language has no extension would reach for the market — a real request,
          // and then a modal over whatever the test was doing.
          extensionUpdates: false,
          ...config,
        },
        // Off by default: the real check is unconditional, and without this every
        // launch in the suite would hit the npm registry.
        checkUpdates: options.checkUpdates ?? false,
      }),
    {
      width: size.width ?? 80,
      height: size.height ?? 20,
      kittyKeyboard: options.kittyKeyboard ?? false,
      // Mirror src/index.tsx. OpenTUI defaults this on and tears the renderer down
      // itself, so without it a Ctrl+C test measures the harness, not the app.
      exitOnCtrlC: false,
    },
  )
  await settle(t)
  liveHarnesses.add(t)
  return t
}

/**
 * The reconciler flushes on a macrotask, so a frame captured immediately after
 * an event still shows the previous state. Yield before rendering.
 */
export async function settle(
  t: { flush: () => Promise<void> },
  /** Wait longer when something debounced (a scan, the watcher) has to fire first. */
  waitMs = 0,
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, waitMs))
  await t.flush()
}

/** Send keys, then let the reconciler catch up. */
export async function press(t: Harness, action: (input: Harness['mockInput']) => void) {
  action(t.mockInput)
  await settle(t)
}

/**
 * Repeat one key `times` and flush once, the way a held-down key arrives. A flush
 * per key costs a macrotask each, which is seconds over a scroll of a long file —
 * enough on a loaded parallel run to blow the 5s per-test budget.
 */
export async function pressTimes(
  t: Harness,
  times: number,
  action: (input: Harness['mockInput']) => void,
) {
  for (let n = 0; n < times; n++) action(t.mockInput)
  await settle(t)
}

/**
 * Open `name` through Ctrl+O, which pins a permanent tab where a tree click would
 * only reuse the preview one. The three keys go in on one flush: the picker
 * filters off the signal, not off the frame.
 */
export async function openFile(t: Harness, name: string) {
  t.mockInput.pressKey('o', { ctrl: true })
  t.mockInput.typeText(name)
  t.mockInput.pressEnter()
  await settle(t)
}

/**
 * Render until `cond` holds, then assert it did.
 *
 * Anything asynchronous the app does — the watcher's debounce, a git read, the
 * highlight pass — used to be waited out with a fixed `settle(t, 400)` or worse,
 * which has to be long enough for the slowest machine and is paid in full on
 * every run. Polling costs what the wait actually takes.
 */
export async function until(t: Harness, cond: () => boolean, timeoutMs = 4000) {
  const started = Date.now()
  while (!cond() && Date.now() - started < timeoutMs) await settle(t, 15)
  expect(cond()).toBe(true)
}

/** `until`, on the rendered frame. */
export function untilFrame(t: Harness, text: string, timeoutMs?: number) {
  return until(t, () => t.captureCharFrame().includes(text), timeoutMs)
}

/** `untilFrame`'s opposite: wait for something on screen to go away. */
export function untilGone(t: Harness, text: string, timeoutMs?: number) {
  return until(t, () => !t.captureCharFrame().includes(text), timeoutMs)
}

/**
 * Escape is the prefix of every arrow/function-key sequence, so the terminal
 * parser holds it until it knows no sequence follows. Real typing supplies that
 * gap; tests have to wait for it explicitly.
 */
export async function pressEscape(t: Harness) {
  t.mockInput.pressEscape()
  await new Promise(resolve => setTimeout(resolve, 60))
  await settle(t)
}

/** F1 as the terminal sends it (SS3 P) — the palette key that works everywhere. */
export const F1 = '\u001BOP'

export async function openPalette(t: Harness) {
  await press(t, input => void input.pressKeys([F1]))
}

/** Run a palette leaf by typing enough of its label to select it. */
export async function runCommand(t: Harness, label: string) {
  await openPalette(t)
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

/**
 * Show the diff for the `row`-th changed file. The source-control panel is the
 * only way to one: its cursor pages through the changes, so the arrows are what
 * a test uses to reach the second file, exactly as a user would.
 */
export async function openDiff(t: Harness, row = 0) {
  await runCommand(t, 'Source control')
  // The panel nests changes under headings and folder rows, so which row holds
  // the first file is not knowable from here — the arrows are what walks past
  // them, and they diff whatever file they land on. The panel opens on the first
  // change without diffing it, so ↓ and back up is the landing on that row.
  // Enter is deliberately not used: on a folder row it would fold it away.
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

/** The diff page's header row, or '' while no page is up: the `+N −M` counts are
 * drawn on it and nowhere else, so they say both that a page is open and which. */
function header(t: Harness): string {
  return (
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('−')) ?? ''
  )
}

/** Enter branch comparison from the source-control panel. */
export async function openComparison(t: Harness) {
  await runCommand(t, 'Source control')
  await press(t, input => input.pressKey('b', { shift: true }))
  await untilFrame(t, 'compare')
}

/** Open the settings page, step the `label` row's value once, close the page. */
export async function toggleSetting(t: Harness, label: string) {
  await runCommand(t, 'Settings')
  // Walk the selection down until the marker sits on the wanted row. The bound is
  // "more rows than the page has", not a row index — every setting added pushes
  // the ones below it further down, and a bound that only just reached the last
  // section fails the day one is inserted above it.
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
