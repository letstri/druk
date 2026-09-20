import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { TreeNode } from '../core/fs'
import type { FileStatus } from '../core/git'
import { iconFor } from '../icons'
import { ui } from '../themes'
import { useHoverKey } from './hover'
import { createScrollList, scrollbarOptions } from './list'
import { PanelHeader } from './PanelHeader'
import { cut } from './text'
import { useTooltip } from './tooltip'

export interface FileTreeProps {
  rootName: string
  nodes: TreeNode[]
  selectedPath: string | null
  expanded: Set<string>
  focused: boolean
  width: number
  gitStatus: Map<string, FileStatus>
  gitIgnored: Set<string>
  cutPaths: string[]
  markedPaths: string[]
  iconTheme: string
  onActivate: (node: TreeNode) => void
  onPin: (node: TreeNode) => void
  onFocus: () => void
  onCollapseAll: () => void
  onSwitchWorkspace: () => void
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
  // One walk per refresh: the first entry under a folder wins; a filled dir means filled ancestors.
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
  const collapse = useTooltip('view.collapse')
  const project = useTooltip('workspace.switch')
  const rowHover = useHoverKey<string>()

  // Keyed on the row *index*: `nodes` is fresh per refresh, and `focused` or the path yanks the scroll.
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
    // Activating a folder toggles it: the second click would close what the first opened.
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
      // `flexBasis` must be 0: with `auto` the scrollbox grows past the screen and loses its scrollbar.
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      <PanelHeader title="Explorer" width={props.width} focused={props.focused}>
        <Show when={props.expanded.size > 0}>
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
              content="▴"
            />
          </box>
        </Show>
      </PanelHeader>
      <box
        height={1}
        flexShrink={0}
        flexDirection="row"
        backgroundColor={ui.sidebarBg}
        paddingLeft={2}
        paddingRight={1}
      >
        <box
          ref={project.ref}
          flexShrink={1}
          backgroundColor={project.lit() ? ui.hoverBg : ui.sidebarBg}
          onMouseDown={props.onSwitchWorkspace}
          onMouseOver={project.enter}
          onMouseOut={project.leave}
        >
          <text
            fg={props.focused || project.lit() ? ui.text : ui.dim}
            bg={project.lit() ? ui.hoverBg : ui.sidebarBg}
            flexShrink={1}
            wrapMode="none"
            content={props.rootName.toUpperCase()}
            attributes={TextAttributes.BOLD}
          />
        </box>
        <box flexGrow={1} backgroundColor={ui.sidebarBg} />
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
            const leaving = () => props.cutPaths.includes(node.path)
            const open = () => props.expanded.has(node.path)
            const icon = () =>
              iconFor(props.iconTheme, { name: node.name, isDir: node.isDir, expanded: open() })
            const glyph = () => icon()?.glyph ?? (node.isDir ? (open() ? '▾' : '▸') : ' ')
            const glyphColor = () =>
              leaving() ? ui.faint : (icon()?.color ?? (node.isDir ? ui.dim : ui.faint))
            const status = () => statusOf(node)
            const ignored = () => props.gitIgnored.has(node.path)
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
                {/* Everything but the name is flexShrink={0}: one long filename would squeeze them. */}
                <text fg={ui.faint} bg={bg()} flexShrink={0} content={' '.repeat(node.depth * 2)} />
                <text fg={glyphColor()} bg={bg()} flexShrink={0} content={`${glyph()} `} />
                <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                  {/* The row is one tall, so a wrapped name loses its last word. */}
                  <text
                    fg={nameColor()}
                    bg={bg()}
                    wrapMode="none"
                    content={cut(
                      node.name,
                      props.width -
                        node.depth * 2 -
                        3 -
                        (node.symlink ? 2 : 0) -
                        (status() ? 2 : 0),
                    )}
                  />
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
