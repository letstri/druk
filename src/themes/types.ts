import type { StyleDefinitionInput } from '@opentui/core'

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
  currentLine: string
  indentGuide: string
  gitAdded: string
  gitModified: string
  gitDeleted: string
}

// `transparent` empties `bg`/`barBg`/`sidebarBg`; the `solid*` pair keeps the real colours.
export interface UiColors extends ThemeUi {
  sidebarBg: string
  solidBg: string
  solidBarBg: string
  border: string
  hoverBg: string
}

export interface Theme {
  name: string
  ui: ThemeUi
  syntax: Record<string, StyleDefinitionInput>
}
