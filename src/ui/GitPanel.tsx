import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { ChangeRow, DirRow, FileRow } from '../core/changeTree'
import { iconFor } from '../icons'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { createScrollList, rowBg, scrollbarOptions } from './list'

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const dirRow = (row: ChangeRow) => (row.kind === 'dir' ? row : undefined)
const fileRow = (row: ChangeRow) => (row.kind === 'file' ? row : undefined)

/**
 * The name an icon theme is keyed by. A folder row's label is a *joined* chain
 * (`src/app` is one row), and the files sit under its last segment, so that is
 * the folder the glyph is about; a file row's label is the whole rel path in
 * flat view, where the theme's whole-name rules (`package.json`) only match the
 * basename.
 */
const iconName = (row: ChangeRow): string =>
  (row.kind === 'file' ? row.change.rel : row.label).split('/').pop() ?? row.label

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
  /** Row under the cursor; may point past the end after a commit shrinks the list. */
  cursor: number
  focused: boolean
  width: number
  inRepo: boolean
  /** `iconTheme`: the glyph column, or `'none'` for the tree's plain arrow. */
  iconTheme: string
  onFocus: () => void
  /** A row clicked: move the cursor there, and diff it or fold it. */
  onActivate: (index: number) => void
  /** The header's ▴: fold every folder at once. */
  onCollapseAll: () => void
  /** Notes and fetched comments together — what the header's ◆ counts. */
  reviewCount: number
  /** The header's ◆: swap this panel for the review of the same change. */
  onReview: () => void
}

/**
 * The sidebar's source-control view — VS Code's left-hand git panel, sized down:
 * the changed files under the branch, the cursor paging the diff page beside it,
 * `c` to commit, `p` to push. Keys are handled in `app/keyboard.ts` beside the
 * tree's, so this renders and reports clicks, nothing more.
 */
export function GitPanel(props: GitPanelProps) {
  const cursor = () => Math.max(0, Math.min(props.cursor, props.rows.length - 1))

  const list = createScrollList(() => props.rows.length)
  const visible = createMemo(() => props.rows.slice(list.window().start, list.window().end))

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
          <box flexShrink={0} backgroundColor={ui.sidebarBg} onMouseDown={props.onCollapseAll}>
            <text fg={ui.dim} bg={ui.sidebarBg} content="▴ " />
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
        {/* The way into the review, in the slot a label naming the panel used to
            decorate — the pressed `Git` button above says that already, and at
            thirty columns the label is the room this needs. Spelt out rather
            than left as a glyph, and drawn whether or not anything is in it: a
            control that appears only once there is something to show is one
            nobody finds, and the review is where a note is *made*. Carries its
            own leading space — at the widths where the headline is being cut
            there is no slack left to space it from what precedes it. */}
        <text
          fg={props.reviewCount > 0 ? ui.accent : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={0}
          wrapMode="none"
          content={props.reviewCount > 0 ? ` ◆ review ${props.reviewCount}` : ' ◆ review'}
          onMouseDown={() => props.onReview()}
        />
      </box>
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
              const bg = () => rowBg(index() === cursor(), props.focused)
              /**
               * The icon takes the folder arrow's column, as it does in the tree:
               * the open and shut forms are what keep a folded row readable, and a
               * file row — which has no arrow — spends the same single column, so
               * the two views line their names up whether icons are on or off.
               */
              const icon = () =>
                iconFor(props.iconTheme, {
                  name: iconName(row),
                  isDir: row.kind === 'dir',
                  expanded: row.kind === 'dir' && !row.collapsed,
                })
              const glyph = () =>
                icon()?.glyph ?? (row.kind === 'dir' ? (row.collapsed ? '▸' : '▾') : '')
              const glyphColor = () => icon()?.color ?? (row.kind === 'dir' ? ui.dim : ui.faint)
              return (
                <box
                  height={1}
                  flexDirection="row"
                  backgroundColor={bg()}
                  // Deliberately not stopped: the panel's own handler runs after
                  // this one and focuses it, which is where the keyboard belongs —
                  // the arrows page the diff from here.
                  onMouseDown={() => props.onActivate(index())}
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
                      fg={row.kind === 'dir' ? ui.folder : ui.text}
                      bg={bg()}
                      content={row.label}
                      attributes={row.kind === 'dir' ? TextAttributes.BOLD : undefined}
                    />
                  </box>
                  {/* A folded folder says how many changes it is hiding, so the row
                      still carries its files' worth of information while it is shut. */}
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
      <Show when={props.inRepo}>
        <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
          <text
            fg={ui.faint}
            bg={ui.sidebarBg}
            content="↑↓ diff · →← fold · c commit · p push · B compare"
          />
        </box>
      </Show>
    </box>
  )
}
