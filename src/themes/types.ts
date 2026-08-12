import type { StyleDefinitionInput } from '@opentui/core'

/** Colors for chrome: panels, tabs, tree, status bar, cursor. */
export interface ThemeUi {
  bg: string
  panelBg: string
  barBg: string
  statusBg: string
  statusFg: string
  text: string
  dim: string
  faint: string
  accent: string
  activeTabFg: string
  inactiveTabFg: string
  treeSelectedBg: string
  treeFocusBg: string
  dirty: string
  error: string
  folder: string
  cursor: string
  scrollbar: string
  gutter: string
  /** Background fill behind the line the cursor is on. Keep it near `bg`. */
  currentLine: string
  /** Indent guide column. Barely off `bg` — it should read as a hint, not a rule. */
  indentGuide: string
  gitAdded: string
  gitModified: string
  gitDeleted: string
}

/**
 * What components actually read: the theme's colors plus the surfaces derived
 * from them.
 *
 * `bg`, `barBg` and `sidebarBg` are the app's own background — the `transparent`
 * setting empties all three so the terminal (translucent or not) shows through.
 * Anything that floats over content has to stay painted, or the editor reads
 * through it: `panelBg` is that surface, and `solidBg` / `solidBarBg` are the two
 * tones a floating panel builds out of `bg` and `barBg`. Blending a color against
 * the background (tinted diagnostic spans) also needs `solidBg` — a mix with
 * `"transparent"` is not a color.
 */
export interface UiColors extends ThemeUi {
  /** Sidebar background: `panelBg`, emptied by `transparent`. */
  sidebarBg: string
  /** The theme's `bg`, whatever `transparent` did to `bg` itself. */
  solidBg: string
  /** The theme's `barBg`, whatever `transparent` did to `barBg` itself. */
  solidBarBg: string
  /**
   * Hairline rules — the sidebar's edge, a modal's border, the strip under the
   * tabs. Derived from the theme rather than listed by it: it has to read as the
   * quietest line on screen, which is a relationship between two colours, not a
   * colour anyone would pick.
   */
  border: string
  /**
   * The fill under the pointer on anything clickable — rows, tabs, the small
   * buttons. Derived like `border`: it is the panel background nudged toward the
   * text, so it stays a hint under every palette, and it stays painted under
   * `transparent` — feedback is the point of it.
   */
  hoverBg: string
}

/**
 * `syntax` maps tree-sitter capture groups to styles. Sub-scopes fall back to
 * their parent ("type.builtin" → "type"), so listing base scopes is enough.
 */
export interface Theme {
  name: string
  ui: ThemeUi
  syntax: Record<string, StyleDefinitionInput>
}
