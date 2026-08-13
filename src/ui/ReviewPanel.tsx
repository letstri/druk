import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { ReviewNote } from '../core/review'
import { ui } from '../themes'
import { useHover } from './hover'
import { createScrollList, rowBg, scrollbarOptions } from './list'
import { cut } from './text'

export type ReviewRow =
  /** A file heading: the threads written against one file. */
  | { kind: 'file'; id: string; rel: string; count: number; collapsed: boolean }
  | { kind: 'note'; id: string; note: ReviewNote; label: string; text: string }
  /** An answer to the note above it — a note of its own, drawn a column deeper. */
  | { kind: 'reply'; id: string; note: ReviewNote; label: string; text: string }
  /** An inert line — what the panel is for, said while the list is empty. */
  | { kind: 'hint'; id: string; label: string }

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const fileRow = (row: ReviewRow) => (row.kind === 'file' ? row : undefined)
const hintRow = (row: ReviewRow) => (row.kind === 'hint' ? row : undefined)
type Remark = Extract<ReviewRow, { kind: 'note' | 'reply' }>
const remarkRow = (row: ReviewRow): Remark | undefined =>
  row.kind === 'note' || row.kind === 'reply' ? row : undefined

export interface ReviewPanelProps {
  rows: ReviewRow[]
  cursor: number
  /** How many items the review holds, whatever a fold leaves on screen. */
  count: number
  focused: boolean
  width: number
  onFocus: () => void
  /** A row clicked: move the cursor there, and jump to it or fold it. */
  onActivate: (index: number) => void
  onCollapseAll: () => void
}

/**
 * The sidebar's review view: the notes dropped on lines while reading and the
 * answers to them, under the file each belongs to.
 *
 * Two columns per row and no more — the label (`ISSUE 42`, `↳ @claude`) and the
 * remark itself, cut to what the sidebar has. A note is a sentence and a
 * sidebar is thirty columns, so the row says which and where; the whole text is
 * on the line itself, where Enter lands.
 */
export function ReviewPanel(props: ReviewPanelProps) {
  /** A memo so the reveal below fires on the cursor's *value* — see GitPanel. */
  const cursor = createMemo(() => Math.max(0, Math.min(props.cursor, props.rows.length - 1)))

  const list = createScrollList(() => props.rows.length)
  const collapse = useHover()
  const visible = createMemo(() => props.rows.slice(list.window().start, list.window().end))

  createEffect(on(cursor, row => list.reveal(row)))

  /** The label column, which the text is cut against. */
  const labelOf = (row: ReviewRow) => remarkRow(row)?.label ?? ''

  /** A reply is drawn a column deeper than the remark it answers. */
  const indentOf = (row: ReviewRow) => (row.kind === 'reply' ? 5 : 3)

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.sidebarBg}
      flexShrink={0}
      flexGrow={1}
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      {/* One row, as the tree's header and the git panel's are, and cut like
          them: a wrapped header eats the list below it. */}
      <box
        height={1}
        flexDirection="row"
        backgroundColor={ui.sidebarBg}
        paddingLeft={2}
        paddingRight={1}
      >
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={1}
          wrapMode="none"
          content={cut(
            `${props.count} item${props.count === 1 ? '' : 's'}`,
            Math.max(4, props.width - 12),
          )}
          attributes={TextAttributes.BOLD}
        />
        <box flexGrow={1} backgroundColor={ui.sidebarBg} />
        <Show when={props.rows.some(row => row.kind === 'file' && !row.collapsed)}>
          <text
            fg={collapse.hovered() ? ui.text : ui.dim}
            bg={collapse.hovered() ? ui.hoverBg : ui.sidebarBg}
            flexShrink={0}
            wrapMode="none"
            content="▴"
            onMouseDown={() => props.onCollapseAll()}
            onMouseOver={collapse.enter}
            onMouseOut={collapse.leave}
          />
        </Show>
        <text fg={ui.faint} bg={ui.sidebarBg} flexShrink={0} wrapMode="none" content=" review" />
      </box>

      <scrollbox
        ref={list.ref}
        flexGrow={1}
        backgroundColor={ui.sidebarBg}
        scrollbarOptions={scrollbarOptions()}
      >
        {/* Spacers keep the scrollable extent honest while only a window exists. */}
        <box height={list.window().start} flexShrink={0} backgroundColor={ui.sidebarBg} />
        <For each={visible()}>
          {(row, at) => {
            const index = () => list.window().start + at()
            const hover = useHover()
            const bg = () => rowBg(index() === cursor(), props.focused, hover.hovered())
            // Cut as well as unwrapped: a reply's `@name` is whatever an agent
            // wrote into the notes file, and this column cannot shrink.
            const label = () => cut(labelOf(row), Math.max(0, props.width - indentOf(row) - 2))
            // The remark takes what the label leaves: the indent, 1 for the gap,
            // 1 for the trailing pad.
            const room = () => props.width - label().length - indentOf(row) - 2
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => props.onActivate(index())}
                onMouseOver={hover.enter}
                onMouseOut={hover.leave}
              >
                <Show when={fileRow(row)}>
                  {(file: () => ReviewRow & { kind: 'file' }) => (
                    <>
                      <text
                        fg={ui.dim}
                        bg={bg()}
                        flexShrink={0}
                        wrapMode="none"
                        content={` ${file().collapsed ? '▸' : '▾'} `}
                      />
                      <box flexGrow={1} backgroundColor={bg()}>
                        <text
                          fg={ui.folder}
                          bg={bg()}
                          wrapMode="none"
                          content={cut(file().rel, Math.max(3, props.width - 8))}
                          attributes={TextAttributes.BOLD}
                        />
                      </box>
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        flexShrink={0}
                        wrapMode="none"
                        content={`${file().count} `}
                      />
                    </>
                  )}
                </Show>
                <Show when={hintRow(row)}>
                  {(hint: () => ReviewRow & { kind: 'hint' }) => (
                    <text
                      fg={ui.faint}
                      bg={bg()}
                      wrapMode="none"
                      content={` ${cut(hint().label, props.width - 2)}`}
                    />
                  )}
                </Show>
                <Show when={remarkRow(row)}>
                  {(remark: () => Remark) => (
                    <>
                      {/* The remark in the accent and its answers dim: it is
                          the note that says what the thread is about. */}
                      <text
                        fg={remark().kind === 'note' ? ui.accent : ui.dim}
                        bg={bg()}
                        flexShrink={0}
                        wrapMode="none"
                        content={`${' '.repeat(indentOf(row))}${label()}`}
                      />
                      <text
                        fg={ui.text}
                        bg={bg()}
                        flexShrink={1}
                        wrapMode="none"
                        content={room() > 3 ? ` ${cut(remark().text, room())}` : ''}
                      />
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
          backgroundColor={ui.sidebarBg}
        />
      </scrollbox>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          wrapMode="none"
          content={cut('↑↓ · Enter · r reply · ⌫ · Esc', Math.max(0, props.width - 2))}
        />
      </box>
    </box>
  )
}
