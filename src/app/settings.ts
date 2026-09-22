import { createEffect, createMemo, createSignal } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'

import { APPEARANCE_ENV, detectAppearance } from '../core/appearance'
import type { Appearance } from '../core/appearance'
import {
  CONFIG_FILE,
  CURSOR_STYLES,
  projectConfigFile,
  resolveConfig,
  saveProjectConfig,
  saveUserConfig,
  sidebarColumns,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
} from '../core/config'
import type { Config, ConfigScope, SidebarPosition } from '../core/config'
import { FILE_TOKEN } from '../core/format'
import { bindingProblem, formatChord, parseChord } from '../core/keybindings'
import { MARKET_URL } from '../core/market'
import { plural } from '../core/text'
import { loadExtensions } from '../extensions'
import type { ExtensionLoad } from '../extensions'
import {
  iconThemeLabel,
  iconThemeNames,
  iconThemeNeedsFont,
  NO_ICONS,
  usableIconTheme,
} from '../icons'
import { invalidateSyntaxStyle } from '../languages/highlight'
import { servers } from '../lsp/servers'
import {
  paintedTheme,
  setTheme,
  setTransparency,
  themeLabel,
  themeNames,
} from '../themes'
import type { ThemeName } from '../themes'
import { ALT, setKeyOverrides } from '../ui/keys'
import type { SettingEdit, SettingRow } from '../ui/SettingsView'
import type { EditorBridge } from './editor'
import {
  BINDABLE,
  customHolder,
  isUnbound,
  keyOverrides,
  resolveKeymap,
} from './keymap'
import type { Bindable } from './keymap'
import type { Status } from './status'

// Columns the editor keeps for itself, whatever width the sidebar was saved at.
const EDITOR_MIN = 20

const TAB_SIZES = [2, 4, 8]

// 0 is "the opened folder only".
const SCAN_DEPTHS = [0, 1, 2, 3, 4, 5]
const depthLabel = (depth: number) =>
  depth === 0 ? 'off' : plural(depth, 'level')

// Functions, not constants: extensions register themes and icon themes after this module runs.
const themeList = (): ThemeName[] => themeNames()
const iconList = (): string[] => iconThemeNames()

const step = <T>(list: readonly T[], current: T, dir: 1 | -1): T =>
  list[(list.indexOf(current) + dir + list.length) % list.length]!

const onOff = (value: boolean) => (value ? 'on' : 'off')

type BoolKey = {
  [K in keyof Config]: Config[K] extends boolean ? K : never
}[keyof Config]

type RowSpec = Omit<SettingRow, 'local' | 'clear'> & { key: keyof Config }

export function createSettings(deps: {
  user: Config
  project: Partial<Config>
  rootDir: string
  status: Status
  editor: EditorBridge
  dimensions: () => { width: number; height: number }
}) {
  const { rootDir, status, editor, dimensions } = deps
  const [user, setUser] = createStore<Config>({ ...deps.user })
  const [project, setProject] = createStore<Partial<Config>>({
    ...deps.project,
  })
  const [config, setConfig] = createStore<Config>(
    resolveConfig(deps.user, deps.project)
  )
  const [scope, setScope] = createSignal<ConfigScope>('user')

  // The theme store outlives any one app instance: undo what the last one left behind.
  setTransparency(config.transparent)

  const paintTheme = (name: ThemeName) => {
    // Repainting re-highlights every buffer, and a preview lands here on every keystroke.
    if (paintedTheme() === name) {
      return
    }
    setTheme(name)
    invalidateSyntaxStyle()
  }

  const restoreTheme = () => paintTheme(config.theme)

  // Icons are read straight off `iconTheme`, so previewing one without writing it needs a layer.
  const [iconPreview, setIconPreview] = createSignal<string | null>(null)
  const activeIconTheme = () =>
    usableIconTheme(iconPreview() ?? config.iconTheme)
  const previewIcons = (id: string) => setIconPreview(id)
  const restoreIcons = () => setIconPreview(null)

  // The three settings that are also live state are pushed against the *effective* config, not `patch`.
  const patchLayer = (target: ConfigScope, patch: Partial<Config>) => {
    const before = { ...unwrap(config) }
    if (target === 'project') {
      setProject(patch)
      saveProjectConfig(rootDir, unwrap(project))
    } else {
      setUser(patch)
      saveUserConfig(unwrap(user))
    }
    setConfig(resolveConfig(unwrap(user), unwrap(project)))
    if (config.theme !== before.theme) {
      paintTheme(config.theme)
    }
    if (config.transparent !== before.transparent) {
      setTransparency(config.transparent)
    }
    if (config.vim !== before.vim) {
      editor.setVimMode(config.vim ? 'normal' : null)
    }
  }

  const patchConfig = (patch: Partial<Config>) => patchLayer(scope(), patch)

  const patchUserConfig = (patch: Partial<Config>) => patchLayer('user', patch)

  // In user scope this is the user file alone: a row still moves when the project pins that key.
  const view = (): Config => (scope() === 'project' ? config : user)

  const configFile = () =>
    scope() === 'project' ? projectConfigFile(rootDir) : CONFIG_FILE

  // The cast is the computed key: TypeScript widens `{ [key]: boolean }` to an index signature.
  const boolRow = (
    section: string,
    key: BoolKey,
    label: string,
    notice: (on: boolean) => string = (on) => `${label} ${onOff(on)}`
  ): RowSpec => ({
    cycle: () => {
      patchConfig({ [key]: !view()[key] } as Partial<Config>)
      status.say(notice(config[key]))
    },
    key,
    label,
    section,
    value: onOff(view()[key]),
  })

  const toggleScope = () =>
    setScope((current) => (current === 'user' ? 'project' : 'user'))

  const clearOverride = (key: keyof Config, label: string) => {
    if (project[key] === undefined) {
      return
    }
    patchLayer('project', { [key]: undefined })
    status.say(`${label} back to the user setting`)
  }

  const applyTheme = (name: ThemeName): void => {
    const wasSyncing = view().themeSync
    patchConfig({ theme: name, themeSync: false })
    if (config.theme !== name) {
      status.say(
        `Theme: ${themeLabel(name)} — the project's settings still decide the theme`
      )
      return
    }
    status.say(
      wasSyncing
        ? `Theme: ${themeLabel(name)} — no longer following the OS appearance`
        : `Theme: ${themeLabel(name)}`
    )
  }

  const applyAppearance = (appearance: Appearance) => {
    const patch: Partial<Config> = {}
    // A project pinning one of these outranks the OS; the poll would rewrite the user file every few seconds.
    if (config.themeSync && project.theme === undefined) {
      const name = appearance === 'dark' ? config.themeDark : config.themeLight
      if (name !== config.theme) {
        patch.theme = name
      }
    }
    if (config.iconThemeSync && project.iconTheme === undefined) {
      const id =
        appearance === 'dark' ? config.iconThemeDark : config.iconThemeLight
      if (id !== config.iconTheme) {
        patch.iconTheme = id
      }
    }
    if (Object.keys(patch).length > 0) {
      patchUserConfig(patch)
    }
  }

  const applySideTheme = (
    side: 'themeLight' | 'themeDark',
    name: ThemeName
  ) => {
    patchConfig(
      side === 'themeDark' ? { themeDark: name } : { themeLight: name }
    )
    status.say(
      `${side === 'themeDark' ? 'Dark' : 'Light'} theme: ${themeLabel(name)}`
    )
    if (config.themeSync) {
      applyAppearance(detectAppearance() ?? 'dark')
    }
  }

  const toggleThemeSync = () => {
    patchConfig({ themeSync: !view().themeSync })
    if (!config.themeSync) {
      status.say('Follow OS appearance off')
      return
    }
    const appearance = detectAppearance()
    if (!appearance) {
      status.say(
        `Follow OS appearance on — this system reports none, set ${APPEARANCE_ENV}`
      )
      return
    }
    applyAppearance(appearance)
    status.say(`Following OS appearance (${appearance})`)
  }

  const iconNotice = (id: string): string => {
    if (id === NO_ICONS) {
      return 'File icons off'
    }
    const drawn = usableIconTheme(id)
    if (drawn !== id) {
      return `File icons: ${iconThemeLabel(id)} — this terminal cannot draw it, using ${iconThemeLabel(drawn)}`
    }
    return `File icons: ${iconThemeLabel(id)}${iconThemeNeedsFont(id) ? ' — needs a patched font' : ''}`
  }

  const applyIconTheme = (id: string) => {
    // Before the write: the preview is what the tree reads.
    restoreIcons()
    const wasSyncing = view().iconThemeSync
    patchConfig({ iconTheme: id, iconThemeSync: false })
    status.say(
      wasSyncing
        ? `${iconNotice(config.iconTheme)} — no longer following the OS appearance`
        : iconNotice(config.iconTheme)
    )
  }

  const applySideIcons = (
    side: 'iconThemeLight' | 'iconThemeDark',
    id: string
  ) => {
    restoreIcons()
    patchConfig(
      side === 'iconThemeDark' ? { iconThemeDark: id } : { iconThemeLight: id }
    )
    status.say(
      `${side === 'iconThemeDark' ? 'Dark' : 'Light'} file icons: ${iconThemeLabel(id)}`
    )
    if (config.iconThemeSync) {
      applyAppearance(detectAppearance() ?? 'dark')
    }
  }

  const toggleIconSync = () => {
    patchConfig({ iconThemeSync: !view().iconThemeSync })
    if (!config.iconThemeSync) {
      status.say('File icons follow OS appearance off')
      return
    }
    const appearance = detectAppearance()
    if (!appearance) {
      status.say(
        `File icons follow OS appearance on — this system reports none, set ${APPEARANCE_ENV}`
      )
      return
    }
    applyAppearance(appearance)
    status.say(`File icons following OS appearance (${appearance})`)
  }

  // `setTheme`, not `paintTheme`: a reload can leave the same id pointing at different colors.
  const reloadExtensions = (): ExtensionLoad => {
    const load = loadExtensions(rootDir, config.disabledExtensions)
    setTheme(config.theme)
    invalidateSyntaxStyle()
    return load
  }

  const toggleExtension = (id: string) => {
    const disabled = view().disabledExtensions
    const off = disabled.includes(id)
    patchConfig({
      disabledExtensions: off
        ? disabled.filter((entry) => entry !== id)
        : [...disabled, id],
    })
    reloadExtensions()
    status.say(`Extension "${id}" ${off ? 'enabled' : 'disabled'}`)
  }

  // An empty value means druk's own market, not "no market".
  const applyRegistry = (url: string) => {
    const trimmed = url.trim() || MARKET_URL
    if (!trimmed.startsWith('https://')) {
      return status.say('A registry must be an https URL', 'error')
    }
    patchConfig({ extensionRegistry: trimmed })
    status.say(`Extension registry: ${config.extensionRegistry}`)
  }

  const applyTabSize = (size: number) => {
    patchConfig({ tabSize: size })
    status.say(`Tab size: ${size}`)
  }

  const applyScanDepth = (depth: number) => {
    patchConfig({ gitScanDepth: depth })
    status.say(
      depth === 0
        ? 'Repositories below the folder: not looked for'
        : `Repositories below the folder: ${depthLabel(depth)} deep`
    )
  }

  const applyCursorStyle = (style: Config['cursorStyle']) => {
    patchConfig({ cursorStyle: style })
    status.say(
      config.vim
        ? `Cursor: ${style} — vim mode overrides it`
        : `Cursor: ${style}`
    )
  }

  const applyVim = (enabled: boolean) => {
    patchConfig({ vim: enabled })
    status.say(`Vim mode ${onOff(config.vim)}`)
  }

  // `.TS, tsx` and `ts,tsx` are one entry: two spellings would write one formatter twice.
  const extensionKey = (value: string) =>
    value
      .split(',')
      .map((part) => part.trim().replace(/^\./u, '').toLowerCase())
      .filter(Boolean)
      .join(',')

  const extensionLabel = (key: string) =>
    key === '*'
      ? 'Any file'
      : key
          .replace(/^\./u, '')
          .split(',')
          .map((part) => `.${part}`)
          .join(' ')

  const formatterOption = (key: string, command: string[]) =>
    `${extensionLabel(key)} → ${command.join(' ')}`

  const setFormatter = (
    previous: string | null,
    types: string,
    value: string
  ) => {
    const formatters = { ...view().formatters }
    const key = extensionKey(types)
    const command = value.trim().split(/\s+/u).filter(Boolean)
    if (previous !== null && (key === '' || command.length === 0)) {
      Reflect.deleteProperty(formatters, previous)
      patchConfig({ formatters })
      return status.say(`Formatter for ${extensionLabel(previous)} removed`)
    }
    if (!key) {
      return status.say(
        'Formatter file types: ts,tsx — or * for any file',
        'warn'
      )
    }
    if (command.length === 0) {
      return status.say(
        'A formatter needs a command, e.g. prettier --write',
        'warn'
      )
    }
    if (command.length === 1 && command[0] === FILE_TOKEN) {
      return status.say(
        `A formatter command needs a program, not just ${FILE_TOKEN}`,
        'warn'
      )
    }
    if (previous !== null && previous !== key) {
      Reflect.deleteProperty(formatters, previous)
    }
    formatters[key] = command
    patchConfig({ formatters })
    status.say(`Formatter: ${formatterOption(key, command)}`)
  }

  const formatterEdit = (at: number): SettingEdit => {
    const { formatters } = view()
    const key = Object.keys(formatters)[at] ?? null
    return {
      apply: (values) => setFormatter(key, values[0] ?? '', values[1] ?? ''),
      fields: [
        {
          initial: key ?? '',
          label: 'File types',
          placeholder: 'ts,tsx — or * for any file',
        },
        {
          initial: key ? formatters[key]!.join(' ') : '',
          label: 'Command',
          placeholder: 'prettier --write',
        },
      ],
      hint: [
        'The tool must rewrite the file itself',
        `Its path is appended, or replaces ${FILE_TOKEN}`,
        key ? 'Emptying a field removes this entry' : '',
      ].filter(Boolean),
      title: key ? `Formatter — ${extensionLabel(key)}` : 'Add formatter',
    }
  }

  // Empty restores the default; disabling is the Servers row, where an empty command means "off".
  const setServerCommand = (id: string, value: string) => {
    const overrides = { ...view().lspServers }
    const command = value.trim().split(/\s+/u).filter(Boolean)
    if (command.length === 0) {
      Reflect.deleteProperty(overrides, id)
    } else {
      overrides[id] = command
    }
    patchConfig({ lspServers: overrides })
    status.say(
      command.length === 0
        ? `LSP server "${id}" back on its default command`
        : `LSP server "${id}": ${command.join(' ')}`
    )
  }

  const keymap = createMemo(() => resolveKeymap(config.keybindings))

  // Pushed rather than read: nothing in `ui/` may reach into `app/`.
  createEffect(() => setKeyOverrides(keyOverrides(keymap())))

  const setKeybinding = (id: string, value: string) => {
    const spec = BINDABLE.find((entry) => entry.id === id)
    if (!spec) {
      return
    }
    const bindings = { ...view().keybindings }
    const typed = value.trim()
    if (typed === '') {
      Reflect.deleteProperty(bindings, id)
      patchConfig({ keybindings: bindings })
      return status.say(`${spec.label} back on its default key`)
    }
    if (isUnbound(typed)) {
      bindings[id] = ''
      patchConfig({ keybindings: bindings })
      return status.say(`${spec.label} unbound`)
    }
    const chord = parseChord(typed)
    if (!chord) {
      return status.say(
        `"${typed}" is not a key chord — try Ctrl+${ALT}+K`,
        'warn'
      )
    }
    const problem = bindingProblem(chord)
    if (problem) {
      return status.say(problem, 'warn')
    }
    const spelling = formatChord(chord, ALT)
    const held = customHolder(keymap(), chord, id)
    if (held) {
      return status.say(
        `${spelling} is ${held.label} — unbind that one first`,
        'warn'
      )
    }
    bindings[id] = spelling
    patchConfig({ keybindings: bindings })
    const taken = keymap().conflicts.find(
      (clash) => clash.key === spelling && !clash.rejected
    )
    status.say(
      taken
        ? `${spelling} → ${spec.label} — ${taken.loser} has no key now`
        : `${spelling} → ${spec.label}`
    )
  }

  const bindingLabel = (spec: Bindable) => {
    const key = keymap().display.get(spec.id) || 'unbound'
    return `${keymap().custom.has(spec.id) ? '*' : ' '} ${spec.label} — ${key}`
  }

  const bindingEdit = (spec: Bindable): SettingEdit => ({
    apply: (values) => setKeybinding(spec.id, values[0] ?? ''),
    fields: [
      {
        initial: keymap().display.get(spec.id) ?? '',
        placeholder: `Ctrl+${ALT}+K`,
      },
    ],
    hint: [
      `One chord, e.g. Ctrl+G or Ctrl+${ALT}+K or F5`,
      'It needs Ctrl or a function key',
      '"none" takes the key away',
      'An empty value restores the default',
    ],
    title: `Shortcut — ${spec.label}`,
  })

  const toggleDiffView = () => {
    patchConfig({ diffView: view().diffView === 'inline' ? 'split' : 'inline' })
  }

  const toggleGitPanelView = () => {
    const next = view().gitPanelView === 'tree' ? 'list' : 'tree'
    patchConfig({ gitPanelView: next })
    status.say(
      `Changed files as ${config.gitPanelView === 'tree' ? 'a tree' : 'a flat list'}`
    )
  }

  const applyTypescriptTsdk = (value: string) => {
    const tsdk = value.trim()
    patchConfig({ typescriptTsdk: tsdk })
    status.say(
      tsdk
        ? `TypeScript: ${tsdk}`
        : "TypeScript: whichever the project's own server finds"
    )
  }

  const toggleServer = (id: string) => {
    const overrides = { ...view().lspServers }
    const disabled = overrides[id]?.length === 0
    if (disabled) {
      Reflect.deleteProperty(overrides, id)
    } else {
      overrides[id] = []
    }
    patchConfig({ lspServers: overrides })
    status.say(`LSP server "${id}" ${disabled ? 'enabled' : 'disabled'}`)
  }

  const serverLabel = (id: string, command: string[]) => {
    const override = view().lspServers[id]
    const enabled = override === undefined || override.length > 0
    const shown = override && override.length > 0 ? override : command
    return `${enabled ? '✓' : '✗'} ${id} — ${shown.join(' ')}`
  }

  // Clamped again after `sidebarColumns`: a width saved on a wide screen must not swallow the editor.
  const treeWidth = () =>
    Math.max(
      0,
      Math.min(
        sidebarColumns(config.sidebarWidth, dimensions().width),
        dimensions().width - EDITOR_MIN
      )
    )

  const resizeSidebar = (width: number) => {
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)))
    if (next !== view().sidebarWidth) {
      patchConfig({ sidebarWidth: next })
    }
  }

  const nudgeSidebar = (delta: number) => resizeSidebar(treeWidth() + delta)

  const applySidebarWidth = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === '' || trimmed === 'auto') {
      patchConfig({ sidebarWidth: 'auto' })
      return status.say('Sidebar width: auto')
    }
    const width = Number(trimmed)
    if (!Number.isFinite(width)) {
      return status.say(
        `Sidebar width is a number of columns, or "auto"`,
        'warn'
      )
    }
    resizeSidebar(width)
    status.say(`Sidebar width: ${view().sidebarWidth}`)
  }

  const applySidebarPosition = (position: SidebarPosition) => {
    patchConfig({ sidebarPosition: position })
    status.say(`Sidebar position: ${view().sidebarPosition}`)
  }

  const toggleSidebarPosition = () =>
    applySidebarPosition(view().sidebarPosition === 'left' ? 'right' : 'left')

  const specs = (): RowSpec[] => [
    {
      cycle: (dir) => applyTheme(step(themeList(), view().theme, dir)),
      key: 'theme',
      label: 'Theme',
      section: 'Appearance',
      select: {
        options: themeList().map(themeLabel),
        pick: (at) => applyTheme(themeList()[at]!),
        preview: (at) => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
      value: themeLabel(view().theme),
    },
    {
      cycle: toggleThemeSync,
      key: 'themeSync',
      label: 'Follow OS appearance',
      section: 'Appearance',
      value: onOff(view().themeSync),
    },
    {
      cycle: (dir) =>
        applySideTheme('themeLight', step(themeList(), view().themeLight, dir)),
      key: 'themeLight',
      label: 'Light theme',
      section: 'Appearance',
      select: {
        options: themeList().map(themeLabel),
        pick: (at) => applySideTheme('themeLight', themeList()[at]!),
        preview: (at) => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
      value: themeLabel(view().themeLight),
    },
    {
      cycle: (dir) =>
        applySideTheme('themeDark', step(themeList(), view().themeDark, dir)),
      key: 'themeDark',
      label: 'Dark theme',
      section: 'Appearance',
      select: {
        options: themeList().map(themeLabel),
        pick: (at) => applySideTheme('themeDark', themeList()[at]!),
        preview: (at) => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
      value: themeLabel(view().themeDark),
    },
    boolRow('Appearance', 'transparent', 'Transparent background'),
    {
      cycle: (dir) => applyIconTheme(step(iconList(), view().iconTheme, dir)),
      key: 'iconTheme',
      label: 'File icons',
      section: 'Appearance',
      select: {
        options: iconList().map(iconThemeLabel),
        pick: (at) => applyIconTheme(iconList()[at]!),
      },
      value: iconThemeLabel(view().iconTheme),
    },
    {
      cycle: toggleIconSync,
      key: 'iconThemeSync',
      label: 'File icons follow OS appearance',
      section: 'Appearance',
      value: onOff(view().iconThemeSync),
    },
    {
      cycle: (dir) =>
        applySideIcons(
          'iconThemeLight',
          step(iconList(), view().iconThemeLight, dir)
        ),
      key: 'iconThemeLight',
      label: 'Light file icons',
      section: 'Appearance',
      select: {
        options: iconList().map(iconThemeLabel),
        pick: (at) => applySideIcons('iconThemeLight', iconList()[at]!),
      },
      value: iconThemeLabel(view().iconThemeLight),
    },
    {
      cycle: (dir) =>
        applySideIcons(
          'iconThemeDark',
          step(iconList(), view().iconThemeDark, dir)
        ),
      key: 'iconThemeDark',
      label: 'Dark file icons',
      section: 'Appearance',
      select: {
        options: iconList().map(iconThemeLabel),
        pick: (at) => applySideIcons('iconThemeDark', iconList()[at]!),
      },
      value: iconThemeLabel(view().iconThemeDark),
    },
    boolRow('Appearance', 'tabIcons', 'File icons in tabs'),
    boolRow('Appearance', 'breadcrumbs', 'Breadcrumbs under tabs'),
    boolRow(
      'Appearance',
      'tooltips',
      'Hotkey tooltips (hold Ctrl for all)',
      (on) => `Tooltips ${onOff(on)}`
    ),
    boolRow('Appearance', 'terminalTitle', 'Terminal title'),
    {
      cycle: () => applyVim(!view().vim),
      key: 'vim',
      label: 'Vim mode',
      section: 'Editor',
      value: onOff(view().vim),
    },
    {
      cycle: (dir) =>
        applyCursorStyle(step(CURSOR_STYLES, view().cursorStyle, dir)),
      key: 'cursorStyle',
      label: 'Cursor',
      section: 'Editor',
      select: {
        options: [...CURSOR_STYLES],
        pick: (at) => applyCursorStyle(CURSOR_STYLES[at]!),
      },
      // `config.vim`, not `view().vim`: the note is about the caret on screen.
      value: config.vim
        ? `${view().cursorStyle} (vim overrides)`
        : view().cursorStyle,
    },
    boolRow('Editor', 'wrap', 'Word wrap'),
    boolRow('Editor', 'scrollPastEnd', 'Scroll past end'),
    boolRow('Editor', 'markdownPreview', 'Open markdown rendered', (on) =>
      on ? 'Markdown opens rendered' : 'Markdown opens as source'
    ),
    {
      cycle: (dir) => applyTabSize(step(TAB_SIZES, view().tabSize, dir)),
      key: 'tabSize',
      label: 'Tab size',
      section: 'Editor',
      select: {
        options: TAB_SIZES.map(String),
        pick: (at) => applyTabSize(TAB_SIZES[at]!),
      },
      value: String(view().tabSize),
    },
    boolRow(
      'Editor',
      'trimOnSave',
      'Trim trailing whitespace on save',
      (on) => `Trim on save ${onOff(on)}`
    ),
    boolRow('Editor', 'formatOnSave', 'Format on save', (on) =>
      on && Object.keys(config.formatters).length === 0
        ? 'Format on save on — add a command on the Formatters row'
        : `Format on save ${onOff(on)}`
    ),
    {
      cycle: () => status.say('Enter opens the formatter list'),
      key: 'formatters',
      label: 'Formatters',
      section: 'Editor',
      select: {
        options: [
          ...Object.entries(view().formatters).map(([key, cmd]) =>
            formatterOption(key, cmd)
          ),
          '+ Add formatter…',
        ],
        pick: formatterEdit,
      },
      value:
        Object.keys(view().formatters).length === 0
          ? 'none'
          : `${Object.keys(view().formatters).length} configured`,
    },
    boolRow(
      'Editor',
      'autoSaveOnBlur',
      'Auto-save on focus change and terminal blur',
      (on) => `Auto-save ${onOff(on)}`
    ),
    boolRow(
      'Files',
      'showDotfiles',
      'Show dotfiles',
      (on) => `Dotfiles ${on ? 'shown' : 'hidden'}`
    ),
    boolRow(
      'Files',
      'respectGitignore',
      'Hide git-ignored files',
      (on) => `Git-ignored files ${on ? 'hidden' : 'shown'}`
    ),
    {
      cycle: (dir) => nudgeSidebar(dir),
      edit: {
        apply: (values) => applySidebarWidth(values[0] ?? ''),
        fields: [
          {
            initial:
              view().sidebarWidth === 'auto'
                ? 'auto'
                : String(view().sidebarWidth),
            placeholder: `auto, or ${SIDEBAR_MIN}–${SIDEBAR_MAX}`,
          },
        ],
        hint: [
          `A column count, ${SIDEBAR_MIN}–${SIDEBAR_MAX}`,
          '"auto" takes a share of the terminal',
        ],
        title: 'Sidebar width',
      },
      key: 'sidebarWidth',
      label: 'Sidebar width',
      section: 'Files',
      value:
        view().sidebarWidth === 'auto' ? 'auto' : String(view().sidebarWidth),
    },
    {
      cycle: toggleSidebarPosition,
      key: 'sidebarPosition',
      label: 'Sidebar position',
      section: 'Files',
      value: view().sidebarPosition,
    },
    {
      cycle: toggleDiffView,
      key: 'diffView',
      label: 'Diff layout',
      section: 'Git',
      value: view().diffView === 'inline' ? 'inline' : 'side-by-side',
    },
    {
      cycle: toggleGitPanelView,
      key: 'gitPanelView',
      label: 'Changed files',
      section: 'Git',
      value: view().gitPanelView === 'tree' ? 'tree' : 'flat list',
    },
    {
      cycle: (dir) =>
        applyScanDepth(step(SCAN_DEPTHS, view().gitScanDepth, dir)),
      key: 'gitScanDepth',
      label: 'Scan for repositories below the folder',
      section: 'Git',
      select: {
        options: SCAN_DEPTHS.map(depthLabel),
        pick: (at) => applyScanDepth(SCAN_DEPTHS[at]!),
      },
      value: depthLabel(view().gitScanDepth),
    },
    boolRow('Review', 'reviewInline', 'Inline review notes'),
    boolRow('Language servers', 'lsp', 'LSP diagnostics'),
    boolRow('Language servers', 'lspInline', 'Inline problem text'),
    boolRow('Language servers', 'lspCompletion', 'Autocomplete'),
    boolRow('Language servers', 'lspAutoInstall', 'Offer to install servers'),
    {
      cycle: () => status.say('Enter sets a TypeScript path'),
      edit: {
        apply: (values) => applyTypescriptTsdk(values[0] ?? ''),
        fields: [
          {
            initial: view().typescriptTsdk,
            placeholder: 'node_modules/typescript/lib',
          },
        ],
        hint: [
          'A tsserver.js, a lib folder, or a typescript package',
          "Empty: the project's own copy, else the one druk installed",
        ],
        title: 'TypeScript path',
      },
      key: 'typescriptTsdk',
      label: 'TypeScript',
      section: 'Language servers',
      value: view().typescriptTsdk || 'from the project',
    },
    {
      cycle: () => status.say('Enter opens the server list'),
      key: 'lspServers',
      label: 'Servers',
      section: 'Language servers',
      select: {
        options: servers().map((spec) => serverLabel(spec.id, spec.command)),
        pick: (at) => toggleServer(servers()[at]!.id),
      },
      value: `${servers().filter((s) => (view().lspServers[s.id]?.length ?? 1) > 0).length}/${servers().length} enabled`,
    },
    {
      cycle: () => status.say('Enter opens the server list'),
      key: 'lspServers',
      label: 'Server commands',
      section: 'Language servers',
      select: {
        options: servers().map((spec) => serverLabel(spec.id, spec.command)),
        pick: (at) => {
          const spec = servers()[at]!
          const override = view().lspServers[spec.id]
          return {
            apply: (values: string[]) =>
              setServerCommand(spec.id, values[0] ?? ''),
            fields: [
              {
                initial: (override && override.length > 0
                  ? override
                  : spec.command
                ).join(' '),
              },
            ],
            hint: [
              'Runs as given — it talks LSP over stdio,',
              'so no file path is added',
              'An empty value restores the default',
            ],
            title: `Command — ${spec.id}`,
          }
        },
      },
      value: `${Object.values(view().lspServers).filter((cmd) => cmd.length > 0).length} custom`,
    },
    {
      cycle: () => status.say('Enter opens the shortcut list'),
      key: 'keybindings',
      label: 'Shortcuts',
      section: 'Keyboard',
      select: {
        options: BINDABLE.map(bindingLabel),
        pick: (at) => bindingEdit(BINDABLE[at]!),
      },
      value: `${keymap().custom.size} custom${keymap().conflicts.length > 0 ? ` · ${keymap().conflicts.length} clash` : ''}`,
    },
    boolRow(
      'Extensions',
      'extensionUpdates',
      'Check the market at startup',
      (on) => `Extension market ${onOff(on)}`
    ),
    {
      cycle: () => status.say('Enter sets the market URL'),
      edit: {
        apply: (values) => applyRegistry(values[0] ?? ''),
        fields: [
          { initial: view().extensionRegistry, placeholder: MARKET_URL },
        ],
        hint: [
          'An https folder holding index.json and <id>/extension.json',
          'Empty: druk’s own',
        ],
        title: 'Extension registry',
      },
      key: 'extensionRegistry',
      label: 'Registry',
      section: 'Extensions',
      value:
        view().extensionRegistry === MARKET_URL
          ? 'druk'
          : view().extensionRegistry,
    },
  ]

  const cycleRow = (key: keyof Config) =>
    specs()
      .find((row) => row.key === key)
      ?.cycle?.(1)

  const rows = (): SettingRow[] =>
    specs().map(({ key, ...row }) => ({
      ...row,
      clear:
        scope() === 'project' && project[key] !== undefined
          ? () => clearOverride(key, row.label)
          : undefined,
      local: project[key] !== undefined,
    }))

  return {
    activeIconTheme,
    applyAppearance,
    applyIconTheme,
    applyRegistry,
    applySidebarPosition,
    applySidebarWidth,
    applyTabSize,
    applyTheme,
    applyVim,
    config,
    configFile,
    keymap,
    nudgeSidebar,
    patchConfig,
    patchUserConfig,
    previewIcons,
    previewTheme: paintTheme,
    reloadExtensions,
    resizeSidebar,
    restoreIcons,
    restoreTheme,
    rows,
    scope,
    setFormatter,
    setKeybinding,
    setScope,
    setServerCommand,
    toggleDiffView,
    toggleExtension,
    toggleGitPanelView,
    toggleScope,
    toggleServer,
    toggleSidebarPosition,
    toggleThemeSync,
    toggleWrap: () => cycleRow('wrap'),
    treeWidth,
  }
}

export type Settings = ReturnType<typeof createSettings>
