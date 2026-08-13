import { createSignal } from 'solid-js'

import type { FoldOp } from '../editor/folds'
import type { VimMode } from '../editor/vim'

/**
 * One-shot channels into EditorPane. Each value carries a `key` bumped per
 * request, so asking for the same thing twice still retriggers the effect
 * watching it — content equality would swallow the repeat.
 */
export function createEditorBridge(vim: boolean) {
  const [vimMode, setVimMode] = createSignal<VimMode | null>(vim ? 'normal' : null)
  const [reloadKey, setReloadKey] = createSignal(0)
  const [history, setHistory] = createSignal<{ kind: 'undo' | 'redo'; key: number } | null>(null)
  const [goto, setGoto] = createSignal<{ line: number; col: number; key: number } | null>(null)
  /** Outside text pushed into the editor as one undoable step. */
  const [edit, setEdit] = createSignal<{ content: string; key: number } | null>(null)
  /**
   * Line edits requested from the palette. Commands as well as chords, because
   * the chords are not always sendable — Ctrl+/ has no byte on some layouts and
   * Opt needs "Option as Esc+" on macOS terminals.
   */
  const [lineOp, setLineOp] = createSignal<{
    op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete'
    key: number
  } | null>(null)
  /** Folding, the same one-shot shape: the pane owns which blocks are collapsed. */
  const [foldOp, setFoldOp] = createSignal<{ op: FoldOp; key: number } | null>(null)
  /** Caret to column 0 of the current line — not a lineOp, those rewrite text. */
  const [lineHome, setLineHome] = createSignal<{ key: number } | null>(null)
  const [cursor, setCursor] = createSignal({ line: 0, col: 0 })
  /**
   * The lines the editor's selection spans, or null while there is none. Only
   * the lines: the review notes are the one caller, and a note is about lines.
   */
  const [selection, setSelection] = createSignal<{ from: number; to: number } | null>(null)
  /** Palette-triggered "open the completion menu", same one-shot shape as lineOp. */
  const [completion, setCompletion] = createSignal<{ key: number } | null>(null)
  /**
   * Whether EditorPane's completion menu is on screen. Global key handlers need
   * it: Esc must close the menu, not move focus to the tree.
   */
  const [completionOpen, setCompletionOpen] = createSignal(false)

  const bumpReload = () => setReloadKey(k => k + 1)
  const requestHistory = (kind: 'undo' | 'redo') =>
    setHistory(prev => ({ kind, key: (prev?.key ?? 0) + 1 }))
  const requestGoto = (line: number, col: number) =>
    setGoto(prev => ({ line, col, key: (prev?.key ?? 0) + 1 }))
  /** Push `content` into the active editor as one undoable step. */
  const pushEdit = (content: string) => setEdit(prev => ({ content, key: (prev?.key ?? 0) + 1 }))
  const requestLineOp = (op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete') =>
    setLineOp(prev => ({ op, key: (prev?.key ?? 0) + 1 }))
  const requestCompletion = () => setCompletion(prev => ({ key: (prev?.key ?? 0) + 1 }))
  const requestFoldOp = (op: FoldOp) => setFoldOp(prev => ({ op, key: (prev?.key ?? 0) + 1 }))
  const requestLineHome = () => setLineHome(prev => ({ key: (prev?.key ?? 0) + 1 }))

  return {
    vimMode,
    setVimMode,
    reloadKey,
    bumpReload,
    history,
    requestHistory,
    goto,
    requestGoto,
    edit,
    pushEdit,
    lineOp,
    requestLineOp,
    foldOp,
    requestFoldOp,
    lineHome,
    requestLineHome,
    completion,
    requestCompletion,
    completionOpen,
    setCompletionOpen,
    cursor,
    setCursor,
    selection,
    setSelection,
  }
}

export type EditorBridge = ReturnType<typeof createEditorBridge>
