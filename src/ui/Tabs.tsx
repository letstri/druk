import { TextAttributes } from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import { createMemo, For, Show } from 'solid-js'

import { ui } from '../themes'
import { useHover } from './hover'
import { SEVERITY_COLOR, SEVERITY_GLYPH } from './severity'
import { useTooltip } from './tooltip'

type TabSeverity = 'error' | 'warning'

export interface TabInfo {
  id: string
  name: string
  dirty: boolean
  preview: boolean
  severity: TabSeverity | null
  icon: { glyph: string; color?: string } | null
}

interface TabsProps {
  tabs: TabInfo[]
  width: number
  activeId: string | null
  canBack: boolean
  canForward: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onBack: () => void
  onForward: () => void
  onOverflow: () => void
  markdown: { rendered: boolean } | null
  onToggleMarkdown: () => void
}

const MAX_LABEL = 18
const CHROME = 5
const SLOT = 2
const NAV = 5
const PREVIEW_LABEL = '¶ preview'
const SOURCE_LABEL = '¶ source'
// Widest of the two labels, so toggling the button does not reflow the strip.
const PREVIEW_WIDTH = PREVIEW_LABEL.length + 2

const shorten = (name: string) =>
  name.length <= MAX_LABEL ? name : `${name.slice(0, MAX_LABEL - 1)}…`

const barBg = (hovered: boolean) => (hovered ? ui.hoverBg : ui.barBg)

// One cell either way: a diagnostic replaces the icon, so a tab that starts erroring shifts nothing.
const glyphOf = (tab: TabInfo): { glyph: string; color?: string } | null =>
  tab.severity
    ? {
        color: SEVERITY_COLOR[tab.severity](),
        glyph: SEVERITY_GLYPH[tab.severity],
      }
    : tab.icon

export function Tabs(props: TabsProps) {
  const back = useTooltip('nav.back')
  const forward = useTooltip('nav.forward')
  const before = useTooltip('tabs.switch')
  const after = useTooltip('tabs.switch')
  const preview = useTooltip('view.markdown')

  // Only the tabs that fit are built: letting flexbox shrink them clips names mid-character.
  const visible = createMemo(() => {
    // Budget is the editor column's width; the arrows' columns are gone whether or not they are live.
    const budget = props.width - NAV - (props.markdown ? PREVIEW_WIDTH : 0)
    const width = (tab: TabInfo) =>
      shorten(tab.name).length + CHROME + (tab.severity || tab.icon ? SLOT : 0)

    const active = Math.max(
      0,
      props.tabs.findIndex((tab) => tab.id === props.activeId)
    )
    let first = active
    let last = active
    let used = props.tabs[active] ? width(props.tabs[active]!) : 0

    while (first > 0 || last < props.tabs.length - 1) {
      const prevWidth = first > 0 ? width(props.tabs[first - 1]!) : Infinity
      const nextWidth =
        last < props.tabs.length - 1 ? width(props.tabs[last + 1]!) : Infinity
      const next = Math.min(prevWidth, nextWidth)
      if (used + next > budget) {
        break
      }
      if (nextWidth <= prevWidth) {
        last += 1
      } else {
        first -= 1
      }
      used += next
    }
    return {
      after: props.tabs.length - 1 - last,
      before: first,
      tabs: props.tabs.slice(first, last + 1),
    }
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexDirection="row" backgroundColor={ui.barBg}>
        {/* Always drawn, dimmed when there is nowhere to go: an arrow that comes and goes shifts tabs. */}
        <box
          ref={back.ref}
          paddingLeft={1}
          backgroundColor={barBg(back.lit())}
          onMouseDown={() => props.onBack()}
          onMouseOver={back.enter}
          onMouseOut={back.leave}
        >
          <text
            fg={props.canBack ? ui.dim : ui.faint}
            bg={barBg(back.lit())}
            content="←"
          />
        </box>
        <box
          ref={forward.ref}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={barBg(forward.lit())}
          onMouseDown={() => props.onForward()}
          onMouseOver={forward.enter}
          onMouseOut={forward.leave}
        >
          <text
            fg={props.canForward ? ui.dim : ui.faint}
            bg={barBg(forward.lit())}
            content="→"
          />
        </box>
        <Show
          when={props.tabs.length > 0}
          fallback={
            <text fg={ui.faint} bg={ui.barBg} content="  no open files" />
          }
        >
          <Show when={visible().before > 0}>
            <box
              ref={before.ref}
              paddingLeft={1}
              backgroundColor={barBg(before.lit())}
              onMouseDown={() => props.onOverflow()}
              onMouseOver={before.enter}
              onMouseOut={before.leave}
            >
              <text
                fg={ui.dim}
                bg={barBg(before.lit())}
                content={`‹${visible().before}`}
              />
            </box>
          </Show>
          <For each={visible().tabs}>
            {(tab) => {
              const active = () => tab.id === props.activeId
              const row = useHover()
              const close = useHover()
              const bg = () =>
                active() ? ui.bg : row.hovered() ? ui.hoverBg : ui.barBg
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
                  {/* A space, not a glyph hidden in the background: `transparent` leaves none. */}
                  <text
                    fg={ui.accent}
                    bg={bg()}
                    flexShrink={0}
                    content={active() ? '▎' : ' '}
                  />
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
                    attributes={tab.preview ? TextAttributes.ITALIC : undefined}
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
              ref={after.ref}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={barBg(after.lit())}
              onMouseDown={() => props.onOverflow()}
              onMouseOver={after.enter}
              onMouseOut={after.leave}
            >
              <text
                fg={ui.dim}
                bg={barBg(after.lit())}
                content={`${visible().after}›`}
              />
            </box>
          </Show>
        </Show>
        <box flexGrow={1} backgroundColor={ui.barBg} />
        <Show when={props.markdown}>
          {(markdown: () => { rendered: boolean }) => (
            <box
              ref={preview.ref}
              width={PREVIEW_WIDTH}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={barBg(preview.lit())}
              onMouseDown={() => props.onToggleMarkdown()}
              onMouseOver={preview.enter}
              onMouseOut={preview.leave}
            >
              <text
                fg={markdown().rendered ? ui.accent : ui.dim}
                bg={barBg(preview.lit())}
                content={markdown().rendered ? SOURCE_LABEL : PREVIEW_LABEL}
              />
            </box>
          )}
        </Show>
      </box>
    </box>
  )
}
