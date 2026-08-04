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
import type { Config, ConfigScope } from '../core/config'
import { FORGE_KINDS } from '../core/forge'
import type { ForgeSetting } from '../core/forge'
import { FILE_TOKEN } from '../core/format'
import { bindingProblem, formatChord, parseChord } from '../core/keybindings'
import { MARKET_URL } from '../core/market'
import { loadExtensions } from '../extensions'
import type { ExtensionLoad } from '../extensions'
import { iconThemeLabel, iconThemeNames, iconThemeNeedsFont, NO_ICONS } from '../icons'
import { invalidateSyntaxStyle } from '../languages/highlight'
import { servers } from '../lsp/servers'
import { paintedTheme, setTheme, setTransparency, themeLabel, themeNames } from '../themes'
import type { ThemeName } from '../themes'
import { ALT, setKeyOverrides } from '../ui/keys'
import type { SettingEdit, SettingRow } from '../ui/SettingsView'
import type { EditorBridge } from './editor'
import { BINDABLE, customHolder, isUnbound, keyOverrides, resolveKeymap } from './keymap'
import type { Bindable } from './keymap'
import type { Status } from './status'

/** Columns the editor keeps for itself, whatever width the sidebar was saved at. */
const EDITOR_MIN = 20

const TAB_SIZES = [2, 4, 8]

/** What `reviewForge` may be set to, in the order the row steps through them. */
const FORGE_SETTINGS: ForgeSetting[] = ['auto', ...FORGE_KINDS]

/** Levels the repository scan may look down; 0 is "the opened folder only". */
const SCAN_DEPTHS = [0, 1, 2, 3, 4, 5]
const depthLabel = (depth: number) =>
  depth === 0 ? 'off' : `${depth} level${depth === 1 ? '' : 's'}`

// Functions, not constants: extensions register themes and icon themes at startup,
// which happens after this module is evaluated.
const themeList = (): ThemeName[] => themeNames()
const iconList = (): string[] => iconThemeNames()

/** The entry `dir` steps to, wrapping at both ends. */
const step = <T>(list: readonly T[], current: T, dir: 1 | -1): T =>
  list[(list.indexOf(current) + dir + list.length) % list.length]!

const onOff = (value: boolean) => (value ? 'on' : 'off')

/** The config store and every action that edits and persists it. */
export function createSettings(deps: {
  /** The user's own settings — the whole `Config`, as its file holds it. */
  user: Config
  /** What `<rootDir>/.druk/settings.json` overrides, and nothing more. */
  project: Partial<Config>
  rootDir: string
  status: Status
  editor: EditorBridge
  dimensions: () => { width: number; height: number }
}) {
  const { rootDir, status, editor, dimensions } = deps
  const [user, setUser] = createStore<Config>({ ...deps.user })
  const [project, setProject] = createStore<Partial<Config>>({ ...deps.project })
  /** The effective config: what the rest of the editor reads. */
  const [config, setConfig] = createStore<Config>(resolveConfig(deps.user, deps.project))
  /** Which file the page shows and writes. User's own until asked otherwise. */
  const [scope, setScope] = createSignal<ConfigScope>('user')

  // Here rather than beside the `setTheme` in main.tsx: the theme store outlives
  // any one app instance, so a launch whose config says otherwise has to undo
  // what the last one left behind.
  setTransparency(config.transparent)

  /** Paint a theme, without touching which theme the config says to use. */
  const paintTheme = (name: ThemeName) => {
    // A preview lands here on every keystroke, and repainting is not free — it
    // drops every buffer's style table and re-highlights the window.
    if (paintedTheme() === name) return
    setTheme(name)
    invalidateSyntaxStyle()
  }

  /**
   * Undo a preview. `config.theme` is by definition what should be on screen —
   * `patchLayer` repaints whenever it changes, and the OS-appearance poll writes
   * the side theme into it — so this is the whole of it, for the light and dark
   * rows as much as for `theme` itself.
   */
  const restoreTheme = () => paintTheme(config.theme)

  /**
   * The icon set on screen, which is the config's except while a list is being
   * arrowed through. Themes get this for free — the theme store is already
   * separate from the config — but icons are read straight off `iconTheme`, so
   * previewing one without writing it to disk needs a layer of its own.
   */
  const [iconPreview, setIconPreview] = createSignal<string | null>(null)
  const activeIconTheme = () => iconPreview() ?? config.iconTheme
  const previewIcons = (id: string) => setIconPreview(id)
  const restoreIcons = () => setIconPreview(null)

  /**
   * Write `patch` into one layer, persist that file, and re-resolve.
   *
   * Three settings are also live state held elsewhere — the theme store, the
   * transparency flag, the editor's vim mode — and they are pushed from here,
   * against the *effective* config rather than the patch. A write to the user
   * layer that the project shadows must change nothing on screen, and clearing a
   * project override has to bring the user's value back into force without every
   * step action knowing about layers.
   */
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
    if (config.theme !== before.theme) paintTheme(config.theme)
    if (config.transparent !== before.transparent) setTransparency(config.transparent)
    if (config.vim !== before.vim) editor.setVimMode(config.vim ? 'normal' : null)
  }

  const patchConfig = (patch: Partial<Config>) => patchLayer(scope(), patch)

  /**
   * Machine-local by nature: the dismissed update notice and the theme the OS
   * appearance chose. Neither belongs in a project file that gets committed.
   */
  const patchUserConfig = (patch: Partial<Config>) => patchLayer('user', patch)

  /**
   * The config the page reads and steps from — the active scope's own view of it.
   * In project scope that is the effective config; in user scope it is the user
   * file alone, so a row still moves when the project pins that key. The page
   * marks those rows rather than pretend the change did not happen.
   */
  const view = (): Config => (scope() === 'project' ? config : user)

  const configFile = () => (scope() === 'project' ? projectConfigFile(rootDir) : CONFIG_FILE)

  const toggleScope = () => setScope(current => (current === 'user' ? 'project' : 'user'))

  /** Drop one project override; the user's value comes back into force. */
  const clearOverride = (key: keyof Config, label: string) => {
    if (project[key] === undefined) return
    patchLayer('project', { [key]: undefined })
    status.say(`${label} back to the user setting`)
  }

  /**
   * A theme picked by hand. It has to outlive the next appearance poll, so the
   * pick turns the sync off — and says so, since the user did not ask for that
   * and the settings page is the only other place the change shows.
   */
  const applyTheme = (name: ThemeName): void => {
    const wasSyncing = view().themeSync
    patchConfig({ theme: name, themeSync: false })
    if (config.theme !== name) {
      status.say(`Theme: ${themeLabel(name)} — the project's settings still decide the theme`)
      return
    }
    status.say(
      wasSyncing
        ? `Theme: ${themeLabel(name)} — no longer following the OS appearance`
        : `Theme: ${themeLabel(name)}`,
    )
  }

  /** The OS said light or dark: paint that side's theme, quietly. */
  const applyAppearance = (appearance: Appearance) => {
    // A project that pins `theme` outranks the OS, and the poll would otherwise
    // rewrite the user file every few seconds for a value that never takes.
    if (project.theme !== undefined) return
    const name = appearance === 'dark' ? config.themeDark : config.themeLight
    if (name === config.theme) return
    patchUserConfig({ theme: name })
  }

  const applySideTheme = (side: 'themeLight' | 'themeDark', name: ThemeName) => {
    patchConfig(side === 'themeDark' ? { themeDark: name } : { themeLight: name })
    status.say(`${side === 'themeDark' ? 'Dark' : 'Light'} theme: ${themeLabel(name)}`)
    if (config.themeSync) applyAppearance(detectAppearance() ?? 'dark')
  }

  const toggleThemeSync = () => {
    patchConfig({ themeSync: !view().themeSync })
    if (!config.themeSync) {
      status.say('Follow OS appearance off')
      return
    }
    const appearance = detectAppearance()
    if (!appearance) {
      status.say(`Follow OS appearance on — this system reports none, set ${APPEARANCE_ENV}`)
      return
    }
    applyAppearance(appearance)
    status.say(`Following OS appearance (${appearance})`)
  }

  const toggleTransparent = () => {
    patchConfig({ transparent: !view().transparent })
    status.say(`Transparent background ${onOff(config.transparent)}`)
  }

  const toggleWrap = () => {
    patchConfig({ wrap: !view().wrap })
    status.say(`Word wrap ${onOff(config.wrap)}`)
  }

  const applyIconTheme = (id: string) => {
    // Before the write, not after: the preview is what the tree is reading, and
    // leaving it up would keep showing the arrowed-past set over the saved one.
    restoreIcons()
    patchConfig({ iconTheme: id })
    status.say(
      config.iconTheme === NO_ICONS
        ? 'File icons off'
        : `File icons: ${iconThemeLabel(config.iconTheme)}${iconThemeNeedsFont(id) ? ' — needs a patched font' : ''}`,
    )
  }

  /**
   * Read every manifest again and re-register what they contribute.
   *
   * The theme is repainted unconditionally rather than through `paintTheme`,
   * which returns early when the name has not changed: a reload can leave the
   * same id pointing at different colors, or at none — `setTheme` falls back to
   * the default for a theme whose extension has just been disabled.
   */
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
      disabledExtensions: off ? disabled.filter(entry => entry !== id) : [...disabled, id],
    })
    reloadExtensions()
    status.say(`Extension "${id}" ${off ? 'enabled' : 'disabled'}`)
  }

  const toggleMarket = () => {
    patchConfig({ extensionUpdates: !view().extensionUpdates })
    status.say(`Extension market ${onOff(config.extensionUpdates)}`)
  }

  /**
   * An empty value means druk's own market, not "no market": the setting is a
   * URL the fetch is built from, and there is no useful editor without one.
   */
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
        : `Repositories below the folder: ${depthLabel(depth)} deep`,
    )
  }

  const applyCursorStyle = (style: Config['cursorStyle']) => {
    patchConfig({ cursorStyle: style })
    status.say(config.vim ? `Cursor: ${style} — vim mode overrides it` : `Cursor: ${style}`)
  }

  const applyVim = (enabled: boolean) => {
    patchConfig({ vim: enabled })
    status.say(`Vim mode ${onOff(config.vim)}`)
  }

  const toggleTrim = () => {
    patchConfig({ trimOnSave: !view().trimOnSave })
    status.say(`Trim on save ${onOff(config.trimOnSave)}`)
  }

  const toggleFormatOnSave = () => {
    patchConfig({ formatOnSave: !view().formatOnSave })
    // Turning it on with nothing configured would silently do nothing on save.
    status.say(
      config.formatOnSave && Object.keys(config.formatters).length === 0
        ? 'Format on save on — add a command on the Formatters row'
        : `Format on save ${onOff(config.formatOnSave)}`,
    )
  }

  /**
   * The stored key for what was typed into the File types field: `.TS, tsx` and
   * `ts,tsx` are the same entry, so they have to spell it the same way or the
   * page would let one formatter be written twice under two keys.
   */
  const extensionKey = (value: string) =>
    value
      .split(',')
      .map(part => part.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean)
      .join(',')

  /** The file types an entry covers, as a reader would say them: `.ts .tsx`. */
  const extensionLabel = (key: string) =>
    key === '*'
      ? 'Any file'
      : key
          .replace(/^\./, '')
          .split(',')
          .map(part => `.${part}`)
          .join(' ')

  /** One entry as the picker draws it — file types, then what runs over them. */
  const formatterOption = (key: string, command: string[]) =>
    `${extensionLabel(key)} → ${command.join(' ')}`

  /**
   * `previous` names the entry being edited, or null when adding; emptying either
   * field removes it, and rewriting the extensions moves the entry rather than
   * fork it.
   */
  const setFormatter = (previous: string | null, types: string, value: string) => {
    const formatters = { ...view().formatters }
    const key = extensionKey(types)
    const command = value.trim().split(/\s+/).filter(Boolean)
    if (previous !== null && (key === '' || command.length === 0)) {
      delete formatters[previous]
      patchConfig({ formatters })
      return status.say(`Formatter for ${extensionLabel(previous)} removed`)
    }
    if (!key) return status.say('Formatter file types: ts,tsx — or * for any file', 'warn')
    if (command.length === 0) {
      return status.say('A formatter needs a command, e.g. prettier --write', 'warn')
    }
    if (command.length === 1 && command[0] === FILE_TOKEN) {
      return status.say(`A formatter command needs a program, not just ${FILE_TOKEN}`, 'warn')
    }
    if (previous !== null && previous !== key) delete formatters[previous]
    formatters[key] = command
    patchConfig({ formatters })
    status.say(`Formatter: ${formatterOption(key, command)}`)
  }

  /** The edit a formatter pick opens — entry `at`, or "add" past the end. */
  const formatterEdit = (at: number): SettingEdit => {
    const formatters = view().formatters
    const key = Object.keys(formatters)[at] ?? null
    return {
      title: key ? `Formatter — ${extensionLabel(key)}` : 'Add formatter',
      fields: [
        { label: 'File types', initial: key ?? '', placeholder: 'ts,tsx — or * for any file' },
        {
          label: 'Command',
          initial: key ? formatters[key]!.join(' ') : '',
          placeholder: 'prettier --write',
        },
      ],
      // Short lines on purpose: the modal is only as wide as the editor pane,
      // and beside a sidebar a longer line wraps mid-word.
      hint: [
        'The tool must rewrite the file itself',
        `Its path is appended, or replaces ${FILE_TOKEN}`,
        key ? 'Emptying a field removes this entry' : '',
      ].filter(Boolean),
      apply: values => setFormatter(key, values[0] ?? '', values[1] ?? ''),
    }
  }

  /** Custom command for one server; empty restores the default. Disabling stays
   * on the Servers row — an empty command already means "off" there. */
  const setServerCommand = (id: string, value: string) => {
    const overrides = { ...view().lspServers }
    const command = value.trim().split(/\s+/).filter(Boolean)
    if (command.length === 0) delete overrides[id]
    else overrides[id] = command
    patchConfig({ lspServers: overrides })
    status.say(
      command.length === 0
        ? `LSP server "${id}" back on its default command`
        : `LSP server "${id}": ${command.join(' ')}`,
    )
  }

  /** The shortcuts in force, clashes and all — the keyboard dispatches off this. */
  const keymap = createMemo(() => resolveKeymap(config.keybindings))

  // The help table, the peek strip and the footer hints render from `ui/keys`,
  // which knows the defaults and nothing about this setting. Pushed rather than
  // read: nothing in `ui/` may reach into `app/`.
  createEffect(() => setKeyOverrides(keyOverrides(keymap())))

  /**
   * Rebind one command. An empty value restores its default and "none" takes its
   * key away.
   *
   * A chord another *custom* binding holds is refused: both are deliberate
   * choices, so which of them goes is the user's call rather than ours. A chord a
   * built-in default holds is taken — that is what rebinding is for — and the
   * command that loses it is named, since the key silently going dead is exactly
   * the surprise this message exists to prevent.
   */
  const setKeybinding = (id: string, value: string) => {
    const spec = BINDABLE.find(entry => entry.id === id)
    if (!spec) return
    const bindings = { ...view().keybindings }
    const typed = value.trim()
    if (typed === '') {
      delete bindings[id]
      patchConfig({ keybindings: bindings })
      return status.say(`${spec.label} back on its default key`)
    }
    if (isUnbound(typed)) {
      bindings[id] = ''
      patchConfig({ keybindings: bindings })
      return status.say(`${spec.label} unbound`)
    }
    const chord = parseChord(typed)
    if (!chord) return status.say(`"${typed}" is not a key chord — try Ctrl+${ALT}+K`, 'warn')
    const problem = bindingProblem(chord)
    if (problem) return status.say(problem, 'warn')
    const spelling = formatChord(chord, ALT)
    const held = customHolder(keymap(), chord, id)
    if (held) return status.say(`${spelling} is ${held.label} — unbind that one first`, 'warn')
    bindings[id] = spelling
    patchConfig({ keybindings: bindings })
    const taken = keymap().conflicts.find(clash => clash.key === spelling && !clash.rejected)
    status.say(
      taken
        ? `${spelling} → ${spec.label} — ${taken.loser} has no key now`
        : `${spelling} → ${spec.label}`,
    )
  }

  /** One shortcut as the page's list shows it: state, command, key in force. */
  const bindingLabel = (spec: Bindable) => {
    const key = keymap().display.get(spec.id) || 'unbound'
    return `${keymap().custom.has(spec.id) ? '*' : ' '} ${spec.label} — ${key}`
  }

  const bindingEdit = (spec: Bindable): SettingEdit => ({
    title: `Shortcut — ${spec.label}`,
    fields: [{ initial: keymap().display.get(spec.id) ?? '', placeholder: `Ctrl+${ALT}+K` }],
    // Short lines on purpose: beside a sidebar a longer one wraps mid-word.
    hint: [
      `One chord, e.g. Ctrl+G or Ctrl+${ALT}+K or F5`,
      'It needs Ctrl or a function key',
      '"none" takes the key away',
      'An empty value restores the default',
    ],
    apply: values => setKeybinding(spec.id, values[0] ?? ''),
  })

  const toggleDiffView = () => {
    patchConfig({ diffView: view().diffView === 'inline' ? 'split' : 'inline' })
  }

  const toggleGitPanelView = () => {
    const next = view().gitPanelView === 'tree' ? 'list' : 'tree'
    patchConfig({ gitPanelView: next })
    status.say(`Changed files as ${config.gitPanelView === 'tree' ? 'a tree' : 'a flat list'}`)
  }

  const toggleAutoSave = () => {
    patchConfig({ autoSaveOnBlur: !view().autoSaveOnBlur })
    status.say(`Auto-save ${onOff(config.autoSaveOnBlur)}`)
  }

  const applyReviewForge = (forge: ForgeSetting) => {
    patchConfig({ reviewForge: forge })
    status.say(
      forge === 'auto' ? "Forge: read off the remote's host" : `Forge: ${forge} whatever the host`,
    )
  }

  const applyReviewRemote = (value: string) => {
    const remote = value.trim() || 'origin'
    patchConfig({ reviewRemote: remote })
    status.say(`Pull requests read from "${remote}"`)
  }

  const toggleReviewAutoFetch = () => {
    patchConfig({ reviewAutoFetch: !view().reviewAutoFetch })
    status.say(`Fetching on open ${onOff(config.reviewAutoFetch)}`)
  }

  const toggleReviewInline = () => {
    patchConfig({ reviewInline: !view().reviewInline })
    status.say(`Inline review notes ${onOff(config.reviewInline)}`)
  }

  const toggleLsp = () => {
    patchConfig({ lsp: !view().lsp })
    status.say(`LSP diagnostics ${onOff(config.lsp)}`)
  }

  const toggleLspInline = () => {
    patchConfig({ lspInline: !view().lspInline })
    status.say(`Inline problem text ${onOff(config.lspInline)}`)
  }

  const toggleLspCompletion = () => {
    patchConfig({ lspCompletion: !view().lspCompletion })
    status.say(`Autocomplete ${onOff(config.lspCompletion)}`)
  }

  /** The typed TypeScript location; empty hands the choice back to the server. */
  const applyTypescriptTsdk = (value: string) => {
    const tsdk = value.trim()
    patchConfig({ typescriptTsdk: tsdk })
    status.say(
      tsdk ? `TypeScript: ${tsdk}` : "TypeScript: whichever the project's own server finds",
    )
  }

  const toggleLspAutoInstall = () => {
    patchConfig({ lspAutoInstall: !view().lspAutoInstall })
    status.say(`Offer to install servers ${onOff(config.lspAutoInstall)}`)
  }

  /**
   * Flip one server between enabled and disabled. Disabling writes the empty
   * command; re-enabling removes the override entirely, so a custom command set
   * by hand in the config file is not resurrected wrongly — the file is where
   * custom commands live, and the page only turns servers on and off.
   */
  const toggleServer = (id: string) => {
    const overrides = { ...view().lspServers }
    const disabled = overrides[id]?.length === 0
    if (disabled) delete overrides[id]
    else overrides[id] = []
    patchConfig({ lspServers: overrides })
    status.say(`LSP server "${id}" ${disabled ? 'enabled' : 'disabled'}`)
  }

  /** The page's one-line summary of a server: state, id, and the command it runs. */
  const serverLabel = (id: string, command: string[]) => {
    const override = view().lspServers[id]
    const enabled = override === undefined || override.length > 0
    const shown = override && override.length > 0 ? override : command
    return `${enabled ? '✓' : '✗'} ${id} — ${shown.join(' ')}`
  }

  const toggleDotfiles = () => {
    patchConfig({ showDotfiles: !view().showDotfiles })
    status.say(`Dotfiles ${config.showDotfiles ? 'shown' : 'hidden'}`)
  }

  const toggleGitignored = () => {
    patchConfig({ respectGitignore: !view().respectGitignore })
    status.say(`Git-ignored files ${config.respectGitignore ? 'hidden' : 'shown'}`)
  }

  /**
   * `'auto'` resolved against the terminal, then clamped against it again: a width
   * saved on a wide screen must not swallow the editor when the window is smaller
   * next time. The second clamp wins outright — below `SIDEBAR_MIN + EDITOR_MIN`
   * columns the tree gives up its minimum rather than leave the editor unusable.
   * The config value is untouched, so a saved width returns in full on a wide screen.
   */
  const treeWidth = () =>
    Math.max(
      0,
      Math.min(
        sidebarColumns(config.sidebarWidth, dimensions().width),
        dimensions().width - EDITOR_MIN,
      ),
    )

  const resizeSidebar = (width: number) => {
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)))
    if (next !== view().sidebarWidth) patchConfig({ sidebarWidth: next })
  }

  /**
   * Step the width by `delta`, from what is on screen rather than from the config.
   * On a window too narrow to honour a large saved width that does discard it — but
   * the alternative is a key that visibly does nothing while quietly counting down.
   */
  const nudgeSidebar = (delta: number) => resizeSidebar(treeWidth() + delta)

  /** The typed width: a column count (clamped as `[`/`]` are) or `auto`. */
  const applySidebarWidth = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === '' || trimmed === 'auto') {
      patchConfig({ sidebarWidth: 'auto' })
      return status.say('Sidebar width: auto')
    }
    const width = Number(trimmed)
    if (!Number.isFinite(width)) {
      return status.say(`Sidebar width is a number of columns, or "auto"`, 'warn')
    }
    resizeSidebar(width)
    status.say(`Sidebar width: ${view().sidebarWidth}`)
  }

  /** The rows as this module declares them: what the page draws, plus the key it edits. */
  type RowSpec = Omit<SettingRow, 'local' | 'clear'> & { key: keyof Config }

  /** The settings page's rows: current values plus their step actions, in display order. */
  const specs = (): RowSpec[] => [
    {
      section: 'Appearance',
      key: 'theme',
      label: 'Theme',
      value: themeLabel(view().theme),
      cycle: dir => applyTheme(step(themeList(), view().theme, dir)),
      select: {
        options: themeList().map(themeLabel),
        pick: at => applyTheme(themeList()[at]!),
        preview: at => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
    },
    {
      section: 'Appearance',
      key: 'themeSync',
      label: 'Follow OS appearance',
      value: onOff(view().themeSync),
      cycle: toggleThemeSync,
    },
    {
      section: 'Appearance',
      key: 'themeLight',
      label: 'Light theme',
      value: themeLabel(view().themeLight),
      cycle: dir => applySideTheme('themeLight', step(themeList(), view().themeLight, dir)),
      select: {
        options: themeList().map(themeLabel),
        pick: at => applySideTheme('themeLight', themeList()[at]!),
        preview: at => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
    },
    {
      section: 'Appearance',
      key: 'themeDark',
      label: 'Dark theme',
      value: themeLabel(view().themeDark),
      cycle: dir => applySideTheme('themeDark', step(themeList(), view().themeDark, dir)),
      select: {
        options: themeList().map(themeLabel),
        pick: at => applySideTheme('themeDark', themeList()[at]!),
        preview: at => paintTheme(themeList()[at]!),
        restore: restoreTheme,
      },
    },
    {
      section: 'Appearance',
      key: 'transparent',
      label: 'Transparent background',
      value: onOff(view().transparent),
      cycle: toggleTransparent,
    },
    {
      section: 'Appearance',
      key: 'iconTheme',
      label: 'File icons',
      value: iconThemeLabel(view().iconTheme),
      cycle: dir => applyIconTheme(step(iconList(), view().iconTheme, dir)),
      select: {
        options: iconList().map(iconThemeLabel),
        pick: at => applyIconTheme(iconList()[at]!),
      },
    },
    {
      section: 'Editor',
      key: 'vim',
      label: 'Vim mode',
      value: onOff(view().vim),
      cycle: () => applyVim(!view().vim),
    },
    {
      section: 'Editor',
      key: 'cursorStyle',
      label: 'Cursor',
      // Said on the row rather than left to the status line, which is gone by the time
      // anyone wonders why the caret did not change.
      //
      // `config.vim` and not `view().vim`, unlike the value beside it: the note is about
      // the caret actually on screen, and a project file pinning vim on overrides it
      // whatever the user's own file says. The shape stays `view()`'s, because that is
      // the value this page edits and marks as overridden.
      value: config.vim ? `${view().cursorStyle} (vim overrides)` : view().cursorStyle,
      cycle: dir => applyCursorStyle(step(CURSOR_STYLES, view().cursorStyle, dir)),
      select: {
        options: [...CURSOR_STYLES],
        pick: at => applyCursorStyle(CURSOR_STYLES[at]!),
      },
    },
    {
      section: 'Editor',
      key: 'wrap',
      label: 'Word wrap',
      value: onOff(view().wrap),
      cycle: toggleWrap,
    },
    {
      section: 'Editor',
      key: 'tabSize',
      label: 'Tab size',
      value: String(view().tabSize),
      cycle: dir => applyTabSize(step(TAB_SIZES, view().tabSize, dir)),
      select: {
        options: TAB_SIZES.map(String),
        pick: at => applyTabSize(TAB_SIZES[at]!),
      },
    },
    {
      section: 'Editor',
      key: 'trimOnSave',
      label: 'Trim trailing whitespace on save',
      value: onOff(view().trimOnSave),
      cycle: toggleTrim,
    },
    {
      section: 'Editor',
      key: 'formatOnSave',
      label: 'Format on save',
      value: onOff(view().formatOnSave),
      cycle: toggleFormatOnSave,
    },
    {
      // Enter lists the configured entries plus an "add" row; picking one opens
      // a text field, since a command is no pick-a-value setting.
      section: 'Editor',
      key: 'formatters',
      label: 'Formatters',
      value:
        Object.keys(view().formatters).length === 0
          ? 'none'
          : `${Object.keys(view().formatters).length} configured`,
      cycle: () => status.say('Enter opens the formatter list'),
      select: {
        options: [
          ...Object.entries(view().formatters).map(([key, cmd]) => formatterOption(key, cmd)),
          '+ Add formatter…',
        ],
        pick: formatterEdit,
      },
    },
    {
      section: 'Editor',
      key: 'autoSaveOnBlur',
      label: 'Auto-save on tab switch and terminal blur',
      value: onOff(view().autoSaveOnBlur),
      cycle: toggleAutoSave,
    },
    {
      section: 'Files',
      key: 'showDotfiles',
      label: 'Show dotfiles',
      value: onOff(view().showDotfiles),
      cycle: toggleDotfiles,
    },
    {
      section: 'Files',
      key: 'respectGitignore',
      label: 'Hide git-ignored files',
      value: onOff(view().respectGitignore),
      cycle: toggleGitignored,
    },
    {
      section: 'Files',
      key: 'sidebarWidth',
      label: 'Sidebar width',
      value: view().sidebarWidth === 'auto' ? 'auto' : String(view().sidebarWidth),
      cycle: dir => nudgeSidebar(dir),
      edit: {
        title: 'Sidebar width',
        fields: [
          {
            initial: view().sidebarWidth === 'auto' ? 'auto' : String(view().sidebarWidth),
            placeholder: `auto, or ${SIDEBAR_MIN}–${SIDEBAR_MAX}`,
          },
        ],
        hint: [
          `A column count, ${SIDEBAR_MIN}–${SIDEBAR_MAX}`,
          '"auto" takes a share of the terminal',
        ],
        apply: values => applySidebarWidth(values[0] ?? ''),
      },
    },
    {
      // Two values: a list to choose between them is more ceremony than the
      // flip is worth, so this stays a step like the booleans above.
      section: 'Git',
      key: 'diffView',
      label: 'Diff layout',
      value: view().diffView === 'inline' ? 'inline' : 'side-by-side',
      cycle: toggleDiffView,
    },
    {
      section: 'Git',
      key: 'gitPanelView',
      label: 'Changed files',
      value: view().gitPanelView === 'tree' ? 'tree' : 'flat list',
      cycle: toggleGitPanelView,
    },
    {
      section: 'Git',
      key: 'gitScanDepth',
      label: 'Scan for repositories below the folder',
      value: depthLabel(view().gitScanDepth),
      cycle: dir => applyScanDepth(step(SCAN_DEPTHS, view().gitScanDepth, dir)),
      select: {
        options: SCAN_DEPTHS.map(depthLabel),
        pick: at => applyScanDepth(SCAN_DEPTHS[at]!),
      },
    },
    {
      section: 'Review',
      key: 'reviewForge',
      label: 'Pull requests come from',
      value: view().reviewForge,
      cycle: dir => applyReviewForge(step(FORGE_SETTINGS, view().reviewForge, dir)),
      select: {
        options: [...FORGE_SETTINGS],
        pick: at => applyReviewForge(FORGE_SETTINGS[at]!),
      },
    },
    {
      // Free text: a remote is a name only this repository knows, and the only
      // answers that matter are `origin` and whatever a fork workflow calls it.
      section: 'Review',
      key: 'reviewRemote',
      label: 'Remote to ask',
      value: view().reviewRemote,
      cycle: () => status.say('Enter sets the remote name'),
      edit: {
        title: 'Remote to ask for pull requests',
        fields: [{ initial: view().reviewRemote, placeholder: 'origin' }],
        hint: ['A git remote name — its URL says which forge', 'Empty: origin'],
        apply: values => applyReviewRemote(values[0] ?? ''),
      },
    },
    {
      section: 'Review',
      key: 'reviewAutoFetch',
      label: 'Fetch comments on open',
      value: onOff(view().reviewAutoFetch),
      cycle: toggleReviewAutoFetch,
    },
    {
      section: 'Review',
      key: 'reviewInline',
      label: 'Inline review notes',
      value: onOff(view().reviewInline),
      cycle: toggleReviewInline,
    },
    {
      section: 'Language servers',
      key: 'lsp',
      label: 'LSP diagnostics',
      value: onOff(view().lsp),
      cycle: toggleLsp,
    },
    {
      section: 'Language servers',
      key: 'lspInline',
      label: 'Inline problem text',
      value: onOff(view().lspInline),
      cycle: toggleLspInline,
    },
    {
      section: 'Language servers',
      key: 'lspCompletion',
      label: 'Autocomplete',
      value: onOff(view().lspCompletion),
      cycle: toggleLspCompletion,
    },
    {
      section: 'Language servers',
      key: 'lspAutoInstall',
      label: 'Offer to install servers',
      value: onOff(view().lspAutoInstall),
      cycle: toggleLspAutoInstall,
    },
    {
      section: 'Language servers',
      key: 'typescriptTsdk',
      label: 'TypeScript',
      value: view().typescriptTsdk || 'from the project',
      cycle: () => status.say('Enter sets a TypeScript path'),
      edit: {
        title: 'TypeScript path',
        fields: [{ initial: view().typescriptTsdk, placeholder: 'node_modules/typescript/lib' }],
        hint: [
          'A tsserver.js, a lib folder, or a typescript package',
          "Empty: the project's own copy, else the one druk installed",
        ],
        apply: values => applyTypescriptTsdk(values[0] ?? ''),
      },
    },
    {
      // One row, not fourteen: Enter lists every known server and picking one
      // flips it. Custom commands live on the row below.
      section: 'Language servers',
      key: 'lspServers',
      label: 'Servers',
      value: `${servers().filter(s => (view().lspServers[s.id]?.length ?? 1) > 0).length}/${servers().length} enabled`,
      cycle: () => status.say('Enter opens the server list'),
      select: {
        options: servers().map(spec => serverLabel(spec.id, spec.command)),
        pick: at => toggleServer(servers()[at]!.id),
      },
    },
    {
      section: 'Language servers',
      key: 'lspServers',
      label: 'Server commands',
      value: `${Object.values(view().lspServers).filter(cmd => cmd.length > 0).length} custom`,
      cycle: () => status.say('Enter opens the server list'),
      select: {
        options: servers().map(spec => serverLabel(spec.id, spec.command)),
        pick: at => {
          const spec = servers()[at]!
          const override = view().lspServers[spec.id]
          return {
            title: `Command — ${spec.id}`,
            fields: [
              { initial: (override && override.length > 0 ? override : spec.command).join(' ') },
            ],
            hint: [
              'Runs as given — it talks LSP over stdio,',
              'so no file path is added',
              'An empty value restores the default',
            ],
            apply: (values: string[]) => setServerCommand(spec.id, values[0] ?? ''),
          }
        },
      },
    },
    {
      // One row for the lot, as the servers have: Enter lists every bindable
      // command with the key it answers to, and picking one opens a field to type
      // a chord into. The clash count is on the value because a shortcut that
      // quietly lost its key is the one thing a user cannot see from the list.
      section: 'Keyboard',
      key: 'keybindings',
      label: 'Shortcuts',
      value: `${keymap().custom.size} custom${keymap().conflicts.length > 0 ? ` · ${keymap().conflicts.length} clash` : ''}`,
      cycle: () => status.say('Enter opens the shortcut list'),
      select: {
        options: BINDABLE.map(bindingLabel),
        pick: at => bindingEdit(BINDABLE[at]!),
      },
    },
    {
      // The sidebar's extensions panel is where they are installed and turned
      // off; what is left here is the two that are settings — a switch and a
      // URL, neither of which belongs in a sidebar column.
      section: 'Extensions',
      key: 'extensionUpdates',
      label: 'Check the market at startup',
      value: onOff(view().extensionUpdates),
      cycle: toggleMarket,
    },
    {
      // Free text: a registry is a URL nobody would pick from a list, and the
      // only two answers that matter are druk's own and a fork's.
      section: 'Extensions',
      key: 'extensionRegistry',
      label: 'Registry',
      value: view().extensionRegistry === MARKET_URL ? 'druk' : view().extensionRegistry,
      cycle: () => status.say('Enter sets the market URL'),
      edit: {
        title: 'Extension registry',
        fields: [{ initial: view().extensionRegistry, placeholder: MARKET_URL }],
        hint: ['An https folder holding index.json and <id>/extension.json', 'Empty: druk’s own'],
        apply: values => applyRegistry(values[0] ?? ''),
      },
    },
  ]

  /**
   * What the page draws. `local` and the reset come from the layers rather than
   * from each row: only the project file can be reset, and only while it is the
   * file on show — the user's own value is the base, with nothing underneath it.
   */
  const rows = (): SettingRow[] =>
    specs().map(({ key, ...row }) => ({
      ...row,
      local: project[key] !== undefined,
      clear:
        scope() === 'project' && project[key] !== undefined
          ? () => clearOverride(key, row.label)
          : undefined,
    }))

  return {
    config,
    keymap,
    setKeybinding,
    scope,
    toggleScope,
    setScope,
    configFile,
    patchConfig,
    patchUserConfig,
    applyTheme,
    applyAppearance,
    previewTheme: paintTheme,
    restoreTheme,
    toggleThemeSync,
    toggleTransparent,
    toggleWrap,
    applyTabSize,
    applyVim,
    toggleTrim,
    toggleFormatOnSave,
    toggleAutoSave,
    toggleDiffView,
    toggleGitPanelView,
    toggleDotfiles,
    toggleGitignored,
    applyReviewForge,
    applyReviewRemote,
    toggleReviewInline,
    toggleLsp,
    toggleLspInline,
    toggleLspCompletion,
    toggleServer,
    applyIconTheme,
    activeIconTheme,
    previewIcons,
    restoreIcons,
    reloadExtensions,
    toggleExtension,
    toggleMarket,
    applyRegistry,
    setFormatter,
    setServerCommand,
    applySidebarWidth,
    rows,
    treeWidth,
    resizeSidebar,
    nudgeSidebar,
  }
}

export type Settings = ReturnType<typeof createSettings>
