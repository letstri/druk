import { TextAttributes } from '@opentui/core'
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, For, on, onCleanup, onMount, Show } from 'solid-js'

import type { GraphCommit, GraphRow } from '../core/git'
import { ui } from '../themes'
import { laneSpans, refChips } from './graphLanes'
import type { RefKind } from './graphLanes'
import { useHoverKey } from './hover'
import { createScrollList, followScroll, restoreScroll } from './list'
import { cut } from './text'
import { useKeys } from './useKeys'

export interface CommitGraphViewProps {
  rows: GraphRow[]
  cursor: number
  loading: boolean
  scrollTop: number
  width: number
  focused: boolean
  blocked: boolean
  escLabel?: string
  onFocus: () => void
  onScroll: (top: number) => void
  onMove: (delta: number) => void
  onMoveTo: (row: number) => void
  onOpen: () => void
  onOpenWeb: () => void
  onClose: () => void
}

// Enough columns for the author and the date before they are worth drawing at all.
const WIDE = 64

const AUTHOR = 14

// Columns kept for the subject before a ref chip may have them.
const MIN_SUBJECT = 16

// Functions, not constants: the palette is a store, so a list built at import time freezes.
const LANES = () => [ui.accent, ui.gitAdded, ui.dirty, ui.gitDeleted, ui.dim]

const REF_COLORS: Record<RefKind, () => string> = {
  head: () => ui.gitAdded,
  local: () => ui.gitAdded,
  remote: () => ui.accent,
  tag: () => ui.dirty,
}

export function CommitGraphView(props: CommitGraphViewProps) {
  const dimensions = useTerminalDimensions()
  const list = createScrollList(() => props.rows.length)
  const visible = createMemo(() => props.rows.slice(list.window().start, list.window().end))
  const hover = useHoverKey<number>()

  let box: ScrollBoxRenderable | undefined

  // The page unmounts whenever a commit opens over it: it comes back where the reader left it.
  onMount(() => {
    if (!box) return
    const cancel = restoreScroll(box, props.scrollTop)
    onCleanup(cancel)
  })

  createEffect(
    on(
      () => props.cursor,
      row => list.reveal(row),
      { defer: true },
    ),
  )

  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    if (props.blocked || !props.focused || key.defaultPrevented) return
    if (k === 'up' || k === 'k') props.onMove(-1)
    else if (k === 'down' || k === 'j') props.onMove(1)
    else if (k === 'pageup' || (key.ctrl && k === 'u')) props.onMove(-page())
    else if (k === 'pagedown' || (key.ctrl && k === 'd')) props.onMove(page())
    else if (k === 'return' || k === 'enter') props.onOpen()
    else if (k === 'o') props.onOpenWeb()
    else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  const hints = () => {
    const esc = `Esc ${props.escLabel ?? 'close'}`
    const full = ` ↑↓ commit · Enter details · o remote · ${esc} `
    if (full.length + 20 <= props.width) return full
    const short = ` Enter details · o remote · ${esc} `
    return short.length + 20 <= props.width ? short : ` Enter details · ${esc} `
  }

  const header = () => {
    const commits = props.rows.filter(row => row.commit).length
    const summary = props.loading ? 'Loading the graph…' : `Commit graph · ${commits} commits`
    return ` ${cut(summary, Math.max(8, props.width - hints().length - 1))}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" flexShrink={0} backgroundColor={ui.solidBarBg}>
        <text wrapMode="none" fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content={header()} />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text wrapMode="none" fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>
      <Show
        when={props.rows.length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={2} paddingTop={1}>
            <text
              fg={ui.dim}
              content={props.loading ? 'Reading the history…' : 'No commits in this repository.'}
            />
          </box>
        }
      >
        <scrollbox
          ref={(el: ScrollBoxRenderable) => {
            box = el
            list.ref(el)
            followScroll(el, props.onScroll)
          }}
          flexGrow={1}
          backgroundColor={ui.solidBg}
          scrollbarOptions={{
            trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
          }}
        >
          {/* Spacers keep the scrollable extent honest while only a window exists. */}
          <box height={list.window().start} flexShrink={0} backgroundColor={ui.solidBg} />
          <For each={visible()}>
            {(row, at) => {
              const index = () => list.window().start + at()
              const selected = () => index() === props.cursor
              const bg = () =>
                selected()
                  ? props.focused
                    ? ui.treeSelectedBg
                    : ui.treeFocusBg
                  : hover.hovered(index())
                    ? ui.hoverBg
                    : ui.solidBg
              const wide = () => props.width >= WIDE
              // The graph column is git's own art: it may not shrink, or the lanes bend.
              const room = () =>
                Math.max(8, props.width - row.graph.length - 10 - (wide() ? AUTHOR + 13 : 1))
              const lanes = () => laneSpans(row.graph, LANES())
              // Chips are whole or absent: half a branch name is worse than none.
              const chips = () => {
                const all = refChips(row.commit?.refs ?? [])
                let left = Math.max(0, room() - MIN_SUBJECT)
                return all.filter(chip => {
                  const width = chip.label.length + 1
                  if (width > left) return false
                  left -= width
                  return true
                })
              }
              const chipsWidth = () =>
                chips().reduce((total, chip) => total + chip.label.length + 1, 0)
              return (
                <box
                  height={1}
                  flexDirection="row"
                  backgroundColor={bg()}
                  onMouseDown={() => {
                    props.onFocus()
                    props.onMoveTo(index())
                  }}
                  onMouseOver={() => hover.enter(index())}
                  onMouseOut={() => hover.leave(index())}
                >
                  <text wrapMode="none" fg={ui.dim} bg={bg()} flexShrink={0} content=" " />
                  <For each={lanes()}>
                    {span => (
                      <text
                        wrapMode="none"
                        fg={span.color}
                        bg={bg()}
                        flexShrink={0}
                        content={span.text}
                      />
                    )}
                  </For>
                  <Show when={row.commit}>
                    {(commit: () => GraphCommit) => (
                      <>
                        <text
                          wrapMode="none"
                          fg={ui.faint}
                          bg={bg()}
                          flexShrink={0}
                          content={`${commit().shortOid} `}
                        />
                        <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                          <For each={chips()}>
                            {chip => (
                              <text
                                wrapMode="none"
                                fg={REF_COLORS[chip.kind]()}
                                bg={bg()}
                                flexShrink={0}
                                attributes={chip.kind === 'head' ? TextAttributes.BOLD : undefined}
                                content={`${chip.label} `}
                              />
                            )}
                          </For>
                          <text
                            wrapMode="none"
                            fg={ui.text}
                            bg={bg()}
                            content={cut(commit().subject, Math.max(1, room() - chipsWidth()))}
                          />
                        </box>
                        <Show when={wide()}>
                          <text
                            wrapMode="none"
                            fg={ui.dim}
                            bg={bg()}
                            flexShrink={0}
                            content={` ${cut(commit().author, AUTHOR)} ${commit().date} `}
                          />
                        </Show>
                      </>
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
          <box
            height={Math.max(0, props.rows.length - list.window().end)}
            flexShrink={0}
            backgroundColor={ui.solidBg}
          />
        </scrollbox>
      </Show>
    </box>
  )
}
