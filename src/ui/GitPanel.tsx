import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, on, Show } from 'solid-js'

import type {
  ChangeRow,
  CommitSectionRow,
  DirRow,
  FileRow,
  SectionRow,
} from '../core/changeTree'
import { rowArea } from '../core/changeTree'
import { iconFor } from '../icons'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { useHover, useHoverKey } from './hover'
import { createScrollList, rowBg } from './list'
import { CollapseAll, Panel, PanelHeader } from './PanelHeader'
import { PanelList } from './PanelList'
import { cut } from './text'
import { TextInput } from './TextInput'

// `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row.
const dirRow = (row: ChangeRow) => (row.kind === 'dir' ? row : undefined)
const fileRow = (row: ChangeRow) => (row.kind === 'file' ? row : undefined)
const sectionRow = (row: ChangeRow) =>
  row.kind === 'section' ? row : undefined
const commitSectionRow = (row: ChangeRow) =>
  row.kind === 'commitSection' ? row : undefined

const isCommitRow = (row: ChangeRow) =>
  row.kind === 'commit' || row.kind === 'commitSection'

// Icon themes key whole-name rules (`package.json`) on a basename, not a joined path.
const iconName = (row: ChangeRow): string =>
  (row.kind === 'file' ? row.change.rel : row.label).split('/').pop() ??
  row.label

const stageGlyph = (row: ChangeRow) => (rowArea(row) === 'staged' ? '−' : '+')

interface GitPanelProps {
  repo: string | null
  branch: string | null
  ahead: number
  behind: number
  rows: ChangeRow[]
  base: string | null
  staging: boolean
  busy: boolean
  // May point past the end after a commit shrinks the list.
  cursor: number
  focused: boolean
  width: number
  inRepo: boolean
  iconTheme: string
  commitMessage: string
  messageEditing: boolean
  hasMessageHistory: boolean
  hasUpstream: boolean
  onFocus: () => void
  onActivate: (index: number) => void
  onCollapseAll: () => void
  onToggleStage: (index: number) => void
  onMessageFocus: () => void
  onMessageInput: (value: string) => void
  onCommit: () => void
  onSync: () => void
}

export function GitPanel(props: GitPanelProps) {
  // A memo, not a function: `rows` is a fresh array per refresh and would yank a scrolled list.
  const cursor = createMemo(() =>
    Math.max(0, Math.min(props.cursor, props.rows.length - 1))
  )

  const list = createScrollList(() => props.rows.length)
  const message = useHover()
  const commit = useHover()
  const sync = useHover()
  const commitLit = () => commit.hovered() && !props.busy
  const syncLit = () => sync.hovered() && !props.busy
  const rowHover = useHoverKey<number>()
  const stageHover = useHoverKey<number>()

  createEffect(on(cursor, (row) => list.reveal(row)))

  const headline = () => {
    if (!props.inRepo) {
      return 'not a git repository'
    }
    const arrows =
      (props.ahead > 0 ? ` ↑${props.ahead}` : '') +
      (props.behind > 0 ? ` ↓${props.behind}` : '')
    if (props.repo) {
      return `${props.repo}/${props.branch ?? 'no branch'}${arrows}`
    }
    return props.branch ? `${props.branch}${arrows}` : 'no branch'
  }

  return (
    <Panel width={props.width} onFocus={props.onFocus}>
      {/* A comparison base outranks the branch: every file it touches is marked. */}
      <PanelHeader
        title="Source control"
        width={props.width}
        focused={props.focused}
      >
        <CollapseAll
          when={props.rows.some((row) => row.kind === 'dir' && !row.collapsed)}
          onPress={props.onCollapseAll}
          gap
        />
        <text
          fg={props.base ? ui.accent : props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={0}
          wrapMode="none"
          content={cut(
            props.base ? `vs ${props.base}` : headline(),
            Math.max(6, props.width - 'SOURCE CONTROL'.length - 5)
          )}
        />
      </PanelHeader>
      <Show when={props.inRepo && props.staging}>
        <box
          height={1}
          flexDirection="row"
          backgroundColor={
            message.hovered() && !props.messageEditing
              ? ui.hoverBg
              : ui.sidebarBg
          }
          paddingLeft={1}
          onMouseDown={() => props.onMessageFocus()}
          onMouseOver={message.enter}
          onMouseOut={message.leave}
        >
          <text
            fg={ui.faint}
            bg={
              message.hovered() && !props.messageEditing
                ? ui.hoverBg
                : ui.sidebarBg
            }
            flexShrink={0}
            content="✎ "
          />
          <box flexGrow={1}>
            <Show
              when={props.messageEditing}
              fallback={
                <text
                  fg={props.commitMessage ? ui.text : ui.faint}
                  bg={message.hovered() ? ui.hoverBg : ui.sidebarBg}
                  wrapMode="none"
                  content={props.commitMessage || 'Message (c to edit)'}
                />
              }
            >
              <TextInput
                value={props.commitMessage}
                placeholder={
                  props.hasMessageHistory
                    ? 'Commit message (↑ history)'
                    : 'Commit message'
                }
                onInput={props.onMessageInput}
              />
            </Show>
          </box>
        </box>
        <box
          height={1}
          flexDirection="row"
          backgroundColor={ui.sidebarBg}
          paddingLeft={1}
        >
          <box
            flexShrink={0}
            backgroundColor={commitLit() ? ui.hoverBg : ui.sidebarBg}
            onMouseDown={() => props.onCommit()}
            onMouseOver={commit.enter}
            onMouseOut={commit.leave}
          >
            <text
              fg={props.busy ? ui.faint : ui.accent}
              bg={commitLit() ? ui.hoverBg : ui.sidebarBg}
              content={props.busy ? '⋯ Commit' : '✓ Commit'}
              attributes={TextAttributes.BOLD}
            />
          </box>
          <box flexGrow={1} backgroundColor={ui.sidebarBg} />
          <Show when={props.branch}>
            <box
              flexShrink={0}
              backgroundColor={syncLit() ? ui.hoverBg : ui.sidebarBg}
              onMouseDown={() => props.onSync()}
              onMouseOver={sync.enter}
              onMouseOut={sync.leave}
            >
              <text
                fg={props.busy ? ui.faint : syncLit() ? ui.text : ui.dim}
                bg={syncLit() ? ui.hoverBg : ui.sidebarBg}
                wrapMode="none"
                content={
                  props.hasUpstream
                    ? `⇅ sync${props.ahead > 0 ? ` ↑${props.ahead}` : ''}${props.behind > 0 ? ` ↓${props.behind}` : ''} `
                    : '⇡ publish '
                }
              />
            </box>
          </Show>
        </box>
      </Show>
      <Show
        when={props.inRepo && props.rows.length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.sidebarBg} paddingLeft={2}>
            <text
              fg={ui.faint}
              bg={ui.sidebarBg}
              content={
                props.inRepo ? 'no changes' : 'open a repository to use git'
              }
            />
          </box>
        }
      >
        <PanelList list={list} items={props.rows}>
          {(row, index) => {
            const bg = () =>
              rowBg(
                index() === cursor(),
                props.focused,
                rowHover.hovered(index())
              )
            const icon = () =>
              row.kind === 'section' || isCommitRow(row)
                ? null
                : iconFor(props.iconTheme, {
                    expanded: row.kind === 'dir' && !row.collapsed,
                    isDir: row.kind === 'dir',
                    name: iconName(row),
                  })
            const arrow = () =>
              row.kind !== 'file' && row.kind !== 'commit' && row.collapsed
                ? '▸'
                : '▾'
            const glyph = () =>
              icon()?.glyph ??
              (row.kind === 'file'
                ? ''
                : row.kind === 'commit'
                  ? row.group === 'incoming'
                    ? '↓'
                    : '↑'
                  : arrow())
            const glyphColor = () =>
              icon()?.color ?? (row.kind === 'file' ? ui.faint : ui.dim)
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                // Not stopped: the panel's own handler runs after this and focuses it.
                onMouseDown={() => props.onActivate(index())}
                onMouseOver={() => rowHover.enter(index())}
                onMouseOut={() => rowHover.leave(index())}
              >
                {/* Indent and glyph never give, as in the tree: shrinking them slides the marks. */}
                <text
                  fg={ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={` ${'  '.repeat(row.depth)}`}
                />
                <text
                  fg={glyphColor()}
                  bg={bg()}
                  flexShrink={0}
                  content={`${glyph()} `}
                />
                <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                  <text
                    wrapMode="none"
                    fg={
                      row.kind === 'file' || row.kind === 'commit'
                        ? ui.text
                        : ui.folder
                    }
                    bg={bg()}
                    content={row.label}
                    attributes={
                      row.kind === 'file' || row.kind === 'commit'
                        ? undefined
                        : TextAttributes.BOLD
                    }
                  />
                </box>
                <Show when={sectionRow(row)}>
                  {(section: () => SectionRow) => (
                    <text
                      fg={ui.faint}
                      bg={bg()}
                      flexShrink={0}
                      content={`${section().files} `}
                    />
                  )}
                </Show>
                <Show when={commitSectionRow(row)}>
                  {(section: () => CommitSectionRow) => (
                    <text
                      fg={ui.faint}
                      bg={bg()}
                      flexShrink={0}
                      content={`${section().count} `}
                    />
                  )}
                </Show>
                <Show when={dirRow(row)}>
                  {(dir: () => DirRow) => (
                    <text
                      fg={ui.faint}
                      bg={bg()}
                      flexShrink={0}
                      content={dir().collapsed ? `${dir().files} ` : ' '}
                    />
                  )}
                </Show>
                <Show when={fileRow(row)}>
                  {(file: () => FileRow) => (
                    <text
                      fg={statusColor(file().change.status)}
                      bg={bg()}
                      flexShrink={0}
                      content={`${MARKS[file().change.status]} `}
                    />
                  )}
                </Show>
                {/* The `+` handler stops the row's: pressing it must not fold the heading. */}
                {/* The cell is held open for every stageable row: drawing the glyph in
                      place of nothing would shove the status mark two columns over. */}
                <Show when={props.staging && !isCommitRow(row)}>
                  <box
                    flexShrink={0}
                    backgroundColor={
                      stageHover.hovered(index()) ? ui.hoverBg : bg()
                    }
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      props.onToggleStage(index())
                    }}
                    onMouseOver={() => stageHover.enter(index())}
                    onMouseOut={() => stageHover.leave(index())}
                  >
                    <text
                      fg={ui.accent}
                      bg={stageHover.hovered(index()) ? ui.hoverBg : bg()}
                      content={
                        row.kind === 'section' ||
                        index() === cursor() ||
                        rowHover.hovered(index())
                          ? `${stageGlyph(row)} `
                          : '  '
                      }
                    />
                  </box>
                </Show>
              </box>
            )
          }}
        </PanelList>
      </Show>
    </Panel>
  )
}
