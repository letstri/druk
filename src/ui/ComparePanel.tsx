import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, on, Show } from 'solid-js'

import type {
  BranchComparison,
  ComparisonCommit,
  ComparisonFile,
} from '../core/git'
import { ui } from '../themes'
import { diffMark, diffStatusColor } from './DiffView'
import { useHover } from './hover'
import { createScrollList, rowBg } from './list'
import { Panel } from './PanelHeader'
import { PanelList } from './PanelList'
import { cut } from './text'

interface ComparePanelProps {
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

export function ComparePanel(props: ComparePanelProps) {
  type Row = ComparisonFile | ComparisonCommit
  const rows = (): Row[] =>
    props.mode === 'files' ? props.files : props.commits
  // The two modes never mix, so the mode alone says which shape a row is.
  const isFile = (_row: Row): _row is ComparisonFile => props.mode === 'files'
  // A memo so the reveal below fires on the cursor's *value* — see GitPanel.
  const cursor = createMemo(() =>
    Math.max(0, Math.min(props.cursor, rows().length - 1))
  )

  const list = createScrollList(() => rows().length)
  createEffect(on(cursor, (row) => list.reveal(row)))

  const room = () => Math.max(8, props.width - 2)

  const summary = () => {
    const { comparison } = props
    if (!comparison) {
      return ''
    }
    const behind = comparison.behind > 0 ? ` ↓${comparison.behind}` : ''
    const { files, additions, deletions } = comparison.stats
    return `↑${comparison.ahead}${behind} · ${files} files · +${additions} −${deletions}`
  }

  return (
    <Panel width={props.width} onFocus={props.onFocus}>
      {/* Fixed five rows: a wrapped branch name pushes the rows under it out of the box. */}
      <box
        height={5}
        flexDirection="column"
        backgroundColor={ui.sidebarBg}
        paddingLeft={2}
      >
        <text
          wrapMode="none"
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          content={cut(
            props.comparison?.compare.name ?? 'branch comparison',
            room()
          )}
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
          content={
            props.mode === 'files' ? '[Files]  Commits' : 'Files  [Commits]'
          }
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
        <PanelList list={list} items={rows()}>
          {(row, index) => {
            const hover = useHover()
            const bg = () =>
              rowBg(index() === cursor(), props.focused, hover.hovered())
            const file = () => (isFile(row) ? row : null)
            const note = () => {
              const at = file()
              if (!at) {
                return ''
              }
              return at.binary ? 'binary' : `+${at.additions} −${at.deletions}`
            }
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
                  content={` ${isFile(row) ? row.path : row.subject}`}
                  flexGrow={1}
                />
                <text
                  fg={ui.faint}
                  bg={bg()}
                  content={` ${isFile(row) ? note() : row.shortOid} `}
                  flexShrink={0}
                />
                <Show when={file()}>
                  {(at: () => ComparisonFile) => (
                    <text
                      fg={diffStatusColor(at().status)}
                      bg={bg()}
                      content={`${diffMark(at().status)} `}
                      flexShrink={0}
                    />
                  )}
                </Show>
              </box>
            )
          }}
        </PanelList>
      </Show>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          content="↑↓ open · c commits · / filter · B base · Esc"
        />
      </box>
    </Panel>
  )
}
