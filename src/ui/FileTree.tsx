import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { TreeNode } from '../core/fs'
import type { FileStatus } from '../core/git'
import { iconFor } from '../icons'
import { ui } from '../themes'
import { useHover, useHoverKey } from './hover'
import { createScrollList, scrollbarOptions } from './list'

export interface FileTreeProps {
  rootName: string
  nodes: TreeNode[]
  selectedPath: string | null
  expanded: Set<string>
  focused: boolean
  width: number
  /** Working-tree status per absolute path. */
  gitStatus: Map<string, FileStatus>
  /** Paths `.gitignore` excludes — drawn dim when they have no status mark. */
  gitIgnored: Set<string>
  /** Taken with `x` and waiting for a destination; drawn as in flight. */
  cutPaths: string[]
  /** Picked out with Shift+↑/↓, and what delete and move act on. */
  markedPaths: string[]
  /** `iconTheme`: the glyph column, or `'none'` for the plain arrow. */
  iconTheme: string
  onActivate: (node: TreeNode) => void
  onPin: (node: TreeNode) => void
  onFocus: () => void
  /** The header's ▴: shut every folder at once. */
  onCollapseAll: () => void
}

const DOUBLE_CLICK_MS = 400

export const MARKS: Record<FileStatus, string> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

export const statusColor = (status: FileStatus) =>
  status === 'untracked' || status === 'added'
    ? ui.gitAdded
    : status === 'deleted'
      ? ui.gitDeleted
      : ui.gitModified

export function FileTree(props: FileTreeProps) {
  /**
   * A folder inherits the status of whatever changed inside it — precomputed by
   * walking each entry's ancestors once per status refresh. Asking per folder
   * row instead (scan the whole map for a prefix) is O(rows × entries) *per
   * rebuild*, and on a large repository that scan was a visible share of every
   * refresh's stall. First entry under the folder wins, as the scan's map order
   * did: an already-filled dir means its ancestors are filled too.
   */
  const dirStatus = createMemo(() => {
    const map = new Map<string, FileStatus>()
    for (const [path, status] of props.gitStatus) {
      const mark: FileStatus = status === 'untracked' ? 'untracked' : 'modified'
      let dir = path
      for (;;) {
        const cut = dir.lastIndexOf('/')
        if (cut <= 0) break
        dir = dir.slice(0, cut)
        if (map.has(dir)) break
        map.set(dir, mark)
      }
    }
    return map
  })

  const statusOf = (node: TreeNode): FileStatus | undefined => {
    const own = props.gitStatus.get(node.path)
    if (own || !node.isDir) return own
    return dirStatus().get(node.path)
  }

  const list = createScrollList(() => props.nodes.length)
  const visible = createMemo(() => props.nodes.slice(list.window().start, list.window().end))
  const collapse = useHover()
  const rowHover = useHoverKey<string>()

  /**
   * The selection moves for reasons the tree cannot see — arrow keys, but also a tab
   * switch or a jump from search — and a highlight scrolled out of view reads as no
   * highlight at all.
   *
   * Keyed on the selected row's index, which is exactly what the scroll depends on,
   * and that precision is load-bearing three times over:
   *
   * - `nodes` is a fresh array on every git refresh. Tracking the array would yank a
   *   mouse-scrolled tree back every few seconds; the index is unchanged, so nothing
   *   happens.
   * - `focused` would snap the view back on every Tab or Esc — scroll away from the
   *   selection to read something, move focus, and it jumps although nothing was
   *   chosen. Navigating changes the index, so an arrow key still reveals the cursor.
   * - Opening a file from the picker expands its parents, which moves the row *after*
   *   the selection changed. Keying on the path alone would scroll to the old index
   *   and leave the file off-screen.
   */
  const selectedRow = createMemo(() =>
    props.nodes.findIndex(node => node.path === props.selectedPath),
  )

  createEffect(
    on(selectedRow, row => {
      if (row >= 0) list.reveal(row)
    }),
  )

  // OpenTUI has no double-click event, so detect it from consecutive downs.
  let lastClick = { path: '', at: 0 }

  const click = (node: TreeNode) => {
    props.onFocus()
    const now = Date.now()
    const isDouble = lastClick.path === node.path && now - lastClick.at < DOUBLE_CLICK_MS
    lastClick = { path: node.path, at: now }
    // Activating a folder toggles it, so the second click of a double-click would
    // close what the first one opened and the folder would look inert.
    if (isDouble && node.isDir) return
    props.onActivate(node)
    if (isDouble) props.onPin(node)
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.sidebarBg}
      flexShrink={0}
      flexGrow={1}
      // The tree fills what the sidebar's tab strip leaves. `flexBasis` must be 0:
      // with the default `auto` the box starts at its content's height, the
      // scrollbox below grows past the screen and its scrollbar never appears.
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      {/* One row, not two: the project and the view it is showing are one fact,
          and a sidebar that spends three rows before its first file reads as
          chrome. The label goes right, where it stays out of the name's way. */}
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
          content={props.rootName}
          attributes={TextAttributes.BOLD}
        />
        <box flexGrow={1} backgroundColor={ui.sidebarBg} />
        {/* The same arrowhead a row's own folder wears, pointing the way it
            folds — and gone when there is nothing open to fold. */}
        <Show when={props.expanded.size > 0}>
          <box
            flexShrink={0}
            backgroundColor={collapse.hovered() ? ui.hoverBg : ui.sidebarBg}
            onMouseDown={props.onCollapseAll}
            onMouseOver={collapse.enter}
            onMouseOut={collapse.leave}
          >
            <text
              fg={collapse.hovered() ? ui.text : ui.dim}
              bg={collapse.hovered() ? ui.hoverBg : ui.sidebarBg}
              content="▴ "
            />
          </box>
        </Show>
        <text fg={ui.faint} bg={ui.sidebarBg} flexShrink={0} content="explorer" />
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
          {node => {
            const selected = () =>
              node.path === props.selectedPath || props.markedPaths.includes(node.path)
            const bg = () =>
              selected()
                ? props.focused
                  ? ui.treeSelectedBg
                  : ui.treeFocusBg
                : rowHover.hovered(node.path)
                  ? ui.hoverBg
                  : ui.sidebarBg
            /** Taken with `x` and waiting for a destination: drawn as already gone. */
            const leaving = () => props.cutPaths.includes(node.path)
            const open = () => props.expanded.has(node.path)
            /**
             * The icon takes the arrow's column rather than a column of its own:
             * a folder glyph has an open and a closed form, so expansion stays
             * readable and a row costs the same width either way.
             */
            const icon = () =>
              iconFor(props.iconTheme, { name: node.name, isDir: node.isDir, expanded: open() })
            const glyph = () => icon()?.glyph ?? (node.isDir ? (open() ? '▾' : '▸') : '·')
            const glyphColor = () =>
              leaving() ? ui.faint : (icon()?.color ?? (node.isDir ? ui.dim : ui.faint))
            const status = () => statusOf(node)
            const ignored = () => props.gitIgnored.has(node.path)
            // Cut → status → ignored → ordinary. A status mark is more useful than
            // "this is ignored", and ignored still beats the default folder/text so
            // node_modules does not shout next to source.
            const nameColor = () =>
              leaving()
                ? ui.faint
                : status()
                  ? statusColor(status()!)
                  : ignored()
                    ? ui.dim
                    : node.isDir
                      ? ui.folder
                      : ui.text
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => click(node)}
                onMouseOver={() => rowHover.enter(node.path)}
                onMouseOut={() => rowHover.leave(node.path)}
              >
                {/* Everything but the name is flexShrink={0}. Flex shrinks every
                    item by default, so one long filename squeezed the indent and
                    the arrow and slid the row's glyphs a column left — which made
                    them jump around as a resize changed which rows overflow. The
                    name is the only thing allowed to give. */}
                <text
                  fg={ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={` ${'│ '.repeat(node.depth)}`}
                />
                <text fg={glyphColor()} bg={bg()} flexShrink={0} content={`${glyph()} `} />
                {/* The name takes the slack, so the mark is pushed to the panel's
                    right edge and every mark lines up in one column. */}
                <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                  <text
                    fg={nameColor()}
                    bg={bg()}
                    content={node.name}
                    attributes={node.isDir && !ignored() ? TextAttributes.BOLD : undefined}
                  />
                  {/* Beside the name, not in the mark column: a symlink is a
                      property of the entry, and the marks there are git's. */}
                  <Show when={node.symlink}>
                    <text fg={ui.dim} bg={bg()} flexShrink={0} content=" ↗" />
                  </Show>
                </box>
                <Show when={status()}>
                  {(status: () => FileStatus) => (
                    <text
                      fg={statusColor(status())}
                      bg={bg()}
                      flexShrink={0}
                      content={`${MARKS[status()]} `}
                    />
                  )}
                </Show>
              </box>
            )
          }}
        </For>
        <box
          height={Math.max(0, props.nodes.length - list.window().end)}
          flexShrink={0}
          backgroundColor={ui.sidebarBg}
        />
      </scrollbox>
    </box>
  )
}
