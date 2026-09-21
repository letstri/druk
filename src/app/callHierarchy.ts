import { createSignal } from 'solid-js'

import type { CallDirection, CallNode } from '../lsp/hierarchy'
import type { CallHierarchyItem } from '../lsp/protocol'

export function createCallHierarchy(deps: {
  calls: (
    path: string,
    direction: CallDirection,
    item: CallHierarchyItem
  ) => Promise<CallNode[]>
}) {
  const [rows, setRows] = createSignal<CallNode[]>([])
  const [cursor, setCursor] = createSignal(0)
  const [open, setOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [title, setTitle] = createSignal('')
  let generation = 0

  // One level, both ways: what calls the symbol and what it calls. Walking the callers of a
  // caller is how a peek on one function ends up showing the program's entry point.
  const start = (node: CallNode, path: string, line: number) => {
    generation += 1
    const run = generation
    setTitle(node.label)
    setOpen(true)
    setLoading(true)
    setCursor(0)
    setRows([node])
    void (async () => {
      const [incoming, outgoing] = await Promise.all([
        deps.calls(path, 'incoming', node.item),
        deps.calls(path, 'outgoing', node.item),
      ])
      if (run !== generation) {
        return
      }
      const found = [node, ...incoming, ...outgoing]
      setLoading(false)
      setRows(found)
      // The line the peek was opened on is one of these rows: opening anywhere else is a
      // jump the reader did not ask for, and the code beside the list would be somewhere new.
      const here = found.findIndex(
        (row) => row.target.path === path && row.target.line === line
      )
      setCursor(Math.max(0, here))
    })()
  }

  const move = (delta: number) => {
    const last = Math.max(0, rows().length - 1)
    setCursor(Math.max(0, Math.min(last, cursor() + delta)))
  }

  const moveTo = (row: number) => {
    if (row >= 0 && row < rows().length) {
      setCursor(row)
    }
  }

  const selected = () => rows()[cursor()] ?? null

  const close = () => {
    generation += 1
    setOpen(false)
    setLoading(false)
    setRows([])
    setCursor(0)
    setTitle('')
  }

  return {
    close,
    cursor,
    loading,
    move,
    moveTo,
    open,
    rows,
    selected,
    start,
    title,
  }
}

export type CallHierarchy = ReturnType<typeof createCallHierarchy>
