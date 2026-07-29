/**
 * User settings, persisted as JSON at `$XDG_CONFIG_HOME/druk/config.json`
 * (default `~/.config/druk/config.json`).
 *
 * To add a setting: add the field to `Config`, give it a value in `DEFAULTS`,
 * and validate it in `parse()`. Anything missing or invalid falls back to the
 * default, so a hand-edited config can never break startup.
 */
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { isThemeName } from '../themes'
import type { ThemeName } from '../themes'

export const CONFIG_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'),
  'druk',
  'config.json',
)

/** Narrow enough to still show a name, wide enough to leave the editor usable. */
export const SIDEBAR_MIN = 15
export const SIDEBAR_MAX = 80

/**
 * `'auto'`: this share of the terminal, within these bounds. The floor is what an
 * 80-column window gets, so the automatic width only ever grows from what a fixed
 * default gave — a flat 30 columns is fine there and cramped at 200, where two
 * columns per nesting level leave a deep path almost nothing for its name.
 */
const AUTO_SHARE = 0.25
const AUTO_MIN = 30
const AUTO_MAX = 60

export function sidebarColumns(width: number | 'auto', terminalWidth: number): number {
  if (width !== 'auto') return width
  return Math.max(AUTO_MIN, Math.min(AUTO_MAX, Math.round(terminalWidth * AUTO_SHARE)))
}

export interface Config {
  /** Color scheme id — see src/themes. */
  theme: ThemeName
  /** Modal editing (normal / insert / visual). */
  vim: boolean
  /**
   * Keymap preset. `'vscode'` gives Ctrl+P to the file picker, as VS Code does,
   * and moves the command palette to F1 / Ctrl+Shift+P.
   */
  keybindings: 'default' | 'vscode'
  /**
   * Columns per indent level for space indentation — the Tab key and the guides.
   * A literal tab is two columns whatever this says: OpenTUI's renderer fixes that
   * width and exposes no setting for it.
   */
  tabSize: number
  /**
   * Columns the file tree occupies, or `'auto'` for a share of the terminal —
   * a fixed default is either cramped on a wide screen or greedy on a narrow one.
   * Resizing with `[` / `]` or by dragging the divider pins an explicit number.
   */
  sidebarWidth: number | 'auto'
  /** Version whose update notice was dismissed; suppresses the banner for it. */
  skipUpdate: string
  /** On save: strip trailing spaces and end the file with one newline. */
  trimOnSave: boolean
  /** Save every dirty buffer when the terminal window loses focus. */
  autoSaveOnBlur: boolean
  /** How the diff view renders: one column of +/- rows, or two side by side. */
  diffView: 'inline' | 'split'
}

export const DEFAULTS: Config = {
  theme: 'dark',
  vim: false,
  keybindings: 'default',
  tabSize: 2,
  sidebarWidth: 'auto',
  skipUpdate: '',
  trimOnSave: false,
  autoSaveOnBlur: false,
  diffView: 'inline',
}

function parse(raw: unknown): Config {
  const obj = (raw ?? {}) as Partial<Record<keyof Config, unknown>>
  return {
    theme: isThemeName(obj.theme) ? obj.theme : DEFAULTS.theme,
    vim: typeof obj.vim === 'boolean' ? obj.vim : DEFAULTS.vim,
    keybindings: obj.keybindings === 'vscode' ? 'vscode' : DEFAULTS.keybindings,
    tabSize:
      typeof obj.tabSize === 'number' && obj.tabSize >= 1 && obj.tabSize <= 16
        ? Math.floor(obj.tabSize)
        : DEFAULTS.tabSize,
    skipUpdate: typeof obj.skipUpdate === 'string' ? obj.skipUpdate : DEFAULTS.skipUpdate,
    trimOnSave: typeof obj.trimOnSave === 'boolean' ? obj.trimOnSave : DEFAULTS.trimOnSave,
    autoSaveOnBlur:
      typeof obj.autoSaveOnBlur === 'boolean' ? obj.autoSaveOnBlur : DEFAULTS.autoSaveOnBlur,
    diffView:
      obj.diffView === 'split' || obj.diffView === 'inline' ? obj.diffView : DEFAULTS.diffView,
    sidebarWidth:
      typeof obj.sidebarWidth === 'number' &&
      obj.sidebarWidth >= SIDEBAR_MIN &&
      obj.sidebarWidth <= SIDEBAR_MAX
        ? Math.floor(obj.sidebarWidth)
        : // Anything else, `'auto'` included, is the default.
          DEFAULTS.sidebarWidth,
  }
}

/** Read the config file, falling back to defaults on any error or bad value. */
export function loadConfig(): Config {
  try {
    return parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(config: Config): void {
  try {
    fs.mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — running without a writable home just means no persistence
  }
}
