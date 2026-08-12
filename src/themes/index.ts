/**
 * Theme registry — the two themes druk ships, and the table extensions add to.
 *
 * Only the defaults are built in: `theme`, `themeLight` and `themeDark` all
 * name one of these, so they have to exist before any extension is read. Every
 * other palette druk once carried is an extension in the market (`extensions/` in this
 * repository), installed through the palette's Extensions menu — which is what
 * lets a new theme reach users without a druk release.
 *
 * An extension registers one at runtime through `registerTheme`, so every lookup
 * goes through `registry` rather than through `THEMES` itself — `THEMES` is the
 * built-in table, `registry` is what is actually on offer.
 */
import type { StyleDefinitionInput } from '@opentui/core'
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'

import { githubDark } from './github-dark'
import { githubLight } from './github-light'
import type { Theme, ThemeUi, UiColors } from './types'

export type { Theme, ThemeUi, UiColors }

export const THEMES = {
  dark: githubDark,
  light: githubLight,
}

/**
 * A theme id. Not `keyof typeof THEMES`: an extension's theme is as real as a
 * built-in one and its id is not known at compile time. `isThemeName` is what
 * says an id is registered, and the config validator runs it.
 */
export type ThemeName = string

/**
 * The shipped themes, keyed loosely so an id computed at runtime can reach them.
 * Kept beside the registry because an extension may register *over* a built-in id —
 * dropping that extension has to put the shipped theme back rather than leave a
 * hole where `dark` used to be.
 */
const BUILTIN: Record<string, Theme> = { ...THEMES }

/** Every theme on offer — the built-ins, plus whatever extensions registered. */
const registry: Record<string, Theme> = { ...THEMES }

/** Registered by an extension, and dropped again when extensions reload. */
const fromExtensions = new Set<string>()

// A signal, not `Object.keys(registry)` on demand: the palette's command tree and
// the settings page's theme lists are built inside reactive scopes, and an extension
// reload that only mutated the object would leave both showing the old set.
const [names, setNames] = createSignal<ThemeName[]>(Object.keys(registry))

export function registerTheme(id: string, theme: Theme): void {
  registry[id] = theme
  fromExtensions.add(id)
  setNames(Object.keys(registry))
}

export function clearExtensionThemes(): void {
  for (const id of fromExtensions) {
    const shipped = BUILTIN[id]
    if (shipped) registry[id] = shipped
    else delete registry[id]
  }
  fromExtensions.clear()
  setNames(Object.keys(registry))
}

export const themeNames = (): ThemeName[] => names()

const DEFAULT: ThemeName = 'dark'

/**
 * The theme `name` stands for, falling back to the default: an extension can be
 * uninstalled while the config still names one of its themes, and every reader
 * here has to end up with colors rather than with a hole.
 */
export const themeFor = (name: ThemeName): Theme => registry[name] ?? registry[DEFAULT]!

export const themeLabel = (name: ThemeName): string => registry[name]?.name ?? name

/** Whether the app paints its own background at all — the `transparent` setting. */
let seeThrough = false

/**
 * Mix two `#rrggbb` colors. Here rather than from `languages/highlight`, whose
 * own mixer reads `ui` — importing it back would close the cycle.
 */
function mix(base: string, tint: string, amount: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  if (!/^#[0-9a-f]{6}$/i.test(base) || !/^#[0-9a-f]{6}$/i.test(tint)) return base
  const to = (at: number) =>
    Math.round(channel(base, at) + (channel(tint, at) - channel(base, at)) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${to(1)}${to(3)}${to(5)}`
}

/** The store's contents for a theme, with `transparent` applied or not. */
function colorsFor(name: ThemeName, transparent: boolean): UiColors {
  const theme = themeFor(name).ui
  return {
    ...theme,
    sidebarBg: transparent ? 'transparent' : theme.panelBg,
    solidBg: theme.bg,
    solidBarBg: theme.barBg,
    // Derived, not per-theme: 26 palettes would each need a hand-picked rule, and
    // a hairline is the same idea in all of them — the bar colour pushed a little
    // further from the background it sits on.
    border: mix(theme.barBg, theme.dim, 0.35),
    hoverBg: mix(theme.panelBg, theme.text, 0.07),
    ...(transparent ? { bg: 'transparent', barBg: 'transparent' } : null),
  }
}

// `ui` is a store, not a plain object: Solid components never re-render, so a
// mutated object would leave every color on screen stale after a theme switch.
// Reading `ui.bg` inside JSX subscribes that spot to the change.
const [ui, setUi] = createStore<UiColors>(colorsFor(DEFAULT, seeThrough))
export { ui }

// The theme currently on screen — including a live preview that has not been
// written to config. The editor keys its syntax table off this, not off the
// config value: a preview that only updated `ui` left the buffer on the old
// style ids until the next keystroke.
const [paintedTheme, setPaintedTheme] = createSignal<ThemeName>(DEFAULT)
export { paintedTheme }

// Read imperatively when the syntax style table is rebuilt, so a plain object is fine.
export const syntaxTheme: Record<string, StyleDefinitionInput> = { ...themeFor(DEFAULT).syntax }

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in registry
}

export function setTheme(name: ThemeName): void {
  // What is really on screen, which is the default when the config names a
  // theme no extension is registering any more.
  const painted = name in registry ? name : DEFAULT
  // Replace, never merge: a group the new theme omits would otherwise keep the
  // previous theme's color and render invisible when light/dark flips.
  // Data before the signal: reactive readers of `paintedTheme` rebuild the
  // syntax table, and must see this theme's colors when they do.
  for (const group of Object.keys(syntaxTheme)) delete syntaxTheme[group]
  Object.assign(syntaxTheme, themeFor(painted).syntax)
  setUi(colorsFor(painted, seeThrough))
  setPaintedTheme(painted)
}

/** Paint the app's own background, or leave the terminal's showing through. */
export function setTransparency(on: boolean): void {
  seeThrough = on
  setUi(colorsFor(paintedTheme(), on))
}
