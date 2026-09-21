import { createSignal } from 'solid-js'

import type { Panes } from './panes'
import type { Tree } from './tree'

export interface PreviewTarget {
  path: string
  isDir: boolean
}

export function createPreview(deps: { tree: Tree; panes: Panes }) {
  const { tree, panes } = deps
  const [on, setOn] = createSignal(false)
  // A ticket, not a position: two identical page requests in a row must both fire.
  const [scrollRequest, setScrollRequest] = createSignal<{
    pages: number
    at: number
  } | null>(null)
  let ticket = 0

  const target = (): PreviewTarget | null => {
    if (
      !on() ||
      !panes.sidebar() ||
      panes.view() !== 'files' ||
      panes.focus() !== 'tree'
    ) {
      return null
    }
    const node = tree.selectedNode()
    return node ? { isDir: node.isDir, path: node.path } : null
  }

  return {
    close: () => setOn(false),
    on,
    open: () => setOn(true),
    scroll: (pages: number) => {
      ticket += 1
      setScrollRequest({ at: ticket, pages })
    },
    scrollRequest,
    target,
    toggle: () => setOn((previewing) => !previewing),
  }
}

export type Preview = ReturnType<typeof createPreview>
