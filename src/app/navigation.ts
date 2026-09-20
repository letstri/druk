import { createEffect, createSignal, on } from 'solid-js'

import { exists } from '../core/fs'
import type { EditorBridge } from './editor'
import type { Panes } from './panes'
import type { Status } from './status'
import { pageKindOf } from './workspace'
import type { Workspace } from './workspace'

interface Stop {
  id: string
  line: number
  col: number
}

const MAX = 60

export function createNavigation(deps: {
  workspace: Workspace
  editor: EditorBridge
  panes: Panes
  status: Status
}) {
  const { workspace, editor, panes, status } = deps

  const [stops, setStops] = createSignal<Stop[]>([])
  const [at, setAt] = createSignal(-1)

  const current = () => stops()[at()]

  const alive = (stop: Stop) =>
    pageKindOf(stop.id) ? workspace.views().includes(stop.id) : exists(stop.id)

  const push = (stop: Stop) => {
    const kept = [...stops().slice(0, at() + 1), stop].slice(-MAX)
    setStops(kept)
    setAt(kept.length - 1)
  }

  // Mutated in place: replacing the array would redraw the tab strip on every caret move.
  createEffect(
    on(editor.cursor, position => {
      const stop = current()
      if (!stop || stop.id !== workspace.activeView()) return
      stop.line = position.line
      stop.col = position.col
    }),
  )

  // Compared by id, not a "navigating" flag: effects flush after `go` has returned.
  createEffect(
    on(workspace.activeView, id => {
      if (!id || current()?.id === id) return
      push({ id, line: 0, col: 0 })
    }),
  )

  const mark = () => {
    const stop = current()
    if (stop) push({ ...stop })
  }

  const go = (delta: 1 | -1) => {
    const list = stops()
    let index = at() + delta
    while (list[index] && !alive(list[index]!)) index += delta
    const stop = list[index]
    if (!stop) {
      if (list.length > 0) {
        const kept = delta < 0 ? list.slice(at()) : list.slice(0, at() + 1)
        setStops(kept)
        setAt(delta < 0 ? 0 : kept.length - 1)
      }
      return status.say(delta < 0 ? 'Nothing to go back to' : 'Nothing to go forward to')
    }
    setAt(index)
    workspace.showView(stop.id)
    editor.requestGoto(stop.line, stop.col)
    panes.setFocus('editor')
  }

  return {
    canBack: () => at() > 0,
    canForward: () => at() < stops().length - 1,
    back: () => go(-1),
    forward: () => go(1),
    mark,
  }
}

export type Navigation = ReturnType<typeof createNavigation>
