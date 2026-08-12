import { TextAttributes } from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import { ui } from '../themes'
import { useHover } from './hover'
import { SEVERITY_COLOR, SEVERITY_GLYPH } from './severity'

/** Worst diagnostic a tab's file carries. Info and hints are not a tab's business. */
export type TabSeverity = 'error' | 'warning'

export interface TabInfo {
  /** What the callbacks name this tab by: a file path, or the diff tab's own id —
   * a diff of an open file is a second tab for the same path. */
  id: string
  name: string
  dirty: boolean
  preview: boolean
  /** Worst diagnostic of the file, or null when it has none. */
  severity: TabSeverity | null
  /** The file's icon, or null when `tabIcons` is off or the theme draws nothing. */
  icon: { glyph: string; color?: string } | null
}

export interface TabsProps {
  tabs: TabInfo[]
  /** `id` of the tab on screen. */
  activeId: string | null
  /** Whether the visit history has anywhere to go, each way. */
  canBack: boolean
  canForward: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onBack: () => void
  onForward: () => void
  /** Clicking an overflow counter asks for the full list of open tabs. */
  onOverflow: () => void
  /**
   * The rendered-markdown switch for the active tab, or null when it is not a
   * markdown file. The command exists either way — this is the half of it people
   * find, since nothing else in the editor says the view is there.
   */
  markdown: { rendered: boolean } | null
  onToggleMarkdown: () => void
}

const MAX_LABEL = 18
/** Padding, the dirty/close glyph and the separator around a label. */
const CHROME = 5
/** The glyph slot before a label, and the space after it. */
const SLOT = 2
/** Columns the history arrows take off the row: two boxes and their padding. */
const NAV = 5
const PREVIEW_LABEL = '¶ preview'
const SOURCE_LABEL = '¶ source'
/** Widest of the two labels plus its padding — the button must not reflow the
 * strip as it is toggled, so both states cost the row the same columns. */
const PREVIEW_WIDTH = PREVIEW_LABEL.length + 2

const shorten = (name: string) =>
  name.length <= MAX_LABEL ? name : `${name.slice(0, MAX_LABEL - 1)}…`

/** The strip's background, tinted while the pointer is on one of its buttons. */
const barBg = (hovered: boolean) => (hovered ? ui.hoverBg : ui.barBg)

/**
 * One glyph before the label, or null for none: a diagnostic outranks the file
 * icon rather than sitting beside it. Both are one cell, so a file that starts
 * erroring while icons are on moves nothing — and where icons are off, which is
 * the default, the mark is the only thing the slot is ever spent on.
 */
const glyphOf = (tab: TabInfo): { glyph: string; color?: string } | null =>
  tab.severity
    ? { glyph: SEVERITY_GLYPH[tab.severity], color: SEVERITY_COLOR[tab.severity]() }
    : tab.icon

export function Tabs(props: TabsProps) {
  const dimensions = useTerminalDimensions()
  const back = useHover()
  const forward = useHover()
  const before = useHover()
  const after = useHover()
  const preview = useHover()

  /**
   * Only the tabs that fit are rendered, scrolled to keep the active one in
   * view. Letting flexbox shrink them instead clips names mid-character.
   */
  const visible = createMemo(() => {
    // The bar spans the terminal: the tree sits below it, not beside it. Taking
    // the sidebar's width off the budget made tabs reflow on every resize. The
    // arrows are drawn whether or not they are live, so their columns are gone
    // from the budget either way.
    const budget = dimensions().width - NAV - (props.markdown ? PREVIEW_WIDTH : 0)
    const width = (tab: TabInfo) =>
      shorten(tab.name).length + CHROME + (tab.severity || tab.icon ? SLOT : 0)

    const active = Math.max(
      0,
      props.tabs.findIndex(tab => tab.id === props.activeId),
    )
    let first = active
    let last = active
    let used = props.tabs[active] ? width(props.tabs[active]!) : 0

    // Grow outwards from the active tab until the row is full.
    while (first > 0 || last < props.tabs.length - 1) {
      const before = first > 0 ? width(props.tabs[first - 1]!) : Infinity
      const after = last < props.tabs.length - 1 ? width(props.tabs[last + 1]!) : Infinity
      const next = Math.min(before, after)
      if (used + next > budget) break
      if (after <= before) {
        last++
      } else {
        first--
      }
      used += next
    }
    return {
      tabs: props.tabs.slice(first, last + 1),
      before: first,
      after: props.tabs.length - 1 - last,
    }
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexDirection="row" backgroundColor={ui.barBg}>
        {/* The way back through the tabs the editor has landed on. Always drawn,
            dimmed to `faint` when that way is empty: an arrow that comes and goes
            shifts every tab beside it, and the row would jump on each jump. */}
        <box
          paddingLeft={1}
          backgroundColor={barBg(back.hovered())}
          onMouseDown={() => props.onBack()}
          onMouseOver={back.enter}
          onMouseOut={back.leave}
        >
          <text fg={props.canBack ? ui.dim : ui.faint} bg={barBg(back.hovered())} content="←" />
        </box>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={barBg(forward.hovered())}
          onMouseDown={() => props.onForward()}
          onMouseOver={forward.enter}
          onMouseOut={forward.leave}
        >
          <text
            fg={props.canForward ? ui.dim : ui.faint}
            bg={barBg(forward.hovered())}
            content="→"
          />
        </box>
        <Show
          when={props.tabs.length > 0}
          fallback={<text fg={ui.faint} bg={ui.barBg} content="  no open files" />}
        >
          <Show when={visible().before > 0}>
            <box
              paddingLeft={1}
              backgroundColor={barBg(before.hovered())}
              onMouseDown={() => props.onOverflow()}
              onMouseOver={before.enter}
              onMouseOut={before.leave}
            >
              <text fg={ui.dim} bg={barBg(before.hovered())} content={`‹${visible().before}`} />
            </box>
          </Show>
          <For each={visible().tabs}>
            {tab => {
              const active = () => tab.id === props.activeId
              const row = useHover()
              const close = useHover()
              const bg = () => (active() ? ui.bg : row.hovered() ? ui.hoverBg : ui.barBg)
              return (
                <box
                  flexDirection="row"
                  flexShrink={0}
                  backgroundColor={bg()}
                  paddingRight={1}
                  onMouseDown={() => props.onSelect(tab.id)}
                  onMouseOver={row.enter}
                  onMouseOut={row.leave}
                >
                  {/* The accent edge is what says "this one" at a glance — a bold
                      label and a background a shade apart do not survive a
                      low-contrast theme. It takes the column the padding had, so
                      the strip's geometry is unchanged. A space on the inactive
                      tabs, not the glyph hidden by painting it in the background:
                      with `transparent` on there is no background to hide it in. */}
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▎' : ' '} />
                  <Show when={glyphOf(tab)}>
                    {(mark: () => { glyph: string; color?: string }) => (
                      <text
                        fg={mark().color ?? (active() ? ui.dim : ui.faint)}
                        bg={bg()}
                        flexShrink={0}
                        content={`${mark().glyph} `}
                      />
                    )}
                  </Show>
                  <text
                    fg={
                      tab.severity
                        ? SEVERITY_COLOR[tab.severity]()
                        : active()
                          ? ui.activeTabFg
                          : ui.inactiveTabFg
                    }
                    bg={bg()}
                    content={shorten(tab.name)}
                    attributes={
                      tab.preview
                        ? TextAttributes.ITALIC
                        : active()
                          ? TextAttributes.BOLD
                          : undefined
                    }
                  />
                  <box
                    paddingLeft={1}
                    onMouseDown={(e: MouseEvent) => {
                      e.stopPropagation()
                      props.onClose(tab.id)
                    }}
                    onMouseOver={close.enter}
                    onMouseOut={close.leave}
                  >
                    {/* The × is painted in the tab's own background on an
                        untouched inactive tab — hovering the tab is what
                        reveals it, and hovering the × itself sharpens it. */}
                    <text
                      fg={
                        tab.dirty
                          ? ui.dirty
                          : close.hovered()
                            ? ui.text
                            : active() || row.hovered()
                              ? ui.dim
                              : bg()
                      }
                      bg={bg()}
                      content={tab.dirty ? '●' : '×'}
                    />
                  </box>
                </box>
              )
            }}
          </For>
          <Show when={visible().after > 0}>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={barBg(after.hovered())}
              onMouseDown={() => props.onOverflow()}
              onMouseOver={after.enter}
              onMouseOut={after.leave}
            >
              <text fg={ui.dim} bg={barBg(after.hovered())} content={`${visible().after}›`} />
            </box>
          </Show>
        </Show>
        <box flexGrow={1} backgroundColor={ui.barBg} />
        <Show when={props.markdown}>
          {(markdown: () => { rendered: boolean }) => (
            <box
              width={PREVIEW_WIDTH}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={barBg(preview.hovered())}
              onMouseDown={() => props.onToggleMarkdown()}
              onMouseOver={preview.enter}
              onMouseOut={preview.leave}
            >
              <text
                fg={markdown().rendered ? ui.accent : ui.dim}
                bg={barBg(preview.hovered())}
                content={markdown().rendered ? SOURCE_LABEL : PREVIEW_LABEL}
              />
            </box>
          )}
        </Show>
      </box>
    </box>
  )
}
