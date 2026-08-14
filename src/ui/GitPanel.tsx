import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { ChangeRow, CommitSectionRow, DirRow, FileRow, SectionRow } from '../core/changeTree'
import { rowArea } from '../core/changeTree'
import { iconFor } from '../icons'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { useHover, useHoverKey } from './hover'
import { createScrollList, rowBg, scrollbarOptions } from './list'
import { TextInput } from './TextInput'
import { useTooltip } from './tooltip'

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const dirRow = (row: ChangeRow) => (row.kind === 'dir' ? row : undefined)
const fileRow = (row: ChangeRow) => (row.kind === 'file' ? row : undefined)
const sectionRow = (row: ChangeRow) => (row.kind === 'section' ? row : undefined)
const commitSectionRow = (row: ChangeRow) => (row.kind === 'commitSection' ? row : undefined)

/** Rows that stand for a commit rather than a change — no icon, no stage control. */
const isCommitRow = (row: ChangeRow) => row.kind === 'commit' || row.kind === 'commitSection'

/**
 * The name an icon theme is keyed by. A folder row's label is a *joined* chain
 * (`src/app` is one row), and the files sit under its last segment, so that is
 * the folder the glyph is about; a file row's label is the whole rel path in
 * flat view, where the theme's whole-name rules (`package.json`) only match the
 * basename.
 */
const iconName = (row: ChangeRow): string =>
  (row.kind === 'file' ? row.change.rel : row.label).split('/').pop() ?? row.label

/** `+` puts a row in the index, `−` takes it back out — VS Code's two buttons. */
const stageGlyph = (row: ChangeRow) => (rowArea(row) === 'staged' ? '−' : '+')

export interface GitPanelProps {
  /** Repository the header is about, when the folder holds more than one. */
  repo: string | null
  branch: string | null
  /** Commits ahead of / behind the upstream, for the header. */
  ahead: number
  behind: number
  /** Every row the panel draws — folder rows included in tree view. */
  rows: ChangeRow[]
  /** Branch the list is against, or null for HEAD and the working tree. */
  base: string | null
  /** Whether the index is in play at all — false against a comparison base. */
  staging: boolean
  /** Row under the cursor; may point past the end after a commit shrinks the list. */
  cursor: number
  focused: boolean
  width: number
  inRepo: boolean
  /** `iconTheme`: the glyph column, or `'none'` for the tree's plain arrow. */
  iconTheme: string
  /** The commit box's text — held above the panel so it outlives a re-render. */
  commitMessage: string
  /** Whether the box owns the keyboard — a real input only while it does. */
  messageEditing: boolean
  /** Whether ↑ has anything to recall — what the placeholder offers. */
  hasMessageHistory: boolean
  /** Whether the branch has an upstream — what makes Sync a sync, not a publish. */
  hasUpstream: boolean
  onFocus: () => void
  /** A row clicked: move the cursor there, and diff it or fold it. */
  onActivate: (index: number) => void
  /** The header's ▴: fold every folder at once. */
  onCollapseAll: () => void
  /** A row's `+`/`−`: stage or unstage whatever that row stands for. */
  onToggleStage: (index: number) => void
  /** The message row clicked: put the keyboard in the box. */
  onMessageFocus: () => void
  onMessageInput: (value: string) => void
  /** The ✓ Commit button, and Enter in the box. */
  onCommit: () => void
  /** The ⇅/⇡ button: pull what origin has then push — or publish the branch. */
  onSync: () => void
}

/**
 * The sidebar's source-control view — VS Code's left-hand git panel, sized down:
 * the changed files under the branch, the cursor paging the diff beside it,
 * `a` for every file at once, `c` to commit, `p` to push. Keys are handled in
 * `app/keyboard.ts` beside the tree's, so this renders and reports clicks,
 * nothing more.
 */
export function GitPanel(props: GitPanelProps) {
  /**
   * A memo, not a plain function: `rows` is a fresh array on every git refresh,
   * and reading its length is what makes the reveal below a dependent of it. As
   * a function that effect re-runs on every refresh — a save, a watcher event —
   * and yanks a list the mouse scrolled away back to the cursor. The value is
   * unchanged, so a memo simply does not notify (the tree's `selectedRow` is the
   * same fix).
   */
  const cursor = createMemo(() => Math.max(0, Math.min(props.cursor, props.rows.length - 1)))

  const list = createScrollList(() => props.rows.length)
  const visible = createMemo(() => props.rows.slice(list.window().start, list.window().end))
  const collapse = useTooltip('view.collapse')
  const message = useHover()
  const commit = useHover()
  const sync = useHover()
  const rowHover = useHoverKey<number>()
  const stageHover = useHoverKey<number>()

  /**
   * Change lists are usually shorter than the panel, but `git status` after a big
   * refactor is not — and against a comparison base every file the branch touches
   * is a row. A cursor below the fold reads as no cursor at all.
   */
  createEffect(on(cursor, row => list.reveal(row)))

  const headline = () => {
    if (!props.inRepo) return 'not a git repository'
    const arrows =
      (props.ahead > 0 ? ` ↑${props.ahead}` : '') + (props.behind > 0 ? ` ↓${props.behind}` : '')
    // With several repositories open the branch alone says nothing about whose
    // branch it is — and none is picked until a file or a change is landed on.
    if (props.repo) return `${props.repo}/${props.branch ?? 'no branch'}${arrows}`
    return props.branch ? `${props.branch}${arrows}` : 'no branch'
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
      {/* One row, as the tree's header is: the branch takes the left, and what
          the panel is comparing against takes the right. */}
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
          content={headline()}
          attributes={TextAttributes.BOLD}
        />
        <box flexGrow={1} backgroundColor={ui.sidebarBg} />
        {/* Only tree view has folders to fold, and only while one is open: the
            flat list draws no folder rows at all. */}
        <Show when={props.rows.some(row => row.kind === 'dir' && !row.collapsed)}>
          <box
            ref={collapse.ref}
            flexShrink={0}
            backgroundColor={collapse.lit() ? ui.hoverBg : ui.sidebarBg}
            onMouseDown={props.onCollapseAll}
            onMouseOver={collapse.enter}
            onMouseOut={collapse.leave}
          >
            <text
              fg={collapse.lit() ? ui.text : ui.dim}
              bg={collapse.lit() ? ui.hoverBg : ui.sidebarBg}
              content="▴ "
            />
          </box>
        </Show>
        {/* The base has to be said somewhere: against another branch every file
            it touches is marked, which reads as a broken tree until you know why. */}
        <Show when={props.base}>
          <text
            fg={ui.accent}
            bg={ui.sidebarBg}
            flexShrink={0}
            wrapMode="none"
            content={`vs ${props.base}`}
          />
        </Show>
      </box>
      {/* VS Code's commit box: the message field over the change list, with the
          ✓ Commit button and Sync under it. Only while the index is in play —
          against a comparison base there is nothing a commit could be about. */}
      <Show when={props.inRepo && props.staging}>
        <box
          height={1}
          flexDirection="row"
          backgroundColor={message.hovered() && !props.messageEditing ? ui.hoverBg : ui.sidebarBg}
          paddingLeft={1}
          onMouseDown={() => props.onMessageFocus()}
          onMouseOver={message.enter}
          onMouseOut={message.leave}
        >
          <text
            fg={ui.faint}
            bg={message.hovered() && !props.messageEditing ? ui.hoverBg : ui.sidebarBg}
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
                // The empty box is the one place with room to say the key exists.
                placeholder={
                  props.hasMessageHistory ? 'Commit message (↑ history)' : 'Commit message'
                }
                onInput={props.onMessageInput}
              />
            </Show>
          </box>
        </box>
        <box height={1} flexDirection="row" backgroundColor={ui.sidebarBg} paddingLeft={1}>
          <box
            flexShrink={0}
            backgroundColor={commit.hovered() ? ui.hoverBg : ui.sidebarBg}
            onMouseDown={() => props.onCommit()}
            onMouseOver={commit.enter}
            onMouseOut={commit.leave}
          >
            <text
              fg={ui.accent}
              bg={commit.hovered() ? ui.hoverBg : ui.sidebarBg}
              content="✓ Commit"
              attributes={TextAttributes.BOLD}
            />
          </box>
          <box flexGrow={1} backgroundColor={ui.sidebarBg} />
          {/* Sync only means something on a branch; publish is its no-upstream turn. */}
          <Show when={props.branch}>
            <box
              flexShrink={0}
              backgroundColor={sync.hovered() ? ui.hoverBg : ui.sidebarBg}
              onMouseDown={() => props.onSync()}
              onMouseOver={sync.enter}
              onMouseOut={sync.leave}
            >
              <text
                fg={sync.hovered() ? ui.text : ui.dim}
                bg={sync.hovered() ? ui.hoverBg : ui.sidebarBg}
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
              content={props.inRepo ? 'no changes' : 'open a repository to use git'}
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
          <For each={visible()}>
            {(row, at) => {
              const index = () => list.window().start + at()
              const bg = () => rowBg(index() === cursor(), props.focused, rowHover.hovered(index()))
              /**
               * The icon takes the folder arrow's column, as it does in the tree:
               * the open and shut forms are what keep a folded row readable, and a
               * file row — which has no arrow — spends the same single column, so
               * the two views line their names up whether icons are on or off.
               */
              // A heading is not a file, so it takes the arrow itself rather
              // than an icon theme's folder glyph.
              const icon = () =>
                row.kind === 'section' || isCommitRow(row)
                  ? null
                  : iconFor(props.iconTheme, {
                      name: iconName(row),
                      isDir: row.kind === 'dir',
                      expanded: row.kind === 'dir' && !row.collapsed,
                    })
              const arrow = () =>
                row.kind !== 'file' && row.kind !== 'commit' && row.collapsed ? '▸' : '▾'
              // A commit row wears its direction — what a pull brings in, what a
              // push would send — where a file wears its icon.
              const glyph = () =>
                icon()?.glyph ??
                (row.kind === 'file'
                  ? ''
                  : row.kind === 'commit'
                    ? row.group === 'incoming'
                      ? '↓'
                      : '↑'
                    : arrow())
              const glyphColor = () => icon()?.color ?? (row.kind === 'file' ? ui.faint : ui.dim)
              return (
                <box
                  height={1}
                  flexDirection="row"
                  backgroundColor={bg()}
                  // Deliberately not stopped: the panel's own handler runs after
                  // this one and focuses it, which is where the keyboard belongs —
                  // the arrows page the diff from here.
                  onMouseDown={() => props.onActivate(index())}
                  onMouseOver={() => rowHover.enter(index())}
                  onMouseOut={() => rowHover.leave(index())}
                >
                  {/* Indent and glyph never give, as in the tree: shrinking them
                      slid every row's marks a column left. The name is the only
                      thing allowed to give. */}
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    content={` ${'│ '.repeat(row.depth)}`}
                  />
                  <text fg={glyphColor()} bg={bg()} flexShrink={0} content={`${glyph()} `} />
                  <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                    <text
                      wrapMode="none"
                      fg={row.kind === 'file' || row.kind === 'commit' ? ui.text : ui.folder}
                      bg={bg()}
                      content={row.label}
                      attributes={
                        row.kind === 'file' || row.kind === 'commit'
                          ? undefined
                          : TextAttributes.BOLD
                      }
                    />
                  </box>
                  {/* A heading always says how many are under it — that count is
                      what a group heading is *for*. A folder says so only while
                      it is shut, so the row keeps its files' worth of
                      information with them out of sight. */}
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
                  {/* The stage control. A heading always wears one — that is how
                      every file under it is staged or unstaged at once, and a
                      list of headings is not a column of `+`. A file or folder
                      still only has it on the cursor's row: a terminal has no
                      hover to hide a button behind. Its own handler, and it
                      runs before the row's — pressing `+` is not pressing the
                      row, which would fold a heading. */}
                  <Show
                    when={
                      props.staging &&
                      !isCommitRow(row) &&
                      (row.kind === 'section' || index() === cursor())
                    }
                  >
                    <box
                      flexShrink={0}
                      backgroundColor={stageHover.hovered(index()) ? ui.hoverBg : bg()}
                      onMouseDown={event => {
                        event.stopPropagation()
                        props.onToggleStage(index())
                      }}
                      onMouseOver={() => stageHover.enter(index())}
                      onMouseOut={() => stageHover.leave(index())}
                    >
                      <text
                        fg={ui.accent}
                        bg={stageHover.hovered(index()) ? ui.hoverBg : bg()}
                        content={`${stageGlyph(row)} `}
                      />
                    </box>
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
      </Show>
    </box>
  )
}
