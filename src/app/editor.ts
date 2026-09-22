import { createSignal } from 'solid-js'

import type { FoldOp } from '../editor/folds'
import type { VimMode } from '../editor/vim'

// Each request bumps `key`: the same request twice must still retrigger the effect.
export function createEditorBridge(vim: boolean) {
  const [vimMode, setVimMode] = createSignal<VimMode | null>(
    vim ? 'normal' : null
  )
  const [reloadKey, setReloadKey] = createSignal(0)
  const [history, setHistory] = createSignal<{
    kind: 'undo' | 'redo'
    key: number
  } | null>(null)
  const [goto, setGoto] = createSignal<{
    line: number
    col: number
    key: number
    // Reveal the line without the flash and without taking the keyboard back.
    quiet?: boolean
  } | null>(null)
  const [edit, setEdit] = createSignal<{ content: string; key: number } | null>(
    null
  )
  const [lineOp, setLineOp] = createSignal<{
    op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete'
    key: number
  } | null>(null)
  const [foldOp, setFoldOp] = createSignal<{ op: FoldOp; key: number } | null>(
    null
  )
  const [lineHome, setLineHome] = createSignal<{ key: number } | null>(null)
  const [cursor, setCursor] = createSignal({ col: 0, line: 0 })
  const [selection, setSelection] = createSignal<{
    from: number
    to: number
  } | null>(null)
  const [completion, setCompletion] = createSignal<{ key: number } | null>(null)
  const [completionOpen, setCompletionOpen] = createSignal(false)

  const bumpReload = () => setReloadKey((k) => k + 1)
  const requestHistory = (kind: 'undo' | 'redo') =>
    setHistory((prev) => ({ key: (prev?.key ?? 0) + 1, kind }))
  const requestGoto = (line: number, col: number, quiet = false) =>
    setGoto((prev) => ({ col, key: (prev?.key ?? 0) + 1, line, quiet }))
  const pushEdit = (content: string) =>
    setEdit((prev) => ({ content, key: (prev?.key ?? 0) + 1 }))
  const requestLineOp = (
    op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete'
  ) => setLineOp((prev) => ({ key: (prev?.key ?? 0) + 1, op }))
  const requestCompletion = () =>
    setCompletion((prev) => ({ key: (prev?.key ?? 0) + 1 }))
  const requestFoldOp = (op: FoldOp) =>
    setFoldOp((prev) => ({ key: (prev?.key ?? 0) + 1, op }))
  const requestLineHome = () =>
    setLineHome((prev) => ({ key: (prev?.key ?? 0) + 1 }))

  return {
    bumpReload,
    completion,
    completionOpen,
    cursor,
    edit,
    foldOp,
    goto,
    history,
    lineHome,
    lineOp,
    pushEdit,
    reloadKey,
    requestCompletion,
    requestFoldOp,
    requestGoto,
    requestHistory,
    requestLineHome,
    requestLineOp,
    selection,
    setCompletionOpen,
    setCursor,
    setSelection,
    setVimMode,
    vimMode,
  }
}

export type EditorBridge = ReturnType<typeof createEditorBridge>
