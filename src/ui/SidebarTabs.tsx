import { TextAttributes } from '@opentui/core'
import { For } from 'solid-js'

import { ui } from '../themes'

export type SidebarView = 'files' | 'git' | 'review' | 'extensions'

export interface SidebarTabsProps {
  view: SidebarView
  /** The sidebar holds the keyboard: the pressed button fills brighter with it. */
  focused: boolean
  /** Columns the strip has. Narrower than the names need, it falls to initials. */
  width: number
  onSelect: (view: SidebarView) => void
}

// No review tab: the review is reached from the `◆` in the source-control
// panel's header, being about the change that panel is already listing.
const TABS: { id: SidebarView; label: string; short: string }[] = [
  { id: 'files', label: 'Files', short: 'F' },
  { id: 'git', label: 'Git', short: 'G' },
  { id: 'extensions', label: 'Ext', short: 'E' },
]

/**
 * A button costs its label, a column of gutter, and — unless the strip has run
 * out of room — one of padding either side.
 */
const stripWidth = (labels: string[], padding: number) =>
  1 + labels.reduce((sum, label) => sum + label.length + 1 + 2 * padding, 0)

const NAMES = TABS.map(tab => tab.label)
const INITIALS = TABS.map(tab => tab.short)

/**
 * The sidebar's views as a row of buttons: the one on screen is the pressed
 * one, filled the way the status bar fills — `statusBg`/`statusFg` is the only
 * pair in the palette guaranteed to be legible together in every theme, which an
 * accent-on-panel guess is not.
 *
 * The strip's own background is `barBg`, not `panelBg`, and it starts with a
 * one-column gutter of it. Both matter: the sidebar's right edge is found by
 * where `panelBg` stops on a row, so a row that begins in panel colour and
 * changes mid-way would move the divider the resize code and its tests look for.
 */
export function SidebarTabs(props: SidebarTabsProps) {
  // Initials beside a narrow sidebar, as the settings page's hints do it, and
  // then initials with the padding dropped: the strip cannot wrap, and
  // overflowing it paints the buttons over whatever is in the editor's slot.
  const long = () => stripWidth(NAMES, 1) <= props.width
  const padded = () => long() || stripWidth(INITIALS, 1) <= props.width
  const pad = () => (padded() ? 1 : 0)
  return (
    <box height={1} flexDirection="row" flexShrink={0} backgroundColor={ui.barBg}>
      <box width={1} flexShrink={0} backgroundColor={ui.barBg} />
      <For each={TABS}>
        {tab => {
          const active = () => props.view === tab.id
          // Unfocused keeps the fill but drops to the tree's own selection colour:
          // which view is up is not the same fact as who has the keyboard.
          const bg = () =>
            active() ? (props.focused ? ui.statusBg : ui.treeSelectedBg) : ui.sidebarBg
          const fg = () => (active() ? (props.focused ? ui.statusFg : ui.text) : ui.inactiveTabFg)
          return (
            <>
              <box
                flexDirection="row"
                flexShrink={0}
                backgroundColor={bg()}
                paddingLeft={pad()}
                paddingRight={pad()}
                onMouseDown={() => props.onSelect(tab.id)}
              >
                <text
                  fg={fg()}
                  bg={bg()}
                  content={long() ? tab.label : tab.short}
                  attributes={active() ? TextAttributes.BOLD : undefined}
                />
              </box>
              <box width={1} flexShrink={0} backgroundColor={ui.barBg} />
            </>
          )
        }}
      </For>
      <box flexGrow={1} backgroundColor={ui.barBg} />
    </box>
  )
}
