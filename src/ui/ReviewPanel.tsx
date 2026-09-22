import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, on, Show } from 'solid-js'

import type { ReviewNote } from '../core/review'
import { plural } from '../core/text'
import { ui } from '../themes'
import { useHover, useHoverKey } from './hover'
import { createScrollList, rowBg } from './list'
import { Panel, PanelHeader } from './PanelHeader'
import { PanelList } from './PanelList'
import { cut } from './text'

export type ReviewRow =
  | { kind: 'file'; id: string; rel: string; count: number; collapsed: boolean }
  | { kind: 'note'; id: string; note: ReviewNote; label: string; text: string }
  | { kind: 'reply'; id: string; note: ReviewNote; label: string; text: string }
  | { kind: 'hint'; id: string; label: string }

// `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row.
const fileRow = (row: ReviewRow) => (row.kind === 'file' ? row : undefined)
const hintRow = (row: ReviewRow) => (row.kind === 'hint' ? row : undefined)
type Remark = Extract<ReviewRow, { kind: 'note' | 'reply' }>
const remarkRow = (row: ReviewRow): Remark | undefined =>
  row.kind === 'note' || row.kind === 'reply' ? row : undefined

interface ReviewPanelProps {
  rows: ReviewRow[]
  cursor: number
  count: number
  focused: boolean
  width: number
  onFocus: () => void
  onActivate: (index: number) => void
  onCollapseAll: () => void
}

export function ReviewPanel(props: ReviewPanelProps) {
  // A memo so the reveal below fires on the cursor's *value* — see GitPanel.
  const cursor = createMemo(() =>
    Math.max(0, Math.min(props.cursor, props.rows.length - 1))
  )

  const list = createScrollList(() => props.rows.length, 'review')
  const collapse = useHover()
  const rowHover = useHoverKey<number>()

  createEffect(on(cursor, (row) => list.reveal(row)))

  const labelOf = (row: ReviewRow) => remarkRow(row)?.label ?? ''

  const indentOf = (row: ReviewRow) => (row.kind === 'reply' ? 5 : 3)

  return (
    <Panel width={props.width} onFocus={props.onFocus}>
      <PanelHeader title="Review" width={props.width} focused={props.focused}>
        <Show
          when={props.rows.some((row) => row.kind === 'file' && !row.collapsed)}
        >
          <text
            fg={collapse.hovered() ? ui.text : ui.dim}
            bg={collapse.hovered() ? ui.hoverBg : ui.sidebarBg}
            flexShrink={0}
            wrapMode="none"
            content="▴ "
            onMouseDown={() => props.onCollapseAll()}
            onMouseOver={collapse.enter}
            onMouseOut={collapse.leave}
          />
        </Show>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={0}
          wrapMode="none"
          content={cut(
            plural(props.count, 'item'),
            Math.max(4, props.width - 12)
          )}
        />
      </PanelHeader>

      <PanelList list={list} items={props.rows}>
        {(row, index) => {
          const bg = () =>
            rowBg(
              index() === cursor(),
              props.focused,
              rowHover.hovered(index())
            )
          // Cut as well as unwrapped: a reply's `@name` is the notes file's, and this cannot shrink.
          const label = () =>
            cut(labelOf(row), Math.max(0, props.width - indentOf(row) - 2))
          // What the label leaves: the indent, 1 for the gap, 1 for the trailing pad.
          const room = () => props.width - label().length - indentOf(row) - 2
          return (
            <box
              height={1}
              flexDirection="row"
              backgroundColor={bg()}
              onMouseDown={() => props.onActivate(index())}
              onMouseOver={() => rowHover.enter(index())}
              onMouseOut={() => rowHover.leave(index())}
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
                      content={
                        room() > 3 ? ` ${cut(remark().text, room())}` : ''
                      }
                    />
                  </>
                )}
              </Show>
            </box>
          )
        }}
      </PanelList>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          wrapMode="none"
          content={cut(
            '↑↓ · Enter · r reply · ⌫ · Esc',
            Math.max(0, props.width - 2)
          )}
        />
      </box>
    </Panel>
  )
}
