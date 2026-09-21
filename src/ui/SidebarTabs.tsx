import { TextAttributes } from '@opentui/core'
import { For } from 'solid-js'

import { ui } from '../themes'
import { useTooltip } from './tooltip'

export type SidebarView = 'files' | 'git' | 'review' | 'extensions'

interface SidebarTabsProps {
  view: SidebarView
  focused: boolean
  width: number
  reviewCount: number
  onSelect: (view: SidebarView) => void
}

const TABS: {
  id: SidebarView
  label: string
  short: string
  command?: string
}[] = [
  { id: 'files', label: 'Files', short: 'F' },
  { command: 'view.git', id: 'git', label: 'Git', short: 'G' },
  { command: 'view.review', id: 'review', label: 'Review', short: 'R' },
  { command: 'view.extensions', id: 'extensions', label: 'Ext', short: 'E' },
]

const stripWidth = (labels: string[], padding: number) =>
  1 + labels.reduce((sum, label) => sum + label.length + 1 + 2 * padding, 0)

const INITIALS = TABS.map((tab) => tab.short)

// `barBg`, never `panelBg`: the sidebar's right edge is found by where `panelBg` stops on a row.
export function SidebarTabs(props: SidebarTabsProps) {
  const nameOf = (tab: (typeof TABS)[number]) =>
    tab.id === 'review' && props.reviewCount > 0
      ? `${tab.label} ${props.reviewCount}`
      : tab.label
  const long = () => stripWidth(TABS.map(nameOf), 1) <= props.width
  const padded = () => long() || stripWidth(INITIALS, 1) <= props.width
  const pad = () => (padded() ? 1 : 0)
  return (
    <box
      height={1}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={ui.barBg}
    >
      <box width={1} flexShrink={0} backgroundColor={ui.barBg} />
      <For each={TABS}>
        {(tab) => {
          const active = () => props.view === tab.id
          const hover = useTooltip(tab.command)
          const bg = () =>
            active()
              ? props.focused
                ? ui.statusBg
                : ui.treeSelectedBg
              : hover.lit()
                ? ui.hoverBg
                : ui.sidebarBg
          const fg = () =>
            active()
              ? props.focused
                ? ui.statusFg
                : ui.text
              : ui.inactiveTabFg
          return (
            <>
              <box
                ref={hover.ref}
                flexDirection="row"
                flexShrink={0}
                backgroundColor={bg()}
                paddingLeft={pad()}
                paddingRight={pad()}
                onMouseDown={() => props.onSelect(tab.id)}
                onMouseOver={hover.enter}
                onMouseOut={hover.leave}
              >
                <text
                  fg={fg()}
                  bg={bg()}
                  content={long() ? nameOf(tab) : tab.short}
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
