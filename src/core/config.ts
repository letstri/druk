/**
 * Settings in two layers, as VS Code has them: the user's own, persisted at
 * `$XDG_CONFIG_HOME/druk/config.json` (default `~/.config/druk/config.json`),
 * and per-project overrides in `<project>/.druk/settings.json`.
 *
 * To add a setting: add the field to `Config`, give it a value in `DEFAULTS`,
 * and validate it in `VALIDATORS`. Anything missing or invalid falls back to the
 * default, so a hand-edited config can never break startup.
 *
 * A missing key means different things in the two files, and that is the whole
 * reason validation is a per-key table rather than one `parse`. The user file
 * holds every setting and is rewritten whole; the project file holds only what it
 * overrides, so `parsePartial` has to leave an unmentioned key *absent* instead of
 * filling in the default — the user's value is what fills that gap, in
 * `resolveConfig`.
 */
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { isIconThemeName, NO_ICONS } from '../icons'
import { isThemeName } from '../themes'
import type { ThemeName } from '../themes'
import { FORGE_KINDS } from './forge'
import type { ForgeSetting } from './forge'
import { MARKET_URL } from './market'
import { DEFAULT_SCAN_DEPTH } from './repos'

export const CONFIG_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'),
  'druk',
  'config.json',
)

/** Which of the two files a setting is read from or written to. */
export type ConfigScope = 'user' | 'project'

/** Project overrides live beside the project, the way `.vscode/` does. */
export const PROJECT_CONFIG_DIR = '.druk'

export const projectConfigFile = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'settings.json')

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

/**
 * The caret shapes OpenTUI draws. Its fourth, `default`, is left out: it defers to
 * whatever the terminal was already set to, which is not a choice a settings row
 * could show a value for.
 */
export const CURSOR_STYLES = ['block', 'line', 'underline'] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]

export interface Config {
  /** Color scheme id — see src/themes. */
  theme: ThemeName
  /**
   * Follow the OS light/dark appearance: `themeLight` and `themeDark` take over
   * and `theme` becomes whichever of the two is on screen. Picking a theme by
   * hand turns this off, since the poll would otherwise undo the pick.
   */
  themeSync: boolean
  /** Theme used while the OS is light and `themeSync` is on. */
  themeLight: ThemeName
  /** Theme used while the OS is dark and `themeSync` is on. */
  themeDark: ThemeName
  /**
   * Leave the editor, tab strip and sidebar backgrounds unpainted, so a
   * translucent terminal shows through them. Floating panels — the palette, the
   * modals, the settings page — stay painted whatever this says: the editor
   * would otherwise read straight through them.
   */
  transparent: boolean
  /**
   * Which glyphs the file tree draws in place of the expansion arrow —
   * `'none'`, the shipped `unicode`, or one an extension contributes (`nerd-icons`
   * is the market's). `'none'` is the default because nothing can ask the
   * terminal whether its font has the glyphs a set needs.
   */
  iconTheme: string
  /** Modal editing (normal / insert / visual). */
  vim: boolean
  /**
   * Shape of the caret. Ignored while `vim` is on, where the shape is how you tell
   * normal from insert and the mode has to win.
   */
  cursorStyle: CursorStyle
  /**
   * Soft-wrap long lines at the window's edge. Off, a line past the edge is read
   * by moving the caret into it — OpenTUI scrolls the view sideways only with
   * the cursor, which is the trade for one buffer line per screen row.
   */
  wrap: boolean
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
  /** On save: run the matching `formatters` command over the file just written. */
  formatOnSave: boolean
  /**
   * Formatter commands keyed by comma-separated extensions (`"ts,tsx"`), or `"*"`
   * for any file. The saved file's path is appended, and the command must rewrite
   * the file in place — `["prettier", "--write"]`, `["eslint", "--fix"]`,
   * `["oxfmt"]`. An empty array disables its entry.
   */
  formatters: Record<string, string[]>
  /** Save every dirty buffer when the terminal window loses focus. */
  autoSaveOnBlur: boolean
  /** How the diff view renders: one column of +/- rows, or two side by side. */
  diffView: 'inline' | 'split'
  /** Source-control panel: changed files nested under folders, or one flat list
   * of paths. */
  gitPanelView: 'tree' | 'list'
  /**
   * Levels below the opened folder to look for repositories in, when the folder
   * itself is not one — a parent of checkouts (`~/code`, a folder of worktrees)
   * otherwise shows no marks at all. Every repository found costs a `git status`
   * per refresh, so 0 turns the search off and keeps druk to the single
   * repository it used to assume.
   */
  gitScanDepth: number
  /** Whether the tree lists dotfiles. The default tells the filesystem's truth. */
  showDotfiles: boolean
  /** Hide git-ignored files from the tree. Off by default for the same reason. */
  respectGitignore: boolean
  /**
   * Which forge the review panel asks for pull-request comments. `auto` reads
   * it off the remote's host name, which places github.com, gitlab.com,
   * bitbucket.org and codeberg.org — a self-hosted GitLab and a self-hosted
   * Gitea are indistinguishable from the outside, so those have to say which.
   */
  reviewForge: ForgeSetting
  /** Remote whose URL says where the pull request lives. */
  reviewRemote: string
  /**
   * Ask the forge for the pull request's comments whenever the panel is opened,
   * rather than only when `f` is pressed. Off is for a rate limit: the fetch is
   * four unauthenticated requests, and GitHub allows sixty an hour per address.
   */
  reviewAutoFetch: boolean
  /** Draw a review note's text after the end of its line, as `lspInline` does. */
  reviewInline: boolean
  /** Language servers: spawn one per language as matching files open. */
  lsp: boolean
  /** Draw the worst problem's message after the end of its line. */
  lspInline: boolean
  /** Completion menu while typing (and on Ctrl+Space). Needs `lsp` on too. */
  lspCompletion: boolean
  /**
   * Offer to install a missing server (the npm ones) when a file that wants it
   * opens. Off means the status bar prints the install line and nothing else;
   * on still asks before anything is downloaded.
   */
  lspAutoInstall: boolean
  /**
   * Which TypeScript the typescript server should drive — a path to a
   * `tsserver.js`, to a `lib` folder, or to a typescript package directory.
   * Empty leaves the choice to the server, which prefers the open project's own
   * copy and falls back to whatever druk installed.
   */
  typescriptTsdk: string
  /**
   * Per-server command override, keyed by server id — the ids are the ones the
   * installed extensions declare, since druk ships no servers of its own. An empty
   * array disables that server.
   */
  lspServers: Record<string, string[]>
  /**
   * Custom shortcuts: command id → the one chord that runs it, replacing whatever
   * it had by default (`"Ctrl+Opt+K"`). An empty value, or `"none"`, leaves the
   * command with no key at all. The bindable ids and their defaults are in
   * src/app/keymap.ts, and the settings page edits this without the ids.
   */
  keybindings: Record<string, string>
  /**
   * Extension ids to read but not register — the settings page's off switch, so a
   * extension can be shelved without deleting it. Read by `readDisabledExtensions`
   * before the rest of this file is parsed: extensions have to be loaded before a
   * theme id can be validated, and this is the one setting that decides which.
   */
  disabledExtensions: string[]
  /**
   * Read the extension market at startup: notice a newer version of an installed
   * extension, and offer the extension for a language or a theme that is missing. Off
   * means druk never asks the registry anything.
   */
  extensionUpdates: boolean
  /**
   * Where the market is served from — an https *directory* URL, under which each
   * extension is `<id>/extension.json` and the catalog is `index.json`. A fork's raw
   * URL belongs here; an extension being written is tested by dropping it straight
   * into the extensions folder instead, which needs no registry at all.
   */
  extensionRegistry: string
}

export const DEFAULTS: Config = {
  theme: 'dark',
  themeSync: true,
  themeLight: 'light',
  themeDark: 'dark',
  transparent: false,
  iconTheme: NO_ICONS,
  vim: false,
  // OpenTUI's own default, so an unset key keeps the caret druk has always drawn.
  cursorStyle: 'block',
  // On, because it always was: druk wrapped unconditionally before this was a key.
  wrap: true,
  tabSize: 2,
  sidebarWidth: 'auto',
  skipUpdate: '',
  trimOnSave: false,
  formatOnSave: false,
  formatters: {},
  autoSaveOnBlur: true,
  diffView: 'inline',
  gitPanelView: 'tree',
  gitScanDepth: DEFAULT_SCAN_DEPTH,
  showDotfiles: true,
  respectGitignore: false,
  reviewForge: 'auto',
  reviewRemote: 'origin',
  reviewAutoFetch: true,
  reviewInline: true,
  lsp: true,
  lspInline: true,
  lspCompletion: true,
  lspAutoInstall: true,
  typescriptTsdk: '',
  lspServers: {},
  keybindings: {},
  disabledExtensions: [],
  extensionUpdates: true,
  extensionRegistry: MARKET_URL,
}

/** Reads one setting out of parsed JSON; `undefined` for absent or invalid. */
type Validator<K extends keyof Config> = (raw: unknown) => Config[K] | undefined

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined)
const theme = (raw: unknown) => (isThemeName(raw) ? raw : undefined)
const text = (raw: unknown) => (typeof raw === 'string' ? raw : undefined)

/** One of a fixed set of strings — the settings whose type is a small union. */
const among =
  <T extends string>(...values: T[]) =>
  (raw: unknown): T | undefined =>
    typeof raw === 'string' ? values.find(value => value === raw) : undefined

/** A key → command-array map (`lspServers`, `formatters`). Only well-formed
 * entries survive; a malformed one must not break startup. */
const commands = (raw: unknown): Record<string, string[]> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const parsed: Record<string, string[]> = {}
  for (const [id, command] of Object.entries(raw)) {
    if (Array.isArray(command) && command.every(part => typeof part === 'string')) {
      parsed[id] = command
    }
  }
  return parsed
}

/** A list of ids (`disabledExtensions`). Anything that is not a string is dropped. */
const ids = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter(value => typeof value === 'string') : undefined

/** A key → text map (`keybindings`). Malformed entries are dropped, not fatal. */
const strings = (raw: unknown): Record<string, string> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const parsed: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'string') parsed[id] = value
  }
  return parsed
}

const VALIDATORS: { [K in keyof Config]: Validator<K> } = {
  theme,
  themeSync: bool,
  themeLight: theme,
  themeDark: theme,
  transparent: bool,
  // A registry check, like the theme above it: an icon theme an extension has since
  // been uninstalled with falls back to the default rather than drawing nothing.
  iconTheme: raw => (isIconThemeName(raw) ? raw : undefined),
  vim: bool,
  cursorStyle: among(...CURSOR_STYLES),
  wrap: bool,
  tabSize: raw => (typeof raw === 'number' && raw >= 1 && raw <= 16 ? Math.floor(raw) : undefined),
  sidebarWidth: raw => {
    if (raw === 'auto') return 'auto'
    return typeof raw === 'number' && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX
      ? Math.floor(raw)
      : undefined
  },
  skipUpdate: text,
  trimOnSave: bool,
  formatOnSave: bool,
  formatters: commands,
  autoSaveOnBlur: bool,
  diffView: among('inline', 'split'),
  gitPanelView: among('tree', 'list'),
  gitScanDepth: raw =>
    typeof raw === 'number' && raw >= 0 && raw <= 5 ? Math.floor(raw) : undefined,
  showDotfiles: bool,
  respectGitignore: bool,
  reviewForge: among('auto', ...FORGE_KINDS),
  // A remote name, so anything git would accept as one. Empty means the panel
  // has nothing to ask, which is reported when the fetch runs.
  reviewRemote: text,
  reviewAutoFetch: bool,
  reviewInline: bool,
  lsp: bool,
  lspInline: bool,
  lspCompletion: bool,
  lspAutoInstall: bool,
  typescriptTsdk: text,
  lspServers: commands,
  keybindings: strings,
  disabledExtensions: ids,
  extensionUpdates: bool,
  // https only. The registry is the one place druk reads a file someone else
  // wrote, and a plaintext one could be rewritten between here and the machine.
  extensionRegistry: raw =>
    typeof raw === 'string' && raw.startsWith('https://') ? raw : undefined,
}

const isConfigKey = (key: string): key is keyof Config => key in VALIDATORS

/** Only the settings the JSON actually carries — the shape the project file has. */
export function parsePartial(raw: unknown): Partial<Config> {
  const config: Partial<Config> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return config
  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigKey(key)) continue
    const parsed = VALIDATORS[key](value)
    if (parsed !== undefined) Object.assign(config, { [key]: parsed })
  }
  return config
}

const parse = (raw: unknown): Config => ({ ...DEFAULTS, ...parsePartial(raw) })

/**
 * The config the editor runs on: the user's, with the project's overrides on top.
 * A key the project leaves out keeps the user's value — and a key the settings
 * page has just reset is still present, holding `undefined`, so one spread is not
 * enough to drop it.
 */
export function resolveConfig(user: Config, project: Partial<Config>): Config {
  const config = { ...user }
  for (const [key, value] of Object.entries(project)) {
    if (value !== undefined) Object.assign(config, { [key]: value })
  }
  return config
}

/** Read the config file, falling back to defaults on any error or bad value. */
export function loadConfig(): Config {
  try {
    return parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/** The project's own overrides — nothing at all when it has no settings file. */
export function loadProjectConfig(rootDir: string): Partial<Config> {
  try {
    return parsePartial(JSON.parse(fs.readFileSync(projectConfigFile(rootDir), 'utf8')))
  } catch {
    return {}
  }
}

/**
 * The one setting that has to be read before the others: extensions register the
 * themes and icon themes `parsePartial` then validates against, so which
 * extensions to skip cannot itself wait for a parsed config. Both layers, project
 * over user, as `resolveConfig` would have merged them.
 */
export function readDisabledExtensions(rootDir: string): string[] {
  const layer = (file: string): string[] | undefined => {
    try {
      return ids(
        (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>).disabledExtensions,
      )
    } catch {
      return undefined
    }
  }
  return layer(projectConfigFile(rootDir)) ?? layer(CONFIG_FILE) ?? []
}

/**
 * Theme and icon-theme ids the config asks for that nothing has registered.
 *
 * Read from the raw files for the same reason `readDisabledExtensions` is: by the
 * time anything holds a `Config`, `VALIDATORS` has replaced an unknown id with
 * the default, and what the user actually wrote is gone. That id is exactly what
 * the market needs to offer the extension back — a config naming `dracula` after
 * the palettes moved out of druk is an extension recommendation, not a broken value.
 */
export function unregisteredNames(rootDir: string): { themes: string[]; icons: string[] } {
  const themes = new Set<string>()
  const icons = new Set<string>()
  for (const file of [CONFIG_FILE, projectConfigFile(rootDir)]) {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    for (const key of ['theme', 'themeLight', 'themeDark'] as const) {
      const value = raw[key]
      if (typeof value === 'string' && value && !isThemeName(value)) themes.add(value)
    }
    const icon = raw.iconTheme
    if (typeof icon === 'string' && icon && !isIconThemeName(icon)) icons.add(icon)
  }
  return { themes: [...themes], icons: [...icons] }
}

export function saveUserConfig(config: Config): void {
  try {
    fs.mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — running without a writable home just means no persistence
  }
}

/**
 * Write the project file with the overridden keys and nothing else. Writing a
 * whole `Config` here would pin every setting on everyone who opens the project,
 * which is the one thing this file must not do.
 */
export function saveProjectConfig(rootDir: string, overrides: Partial<Config>): void {
  const kept = Object.entries(overrides).filter(([, value]) => value !== undefined)
  try {
    const file = projectConfigFile(rootDir)
    fs.mkdirSync(dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — a read-only project just means no project-level persistence
  }
}
