import { createEffect, createSignal, on } from 'solid-js'

import { exists } from '../core/fs'
import type { EditorBridge } from './editor'
import type { Panes } from './panes'
import type { Status } from './status'
import type { Workspace } from './workspace'

/** One place the editor has been: which tab, and where the cursor sat in it. */
interface Stop {
  /** A view id — a file path, or the diff tab's own id. */
  id: string
  line: number
  col: number
}

/** Stops kept before the oldest falls off the back. */
const MAX = 60

/**
 * Where the editor has been, in order — what the tab strip's arrows walk. A stop
 * is a position rather than a tab: going to a definition and back to the line
 * that asked for it is the whole point, and half of those jumps never leave the
 * file they started in.
 */
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

  /** A stop still worth going to: its file is still on disk. */
  const alive = (stop: Stop) => exists(stop.id)

  const push = (stop: Stop) => {
    // What was ahead is the branch just left behind: as in a browser, going
    // somewhere new from the middle of the list throws the forward stops away.
    const kept = [...stops().slice(0, at() + 1), stop].slice(-MAX)
    setStops(kept)
    setAt(kept.length - 1)
  }

  /**
   * Keep the stop the editor is on at the cursor's position, so going back to it
   * later lands where it was left. The stop objects are mutated rather than
   * replaced: only the length and the index are worth a repaint, and rebuilding
   * the array would redraw the tab strip on every caret move.
   */
  createEffect(
    on(editor.cursor, position => {
      const stop = current()
      if (!stop || stop.id !== workspace.activeView()) return
      stop.line = position.line
      stop.col = position.col
    }),
  )

  /**
   * Every tab the editor lands on becomes a stop, bar the one it is already on —
   * which is what keeps walking back and forth from recording anything. Comparing
   * ids rather than holding a "navigating" flag is deliberate: effects flush after
   * `go` has returned, so a flag would be down again by the time this ran.
   */
  createEffect(
    on(workspace.activeView, id => {
      if (!id || current()?.id === id) return
      push({ id, line: 0, col: 0 })
    }),
  )

  /**
   * Freeze where the cursor is as a stop of its own, for a jump that stays inside
   * the file already open: no tab changes there, so this is the only thing that
   * leaves a way back to the line the jump was asked from.
   */
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
      // Nothing that way has survived — files deleted, a diff long closed.
      // Dropping the dead stops greys the arrow out instead of leaving it live
      // and inert.
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
