import { createSignal } from 'solid-js'

import { commitGraph } from '../core/git'
import type { GraphRow } from '../core/git'

export function createCommitGraph() {
  const [rows, setRows] = createSignal<GraphRow[]>([])
  const [cursor, setCursor] = createSignal(0)
  const [active, setActive] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  // Kept here, not in the view: the page unmounts whenever a commit is read over it.
  const [scrollTop, setScrollTop] = createSignal(0)
  let generation = 0

  const open = (repo: string) => {
    generation += 1
    const run = generation
    setActive(true)
    setLoading(true)
    setRows([])
    setCursor(0)
    setScrollTop(0)
    void (async () => {
      const loaded = await commitGraph(repo)
      if (run !== generation) {
        return
      }
      setRows(loaded)
      setLoading(false)
      setCursor(
        Math.max(
          0,
          loaded.findIndex((row) => row.commit !== null)
        )
      )
    })()
  }

  // Git's connector rows stand for no commit, so the cursor steps over them.
  const move = (delta: number) => {
    const list = rows()
    const step = delta < 0 ? -1 : 1
    const target = Math.max(0, Math.min(list.length - 1, cursor() + delta))
    for (let at = target; at >= 0 && at < list.length; at += step) {
      if (list[at]?.commit) {
        return setCursor(at)
      }
    }
    for (let at = target; at >= 0 && at < list.length; at -= step) {
      if (list[at]?.commit) {
        return setCursor(at)
      }
    }
  }

  const moveTo = (row: number) => {
    if (rows()[row]?.commit) {
      setCursor(row)
    }
  }

  const selected = () => rows()[cursor()]?.commit ?? null

  const close = () => {
    generation += 1
    setActive(false)
    setLoading(false)
    setRows([])
    setCursor(0)
    setScrollTop(0)
  }

  return {
    active,
    close,
    cursor,
    loading,
    move,
    moveTo,
    open,
    rows,
    scrollTop,
    selected,
    setScrollTop,
  }
}

export type CommitGraph = ReturnType<typeof createCommitGraph>
