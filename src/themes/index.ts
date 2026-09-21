import type { StyleDefinitionInput } from '@opentui/core'
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'

import { githubDark } from './github-dark'
import { githubLight } from './github-light'
import type { Theme, UiColors } from './types'

export type { Theme, ThemeUi } from './types'

export const THEMES = {
  dark: githubDark,
  light: githubLight,
}

// Not `keyof typeof THEMES`: an extension's theme id is not known at compile time.
export type ThemeName = string

// An extension may register *over* a built-in id; dropping it must put the shipped theme back.
const BUILTIN: Record<string, Theme> = { ...THEMES }

const registry: Record<string, Theme> = { ...THEMES }

const fromExtensions = new Set<string>()

// A signal, not `Object.keys(registry)` on demand: the lists are built in reactive scopes.
const [names, setNames] = createSignal<ThemeName[]>(Object.keys(registry))

export function registerTheme(id: string, theme: Theme): void {
  registry[id] = theme
  fromExtensions.add(id)
  setNames(Object.keys(registry))
}

export function clearExtensionThemes(): void {
  for (const id of fromExtensions) {
    const shipped = BUILTIN[id]
    if (shipped) {
      registry[id] = shipped
    } else {
      Reflect.deleteProperty(registry, id)
    }
  }
  fromExtensions.clear()
  setNames(Object.keys(registry))
}

export const themeNames = (): ThemeName[] => names()

const DEFAULT: ThemeName = 'dark'

export const themeFor = (name: ThemeName): Theme =>
  registry[name] ?? registry[DEFAULT]!

export const themeLabel = (name: ThemeName): string =>
  registry[name]?.name ?? name

let seeThrough = false

// Here, not in `languages/highlight`: that module imports this one, so the other way cycles.
export function mixColors(base: string, tint: string, amount: number): string {
  const channel = (hex: string, at: number) =>
    Number.parseInt(hex.slice(at, at + 2), 16)
  if (!/^#[0-9a-f]{6}$/iu.test(base) || !/^#[0-9a-f]{6}$/iu.test(tint)) {
    return base
  }
  const to = (at: number) =>
    Math.round(
      channel(base, at) + (channel(tint, at) - channel(base, at)) * amount
    )
      .toString(16)
      .padStart(2, '0')
  return `#${to(1)}${to(3)}${to(5)}`
}

function colorsFor(name: ThemeName, transparent: boolean): UiColors {
  const theme = themeFor(name).ui
  return {
    ...theme,
    // Derived, not per-theme: a hairline is the same relationship under every palette.
    border: mixColors(theme.barBg, theme.dim, 0.35),
    hoverBg: mixColors(theme.panelBg, theme.text, 0.07),
    sidebarBg: transparent ? 'transparent' : theme.panelBg,
    solidBarBg: theme.barBg,
    solidBg: theme.bg,
    ...(transparent ? { barBg: 'transparent', bg: 'transparent' } : null),
  }
}

// A store, not a plain object: Solid never re-renders, so a mutation would leave colours stale.
const [ui, setUi] = createStore<UiColors>(colorsFor(DEFAULT, seeThrough))
export { ui }

// What is on screen, preview included: the syntax table keys off this, not the config value.
const [paintedTheme, setPaintedTheme] = createSignal<ThemeName>(DEFAULT)
export { paintedTheme }

// Read imperatively when the syntax style table is rebuilt, so a plain object is fine.
export const syntaxTheme: Record<string, StyleDefinitionInput> = {
  ...themeFor(DEFAULT).syntax,
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in registry
}

// Relative luminance of the editor background: a theme declares no appearance of its own.
function isDark(bg: string): boolean {
  if (!/^#[0-9a-f]{6}$/iu.test(bg)) {
    return true
  }
  const channel = (at: number) => Number.parseInt(bg.slice(at, at + 2), 16)
  return channel(1) * 0.299 + channel(3) * 0.587 + channel(5) * 0.114 < 128
}

export function setTheme(name: ThemeName): void {
  const painted = name in registry ? name : DEFAULT
  const theme = themeFor(painted)
  // Replace, never merge (an omitted group keeps the old colour), and data before the signal.
  // A theme that lists *no* usable group is the one exception: every span would paint as plain
  // text, so the shipped palette of the same appearance stands in whole. A theme that lists some
  // is left alone — `FALLBACK_GROUP` walks the rest onto its own colours, not github's.
  for (const group of Object.keys(syntaxTheme)) {
    Reflect.deleteProperty(syntaxTheme, group)
  }
  const own = Object.keys(theme.syntax).length > 0
  Object.assign(
    syntaxTheme,
    own ? theme.syntax : (isDark(theme.ui.bg) ? githubDark : githubLight).syntax
  )
  setUi(colorsFor(painted, seeThrough))
  setPaintedTheme(painted)
}

export function setTransparency(on: boolean): void {
  seeThrough = on
  setUi(colorsFor(paintedTheme(), on))
}
