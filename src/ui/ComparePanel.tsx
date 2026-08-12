import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { BranchComparison, ComparisonCommit, ComparisonFile } from '../core/git'
import { ui } from '../themes'
import { diffMark, diffStatusColor } from './DiffView'
import { useHover } from './hover'
import { createScrollList, rowBg, scrollbarOptions } from './list'
import { cut } from './text'

export interface ComparePanelProps {
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  comparison: BranchComparison | null
  files: ComparisonFile[]
  commits: ComparisonCommit[]
  mode: 'files' | 'commits'
  cursor: number
  focused: boolean
  width: number
  error: string
  onFocus: () => void
  onActivate: (index: number) => void
}

/** Branch-comparison mode inside the existing source-control sidebar. */
export function ComparePanel(props: ComparePanelProps) {
  const rows = () => (props.mode === 'files' ? props.files : props.commits)
  /** A memo so the reveal below fires on the cursor's *value* — see GitPanel. */
  const cursor = createMemo(() => Math.max(0, Math.min(props.cursor, rows().length - 1)))

  const list = createScrollList(() => rows().length)
  createEffect(on(cursor, row => list.reveal(row)))

  // One window over whichever list is showing: slicing both meant the hidden one
  // was re-sliced on every cursor move for nothing.
  const visibleFiles = createMemo(() =>
    props.mode === 'files' ? props.files.slice(list.window().start, list.window().end) : [],
  )
  const visibleCommits = createMemo(() =>
    props.mode === 'commits' ? props.commits.slice(list.window().start, list.window().end) : [],
  )
  /** Columns the header rows have, after the panel's own left padding. */
  const room = () => Math.max(8, props.width - 2)

  const summary = () => {
    const comparison = props.comparison
    if (!comparison) return ''
    const behind = comparison.behind > 0 ? ` ↓${comparison.behind}` : ''
    const { files, additions, deletions } = comparison.stats
    return `↑${comparison.ahead}${behind} · ${files} files · +${additions} −${deletions}`
  }

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
      {/* Five rows and five texts: a branch name allowed to wrap takes the rows
          under it with it, and the header is a fixed height, so what it pushes
          past the fifth row is simply gone. */}
      <box height={5} flexDirection="column" backgroundColor={ui.sidebarBg} paddingLeft={2}>
        <text
          wrapMode="none"
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          content={cut(props.comparison?.compare.name ?? 'branch comparison', room())}
          attributes={TextAttributes.BOLD}
        />
        <text fg={ui.faint} bg={ui.sidebarBg} content="compare" />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={ui.sidebarBg}
          content={`base  ${cut(props.comparison?.base.name ?? 'loading…', room() - 6)}`}
        />
        <text fg={ui.dim} bg={ui.sidebarBg} content={summary()} />
        <text
          fg={ui.accent}
          bg={ui.sidebarBg}
          content={props.mode === 'files' ? '[Files]  Commits' : 'Files  [Commits]'}
        />
      </box>
      <Show
        when={rows().length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.sidebarBg} paddingLeft={2}>
            <text
              fg={ui.faint}
              bg={ui.sidebarBg}
              content={
                props.state === 'error'
                  ? props.error
                  : props.state === 'loading'
                    ? 'loading comparison…'
                    : 'no differences'
              }
            />
          </box>
        }
      >
        <scrollbox
          ref={list.ref}
          flexGrow={1}
          backgroundColor={ui.sidebarBg}
          scrollbarOptions={scrollbarOptions()}
        >
          {/* Spacers keep the scrollable extent honest while only a window exists. */}
          <box height={list.window().start} flexShrink={0} backgroundColor={ui.sidebarBg} />
          <Show
            when={props.mode === 'files'}
            fallback={
              <For each={visibleCommits()}>
                {(commit, row) => {
                  const index = () => list.window().start + row()
                  const hover = useHover()
                  const bg = () => rowBg(index() === cursor(), props.focused, hover.hovered())
                  return (
                    <box
                      height={1}
                      flexDirection="row"
                      backgroundColor={bg()}
                      onMouseDown={() => props.onActivate(index())}
                      onMouseOver={hover.enter}
                      onMouseOut={hover.leave}
                    >
                      <text
                        wrapMode="none"
                        fg={ui.text}
                        bg={bg()}
                        content={` ${commit.subject}`}
                        flexGrow={1}
                      />
                      {/* The gap is this column's, not slack in the subject's box:
                          a subject long enough to fill the row leaves none. */}
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        content={` ${commit.shortOid} `}
                        flexShrink={0}
                      />
                    </box>
                  )
                }}
              </For>
            }
          >
            <For each={visibleFiles()}>
              {(file, row) => {
                const index = () => list.window().start + row()
                const hover = useHover()
                const bg = () => rowBg(index() === cursor(), props.focused, hover.hovered())
                const totals = () =>
                  file.binary ? 'binary' : `+${file.additions} −${file.deletions}`
                return (
                  <box
                    height={1}
                    flexDirection="row"
                    backgroundColor={bg()}
                    onMouseDown={() => props.onActivate(index())}
                    onMouseOver={hover.enter}
                    onMouseOut={hover.leave}
                  >
                    <text
                      wrapMode="none"
                      fg={ui.text}
                      bg={bg()}
                      content={` ${file.path}`}
                      flexGrow={1}
                    />
                    <text fg={ui.faint} bg={bg()} content={` ${totals()} `} flexShrink={0} />
                    <text
                      fg={diffStatusColor(file.status)}
                      bg={bg()}
                      content={`${diffMark(file.status)} `}
                      flexShrink={0}
                    />
                  </box>
                )
              }}
            </For>
          </Show>
          <box
            height={Math.max(0, rows().length - list.window().end)}
            flexShrink={0}
            backgroundColor={ui.sidebarBg}
          />
        </scrollbox>
      </Show>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          content="↑↓ open · c commits · / filter · B base · Esc"
        />
      </box>
    </box>
  )
}
