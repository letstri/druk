import { createStore, unwrap } from 'solid-js/store'

import { saveConfig, sidebarColumns, SIDEBAR_MIN, SIDEBAR_MAX } from '../core/config'
import type { Config } from '../core/config'
import { invalidateSyntaxStyle } from '../languages/highlight'
import { setTheme, themeLabels } from '../themes'
import type { ThemeName } from '../themes'
import type { EditorBridge } from './editor'
import type { Status } from './status'

/** Columns the editor keeps for itself, whatever width the sidebar was saved at. */
const EDITOR_MIN = 20

/** The config store and every action that edits and persists it. */
export function createSettings(deps: {
  initial: Config
  status: Status
  editor: EditorBridge
  dimensions: () => { width: number; height: number }
}) {
  const { status, editor, dimensions } = deps
  const [config, setConfig] = createStore<Config>({ ...deps.initial })

  const patchConfig = (patch: Partial<Config>) => {
    setConfig(patch)
    saveConfig(unwrap(config))
  }

  const applyTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
    patchConfig({ theme: name })
    status.say(`Theme: ${themeLabels[name]}`)
  }

  const applyTabSize = (size: number) => {
    patchConfig({ tabSize: size })
    status.say(`Tab size: ${size}`)
  }

  const applyVim = (enabled: boolean) => {
    editor.setVimMode(enabled ? 'normal' : null)
    patchConfig({ vim: enabled })
    status.say(`Vim mode ${enabled ? 'on' : 'off'}`)
  }

  const applyKeybindings = (keybindings: Config['keybindings']) => {
    patchConfig({ keybindings })
    status.say(
      keybindings === 'vscode'
        ? 'VS Code keys — Ctrl+P opens a file, F1 the palette'
        : 'VS Code keys off',
    )
  }

  const toggleTrim = () => {
    patchConfig({ trimOnSave: !config.trimOnSave })
    status.say(`Trim on save ${config.trimOnSave ? 'on' : 'off'}`)
  }

  const toggleDiffView = () => {
    const next = config.diffView === 'inline' ? 'split' : 'inline'
    patchConfig({ diffView: next })
  }

  const toggleAutoSave = () => {
    patchConfig({ autoSaveOnBlur: !config.autoSaveOnBlur })
    status.say(`Auto-save ${config.autoSaveOnBlur ? 'on' : 'off'}`)
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
    if (next !== config.sidebarWidth) patchConfig({ sidebarWidth: next })
  }

  /**
   * Step the width by `delta`, from what is on screen rather than from the config.
   * On a window too narrow to honour a large saved width that does discard it — but
   * the alternative is a key that visibly does nothing while quietly counting down.
   */
  const nudgeSidebar = (delta: number) => resizeSidebar(treeWidth() + delta)

  return {
    config,
    patchConfig,
    applyTheme,
    applyTabSize,
    applyVim,
    applyKeybindings,
    toggleTrim,
    toggleAutoSave,
    toggleDiffView,
    treeWidth,
    resizeSidebar,
    nudgeSidebar,
  }
}

export type Settings = ReturnType<typeof createSettings>
