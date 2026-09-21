import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { isIconThemeName, NO_ICONS } from '../icons'
import { isThemeName } from '../themes'
import type { ThemeName } from '../themes'
import { MARKET_URL } from './market'
import { DEFAULT_SCAN_DEPTH } from './repos'

export const CONFIG_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'),
  'druk',
  'config.json'
)

export type ConfigScope = 'user' | 'project'

export const PROJECT_CONFIG_DIR = '.druk'

export const projectConfigFile = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'settings.json')

export const SIDEBAR_MIN = 15
export const SIDEBAR_MAX = 80

const AUTO_SHARE = 0.25
const AUTO_MIN = 30
const AUTO_MAX = 60

export function sidebarColumns(
  width: number | 'auto',
  terminalWidth: number
): number {
  if (width !== 'auto') {
    return width
  }
  return Math.max(
    AUTO_MIN,
    Math.min(AUTO_MAX, Math.round(terminalWidth * AUTO_SHARE))
  )
}

export const CURSOR_STYLES = ['block', 'line', 'underline'] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]

const SIDEBAR_POSITIONS = ['left', 'right'] as const
export type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number]

export interface Config {
  theme: ThemeName
  themeSync: boolean
  themeLight: ThemeName
  themeDark: ThemeName
  transparent: boolean
  iconTheme: string
  tabIcons: boolean
  tooltips: boolean
  terminalTitle: boolean
  vim: boolean
  cursorStyle: CursorStyle
  wrap: boolean
  scrollPastEnd: boolean
  markdownPreview: boolean
  tabSize: number
  sidebarWidth: number | 'auto'
  sidebarPosition: SidebarPosition
  skipUpdate: string
  trimOnSave: boolean
  formatOnSave: boolean
  formatters: Record<string, string[]>
  autoSaveOnBlur: boolean
  diffView: 'inline' | 'split'
  gitPanelView: 'tree' | 'list'
  gitScanDepth: number
  showDotfiles: boolean
  respectGitignore: boolean
  reviewInline: boolean
  lsp: boolean
  lspInline: boolean
  lspCompletion: boolean
  lspAutoInstall: boolean
  typescriptTsdk: string
  lspServers: Record<string, string[]>
  keybindings: Record<string, string>
  disabledExtensions: string[]
  extensionUpdates: boolean
  extensionRegistry: string
}

export const DEFAULTS: Config = {
  autoSaveOnBlur: true,
  cursorStyle: 'block',
  diffView: 'inline',
  disabledExtensions: [],
  extensionRegistry: MARKET_URL,
  extensionUpdates: true,
  formatOnSave: false,
  formatters: {},
  gitPanelView: 'tree',
  gitScanDepth: DEFAULT_SCAN_DEPTH,
  iconTheme: NO_ICONS,
  keybindings: {},
  lsp: true,
  lspAutoInstall: true,
  lspCompletion: true,
  lspInline: true,
  lspServers: {},
  markdownPreview: false,
  respectGitignore: false,
  reviewInline: true,
  scrollPastEnd: true,
  showDotfiles: true,
  sidebarPosition: 'left',
  sidebarWidth: 'auto',
  skipUpdate: '',
  tabIcons: false,
  tabSize: 2,
  terminalTitle: true,
  theme: 'dark',
  themeDark: 'dark',
  themeLight: 'light',
  themeSync: true,
  tooltips: true,
  transparent: false,
  trimOnSave: false,
  typescriptTsdk: '',
  vim: false,
  wrap: true,
}

type Validator<K extends keyof Config> = (raw: unknown) => Config[K] | undefined

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined)
const theme = (raw: unknown) => (isThemeName(raw) ? raw : undefined)
const text = (raw: unknown) => (typeof raw === 'string' ? raw : undefined)

const among =
  <T extends string>(...values: T[]) =>
  (raw: unknown): T | undefined =>
    typeof raw === 'string' ? values.find((value) => value === raw) : undefined

const commands = (raw: unknown): Record<string, string[]> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const parsed: Record<string, string[]> = {}
  for (const [id, command] of Object.entries(raw)) {
    if (
      Array.isArray(command) &&
      command.every((part) => typeof part === 'string')
    ) {
      parsed[id] = command
    }
  }
  return parsed
}

const ids = (raw: unknown): string[] | undefined =>
  Array.isArray(raw)
    ? raw.filter((value) => typeof value === 'string')
    : undefined

const strings = (raw: unknown): Record<string, string> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const parsed: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      parsed[id] = value
    }
  }
  return parsed
}

const VALIDATORS: { [K in keyof Config]: Validator<K> } = {
  autoSaveOnBlur: bool,
  cursorStyle: among(...CURSOR_STYLES),
  diffView: among('inline', 'split'),
  disabledExtensions: ids,
  extensionRegistry: (raw) =>
    typeof raw === 'string' && raw.startsWith('https://') ? raw : undefined,
  extensionUpdates: bool,
  formatOnSave: bool,
  formatters: commands,
  gitPanelView: among('tree', 'list'),
  gitScanDepth: (raw) =>
    typeof raw === 'number' && raw >= 0 && raw <= 5
      ? Math.floor(raw)
      : undefined,
  iconTheme: (raw) => (isIconThemeName(raw) ? raw : undefined),
  keybindings: strings,
  lsp: bool,
  lspAutoInstall: bool,
  lspCompletion: bool,
  lspInline: bool,
  lspServers: commands,
  markdownPreview: bool,
  respectGitignore: bool,
  reviewInline: bool,
  scrollPastEnd: bool,
  showDotfiles: bool,
  sidebarPosition: among(...SIDEBAR_POSITIONS),
  sidebarWidth: (raw) => {
    if (raw === 'auto') {
      return 'auto'
    }
    return typeof raw === 'number' && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX
      ? Math.floor(raw)
      : undefined
  },
  skipUpdate: text,
  tabIcons: bool,
  tabSize: (raw) =>
    typeof raw === 'number' && raw >= 1 && raw <= 16
      ? Math.floor(raw)
      : undefined,
  terminalTitle: bool,
  theme,
  themeDark: theme,
  themeLight: theme,
  themeSync: bool,
  tooltips: bool,
  transparent: bool,
  trimOnSave: bool,
  typescriptTsdk: text,
  vim: bool,
  wrap: bool,
}

const isConfigKey = (key: string): key is keyof Config => key in VALIDATORS

export function parsePartial(raw: unknown): Partial<Config> {
  const config: Partial<Config> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return config
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigKey(key)) {
      continue
    }
    const parsed = VALIDATORS[key](value)
    if (parsed !== undefined) {
      Object.assign(config, { [key]: parsed })
    }
  }
  return config
}

const parse = (raw: unknown): Config => ({ ...DEFAULTS, ...parsePartial(raw) })

// A key the settings page reset is present holding `undefined`, so a plain spread would apply it.
export function resolveConfig(user: Config, project: Partial<Config>): Config {
  const config = { ...user }
  for (const [key, value] of Object.entries(project)) {
    if (value !== undefined) {
      Object.assign(config, { [key]: value })
    }
  }
  return config
}

export function loadConfig(): Config {
  try {
    return parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')))
  } catch {
    return { ...DEFAULTS }
  }
}

export function loadProjectConfig(rootDir: string): Partial<Config> {
  try {
    return parsePartial(
      JSON.parse(fs.readFileSync(projectConfigFile(rootDir), 'utf-8'))
    )
  } catch {
    return {}
  }
}

// Read before any config parse: extensions register the theme ids VALIDATORS validate against.
export function readDisabledExtensions(rootDir: string): string[] {
  const layer = (file: string): string[] | undefined => {
    try {
      return ids(
        (JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>)
          .disabledExtensions
      )
    } catch {
      return undefined
    }
  }
  return layer(projectConfigFile(rootDir)) ?? layer(CONFIG_FILE) ?? []
}

export function unregisteredNames(rootDir: string): {
  themes: string[]
  icons: string[]
} {
  const themes = new Set<string>()
  const icons = new Set<string>()
  for (const file of [CONFIG_FILE, projectConfigFile(rootDir)]) {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
        string,
        unknown
      >
    } catch {
      continue
    }
    for (const key of ['theme', 'themeLight', 'themeDark'] as const) {
      const value = raw[key]
      if (typeof value === 'string' && value && !isThemeName(value)) {
        themes.add(value)
      }
    }
    const icon = raw.iconTheme
    if (typeof icon === 'string' && icon && !isIconThemeName(icon)) {
      icons.add(icon)
    }
  }
  return { icons: [...icons], themes: [...themes] }
}

export function saveUserConfig(config: Config): void {
  try {
    fs.mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(
      CONFIG_FILE,
      `${JSON.stringify(config, null, 2)}\n`,
      'utf-8'
    )
  } catch {
    // best-effort
  }
}

export function saveProjectConfig(
  rootDir: string,
  overrides: Partial<Config>
): void {
  const kept = Object.entries(overrides).filter(
    ([, value]) => value !== undefined
  )
  try {
    const file = projectConfigFile(rootDir)
    fs.mkdirSync(dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`,
      'utf-8'
    )
  } catch {
    // best-effort
  }
}
