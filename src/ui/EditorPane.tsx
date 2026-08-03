import { TextAttributes } from '@opentui/core'
import type { KeyEvent, MouseEvent, TextareaRenderable } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'

import { copyToClipboard, readClipboard } from '../core/clipboard'
import type { CursorStyle } from '../core/config'
import type { LineChange } from '../core/git'
import { changeRows } from '../editor/changes'
import { inCells } from '../editor/columns'
import { History } from '../editor/history'
import { duplicateLines, moveLines, toggleComment } from '../editor/lines'
import { problemRows } from '../editor/problems'
import { handleTyping } from '../editor/typing'
import { handleVimKey, initialVimState } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { lineAt, logicalWindow } from '../editor/window'
import { commentPrefix } from '../languages'
import {
  computeHighlights,
  getSyntaxStyle,
  mixColors,
  segmentsIn,
  STALE,
  styleIdForGroup,
} from '../languages/highlight'
import type { Highlighted, Segment } from '../languages/highlight'
import {
  applyCompletion,
  extendsWord,
  filterCompletions,
  isWordChar,
  TRIGGER_CHARS,
  wordStart,
} from '../lsp/completion'
import type { CompletionReply } from '../lsp/completion'
import type { CompletionItem, ProblemSeverity } from '../lsp/protocol'
import { paintedTheme, ui } from '../themes'
import { CompletionMenu, MENU_ROWS, menuWidth } from './CompletionMenu'
import { cut } from './text'
import { useKeys } from './useKeys'
import { Welcome } from './Welcome'

export interface EditorPaneProps {
  path: string | null
  content: string
  /** Shown on the welcome screen only, when no file is open. */
  rootName: string
  branch: string | null
  version: string
  filetype?: string
  focused: boolean
  reloadKey: number
  /** Cursor target requested from outside (search results); bumped `key` re-applies. */
  goto: { line: number; col: number; key: number } | null
  /** Undo/redo requested from the palette; bumped `key` re-applies. */
  history: { kind: 'undo' | 'redo'; key: number } | null
  /**
   * Text replaced from outside as one *undoable* step — search replace, trim on
   * save. Distinct from `reloadKey`, which adopts outside text and wipes history.
   */
  edit: { content: string; key: number } | null
  /** A line edit asked for from the palette; bumped `key` re-applies. */
  lineOp: { op: 'comment' | 'up' | 'down' | 'duplicate'; key: number } | null
  vim: boolean
  /** Caret shape, for as long as vim is off — see the `cursorStyle` config key. */
  cursorStyle: CursorStyle
  tabSize: number
  /** True while a modal owns the keyboard; the editor must ignore all keys. */
  blocked: boolean
  /** Lines changed against git HEAD, for the gutter marks. */
  gitLines: Map<number, LineChange>
  /** Worst LSP diagnostic per line; claims the gutter slot over a git mark. */
  problems: Map<number, { severity: ProblemSeverity; message: string }>
  /** Every diagnostic's span, for the tint over the offending text. */
  problemRanges: {
    line: number
    col: number
    endLine: number
    endCol: number
    severity: ProblemSeverity
    unnecessary: boolean
  }[]
  /** Also draw each problem's message after the end of its line. */
  problemText: boolean
  /**
   * Ask the language server for completions at a buffer position. Null when the
   * feature is off — the resolver also answers null, but a null prop is what
   * keeps the pane from scheduling requests at all.
   */
  complete: ((line: number, col: number) => Promise<CompletionReply | null>) | null
  /**
   * Ask the server to fill in a chosen item's withheld fields — auto-import
   * edits, mostly. Null when the feature is off; null result means "insert the
   * item as it came".
   */
  resolveCompletion: ((item: CompletionItem) => Promise<CompletionItem | null>) | null
  /** Completion asked for from the palette; bumped `key` re-applies. */
  completionRequest: { key: number } | null
  /** The menu opened or closed — the global Esc handler steers around it. */
  onCompletionMenu: (open: boolean) => void
  /**
   * A file that would not open. Drawn over the pane, because the answer to "open
   * this" has to land where the file would have appeared — not as a status-bar line
   * under whatever is still on screen. No buffer exists for it.
   */
  notice: { name: string; reason: string } | null
  onChange: (text: string) => void
  onCursor: (pos: { line: number; col: number }) => void
  onFocus: () => void
  onVimMode: (mode: VimMode | null) => void
  /**
   * Ctrl+C with nothing selected. Only this component can tell whether there is a
   * selection to copy, so it owns the decision and App owns the quitting.
   */
  onQuit: () => void
}

/**
 * Long enough to swallow the keystrokes of one fast burst, no longer. It used to be
 * 80ms, which was 80ms of doing nothing before a parse that costs 70ms on its own —
 * over half the wait to first colour on a 1 000-line file, spent idle. Overlapping
 * parses are held off by `runHighlight`, not by this.
 */
const DEBOUNCE_MS = 16
/** Lines kept highlighted above and below the viewport, so small scrolls are free. */
const OVERSCAN = 60
/**
 * Keystrokes an auto-triggered completion request waits for more of. Under the
 * didChange debounce on purpose: the request itself flushes the pending edit,
 * so a shorter wait here costs nothing and the menu feels immediate.
 */
const COMPLETION_DEBOUNCE_MS = 90
/**
 * How long an accept waits on `completionItem/resolve` before inserting without
 * the auto-import. Bounded: the insert is answering a keystroke, and a server
 * too slow to name its import forfeits it rather than freezing the caret.
 */
const RESOLVE_TIMEOUT_MS = 300

const SIGN_GLYPH: Record<LineChange, string> = { added: '▎', modified: '▎', deleted: '▁' }

/** Read at paint time: `ui` is a store, so a table built at module scope freezes. */
const CHANGE_COLORS: Record<LineChange, () => string> = {
  added: () => ui.gitAdded,
  modified: () => ui.gitModified,
  deleted: () => ui.gitDeleted,
}

const PROBLEM_COLORS: Record<ProblemSeverity, () => string> = {
  error: () => ui.error,
  warning: () => ui.dirty,
  info: () => ui.dim,
  hint: () => ui.dim,
}

/** A track row's color: the mark's own, or the background where the row is bare. */
const trackColor = <T extends string>(
  colors: Record<T, () => string>,
  mark: T | undefined,
): string => (mark ? colors[mark]() : ui.bg)

/**
 * Inline note text: the severity color pulled most of the way to the background
 * so the message reads as an annotation beside the code rather than as a badge
 * competing with it. The gutter dot carries the severity at full strength.
 */
const PROBLEM_NOTE_COLORS: Record<ProblemSeverity, () => string> = {
  error: () => mixColors(ui.solidBg, ui.error, 0.62),
  warning: () => mixColors(ui.solidBg, ui.dirty, 0.62),
  info: () => ui.dim,
  hint: () => ui.dim,
}

/** Per renderer, the one renderable a mouse selection may start in. */
const selectionHosts = new WeakMap<object, unknown>()

/**
 * Any text renderable is selectable by default, so dragging across a tree row or
 * a tab selects that chrome text. Selecting is only ever meaningful in the
 * editor, where Ctrl+C copies it, so each renderer is gated once and then tracks
 * whichever textarea is currently mounted.
 */
function allowSelectionOnlyInEditor(el: TextareaRenderable) {
  const renderer = useRenderer() as unknown as {
    startSelection: (renderable: unknown, x: number, y: number) => void
  }
  const gated = selectionHosts.has(renderer)
  selectionHosts.set(renderer, el)
  if (gated) return

  const start = renderer.startSelection.bind(renderer)
  renderer.startSelection = (renderable: unknown, x: number, y: number) => {
    if (renderable === selectionHosts.get(renderer)) start(renderable, x, y)
  }
}

/**
 * Run `after` once the editor has taken its new size. Two things need it, and
 * OpenTUI reports the resize nowhere else:
 *
 * The gutter draws into a cached buffer and only invalidates it when the line
 * count changes — but a resize re-wraps the text without changing that count, and
 * the cached paint still maps rows to the lines they held at the old width. The
 * numbers then land on continuation rows and the lines that follow lose theirs.
 * Anything that marks the gutter dirty fixes it; re-applying the signs is the
 * public call that does, and it is what the pane already has to hand.
 *
 * The scrollbar is measured against the pane, so it is wrong until it is read
 * again at the new size.
 */
export function afterResize(el: TextareaRenderable, after: () => void) {
  const host = el as unknown as { onResize: (width: number, height: number) => void }
  const resize = host.onResize.bind(host)
  host.onResize = (width: number, height: number) => {
    resize(width, height)
    after()
  }
}

/**
 * When the renderer's hit test finds nothing under the wheel it hands the event
 * to whatever is focused, so scrolling the file tree also scrolled the editor.
 * The internal handler ignores preventDefault and runs after every listener, so
 * the only place to drop the event is the renderable's own hook.
 */
export function ignoreScrollOutsideBounds(el: TextareaRenderable) {
  // `onMouseEvent` is protected; overriding it is the documented extension point
  // for subclasses, and this is the same override without subclassing.
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    if (event.type === 'scroll') {
      const { x, y, width, height } = el
      const inside = event.x >= x && event.x < x + width && event.y >= y && event.y < y + height
      if (!inside) return
    }
    handle(event)
  }
}

export function EditorPane(props: EditorPaneProps) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  /** LineNumberRenderable takes `minWidth` in its constructor only, and Solid's
   * reconciler builds elements bare, so the width has to be poked in by hand. */
  interface GutterHost {
    gutter?: { _minWidth?: number; requestRender?: () => void }
    setLineSigns?: (signs: Map<number, { before?: string; beforeColor?: string }>) => void
  }
  let gutter: GutterHost | undefined
  let editor: TextareaRenderable | undefined
  let highlightTimer: ReturnType<typeof setTimeout> | null = null
  /** A parse is with the worker; `queuedParse` says the text moved on since. */
  let parsing = false
  let queuedParse = false
  /** Segments grouped by line, plus the lines currently pushed to the buffer.
   * Every highlight is an FFI call, so the window is maintained incrementally:
   * scrolling adds the lines that appeared and drops the ones that left. */
  let byLine = new Map<number, Segment[]>()
  /** The last parse, segmented lazily per window. */
  let parsed: Highlighted | null = null
  /** Lines already turned into segments, so each is done once. */
  const segmented = new Set<number>()
  const appliedLines = new Set<number>()
  const cursor = { line: 0, col: 0 }
  const history = new History({ content: props.content, cursor: 0 })
  /** Cursor offset before the edit in progress — where undo should land. */
  let cursorBeforeEdit = 0
  const vimState = initialVimState()
  /**
   * Vim's mode, mirrored as a signal. `vimState` is a plain object, so the caret's
   * shape — which is how normal and insert are told apart — has nothing to derive
   * itself from without this.
   */
  const [vimMode, setVimMode] = createSignal<VimMode>(vimState.mode)

  const [editorEl, setEditorEl] = createSignal<TextareaRenderable | null>(null)
  const [cursorLine, setCursorLine] = createSignal(0)
  /**
   * Scroll position of the textarea, mirrored so the scrollbar can react to it.
   * Three signals rather than one object: a single `{top, height, total}` gets a
   * new identity on every scroll step, so anything reading it for the height
   * alone would recompute on each arrow key.
   */
  const [viewTop, setViewTop] = createSignal(0)
  const [viewHeight, setViewHeight] = createSignal(0)
  const [viewTotal, setViewTotal] = createSignal(0)
  /**
   * The buffer's row layout: logical line per visual row, and each row's used
   * width. Wrapping makes rows and lines two different things, and `scrollY`
   * counts visual rows while highlights are addressed by logical line: on a
   * lockfile whose lines wrap four times, scrolling to line 1500 asked for a
   * window around line 5970 — past the end of a 3000-line file, so nothing was
   * highlighted and the text went white.
   *
   * Cached because reading it is not a property read: `lineInfo` unpacks four
   * native arrays element by element, so a file that wraps to 12 000 rows costs
   * milliseconds per read — far too much for the scroll path, which touches it
   * on every wheel tick. Invalidated from `line-info-change`, which the buffer
   * emits for exactly the two things that move rows: an edit and a resize.
   */
  let layout: { sources: number[]; widths: number[] } | null = null
  const forgetLayout = () => {
    layout = null
  }

  /**
   * Not guarded on `virtualLineCount`: that reports the viewport's rows, not the
   * buffer's — it says 22 on a file whose 3 000 lines wrap to 12 000 — so the
   * table is the only honest answer.
   */
  const lineLayout = (): { sources: number[]; widths: number[] } => {
    if (!editor) return { sources: [], widths: [] }
    if (!layout) {
      const info = editor.lineInfo
      layout = { sources: info.lineSources as number[], widths: info.lineWidthCols as number[] }
    }
    return layout
  }

  const wrapMap = (): number[] => lineLayout().sources

  const lineAtRow = (row: number): number => lineAt(wrapMap(), row)

  /**
   * The first visual row of a line — the inverse of `lineAtRow`, by binary
   * search, since the table is non-decreasing. Scrolling has to be expressed in
   * rows even when everything else is counted in lines.
   */
  const rowAtLine = (line: number): number => {
    const map = wrapMap()
    if (map.length === 0) return line
    let low = 0
    let high = map.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if ((map[mid] ?? 0) < line) low = mid + 1
      else high = mid
    }
    return low
  }

  // Counted without split(): this re-runs on every keystroke, and allocating an
  // array of every line just to count them is the expensive way to find '\n'.
  const lineCount = createMemo(() => {
    let lines = 1
    for (let at = props.content.indexOf('\n'); at >= 0; at = props.content.indexOf('\n', at + 1)) {
      lines++
    }
    return lines
  })

  /**
   * The track's size, apart from where the file is scrolled to — the two tracks
   * beside the scrollbar depend on this and nothing else, and folding it into
   * `scrollMetrics` would recompute both of them, and re-diff their rows, on
   * every wheel tick.
   *
   * The textarea reports height 0 until the first layout, so until then fall
   * back to the terminal minus the tab bar and status bar.
   */
  const trackHeight = createMemo(() => viewHeight() || dimensions().height - 2)
  const trackTotal = createMemo(() => viewTotal() || lineCount())

  /** Track geometry, shared by the painter and the drag handler. */
  const scrollMetrics = createMemo(() => {
    const height = trackHeight()
    const total = trackTotal()
    if (height <= 0 || total <= height) return null
    const size = Math.max(1, Math.round((height * height) / total))
    // `top` counts visual rows and `total` counts lines. Left mixed, a wrapped
    // file drives the thumb to the bottom while the change marks — which are
    // per line — still sit halfway, so the two disagree about the same place.
    return { height, total, size, span: height - size, top: lineAtRow(viewTop()) }
  })

  /**
   * One entry per visible row: true where the thumb sits. Empty when the file
   * fits, so a short file shows no track at all.
   */
  const scrollbar = createMemo(() => {
    const m = scrollMetrics()
    if (!m) return []
    const at = Math.min(m.span, Math.round((m.top / (m.total - m.height)) * m.span))
    return Array.from({ length: m.height }, (_, row) => row >= at && row < at + m.size)
  })

  let track: { y: number } | undefined
  /** True between grabbing the scrollbar thumb and letting go. */
  const [dragging, setDragging] = createSignal(false)

  /** The pane's row box, the coordinate space the inline notes position in. */
  let host: { x: number; y: number; width: number } | undefined
  /** Bumped when the buffer re-wraps, so the inline notes re-measure. */
  const [wrapKey, setWrapKey] = createSignal(0)

  /**
   * The worst problem's message, drawn after the end of its line — the gutter
   * dot says where, this says what, without a trip to the problems list.
   * Positions come from `lineInfo`: the note sits on the line's *last* visual
   * row (wrapping), after the columns that row actually uses.
   */
  const inlineNotes = createMemo(() => {
    wrapKey()
    void props.content
    const el = editorEl()
    if (!props.problemText || !el || !host || props.problems.size === 0) return []
    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources, widths } = lineLayout()
    const notes: { top: number; left: number; text: string; color: string }[] = []
    for (const [line, problem] of props.problems) {
      // First visual row of the line, then walk to its last wrap row.
      const first = rowAtLine(line)
      if (sources[first] !== line) continue
      let lastRow = first
      while (sources[lastRow + 1] === line) lastRow++
      if (lastRow < top || lastRow >= top + height) continue

      const left = el.x - host.x + 1 + (widths[lastRow] ?? 0) + 2
      const room = host.width - left - 2
      if (room < 8) continue
      const text = cut(problem.message.replaceAll(/\s+/g, ' '), room)
      notes.push({
        top: el.y - host.y + (lastRow - top),
        left,
        text,
        color: PROBLEM_NOTE_COLORS[problem.severity](),
      })
    }
    return notes
  })

  // ── Completion ────────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpenRaw] = createSignal(false)
  const [menuItems, setMenuItems] = createSignal<CompletionItem[]>([])
  const [menuPrefix, setMenuPrefix] = createSignal('')
  const [menuSelected, setMenuSelected] = createSignal(0)
  /** Anchor of the word being completed: absolute visual row, visual column. */
  const [menuPos, setMenuPos] = createSignal({ row: 0, col: 0 })
  /** Logical position of the word start — what the prefix is measured from. */
  let menuAnchor = { line: 0, col: 0 }
  /** The server wants a fresh request as the prefix grows, not a local filter. */
  let menuIncomplete = false
  /** Replies racing each other: only the newest request may touch the menu. */
  let completionGen = 0
  let completionTimer: ReturnType<typeof setTimeout> | null = null
  /** Printable char just typed, consumed by the cursor-sync tick that follows. */
  let typedChar: string | null = null

  const setMenuOpen = (open: boolean) => {
    if (menuOpen() === open) return
    setMenuOpenRaw(open)
    props.onCompletionMenu(open)
  }

  const closeMenu = () => {
    completionGen++
    if (completionTimer) clearTimeout(completionTimer)
    completionTimer = null
    setMenuOpen(false)
  }

  const matches = createMemo(() => filterCompletions(menuItems(), menuPrefix()))

  /** Text of logical line `row`, straight from the buffer. */
  const lineTextAt = (row: number): string => {
    const text = editor?.plainText ?? ''
    let start = 0
    for (let n = 0; n < row; n++) {
      const next = text.indexOf('\n', start)
      if (next < 0) return ''
      start = next + 1
    }
    const end = text.indexOf('\n', start)
    return end < 0 ? text.slice(start) : text.slice(start, end)
  }

  const anchorMenuAt = (prefixLength: number) => {
    if (!editor) return
    const at = editor.visualCursor
    setMenuPos({ row: at.visualRow, col: Math.max(0, at.visualCol - prefixLength) })
  }

  const requestCompletions = async (explicit: boolean) => {
    if (!props.complete || !editor) return
    const gen = ++completionGen
    const forPath = props.path
    const { row, col } = editor.logicalCursor
    const reply = await props.complete(row, col)
    if (!editor || gen !== completionGen || props.path !== forPath || props.blocked) return
    const now = editor.logicalCursor
    // The reply is aimed at the request position; a cursor that left the line,
    // or a `.`/`(` typed during the round trip, means it describes a scope the
    // cursor is no longer in — shown anyway, it puts globals in a member list.
    if (now.row !== row) return
    const lineText = lineTextAt(now.row)
    if (!extendsWord(lineText, col, now.col)) return
    if (!reply || reply.items.length === 0) {
      // An explicit ask deserves an answer, so the empty menu shows its
      // "No suggestions" row; an automatic one just stays out of the way.
      if (explicit) {
        menuAnchor = { line: now.row, col: now.col }
        menuIncomplete = false
        setMenuItems([])
        setMenuPrefix('')
        setMenuSelected(0)
        anchorMenuAt(0)
        setMenuOpen(true)
      } else closeMenu()
      return
    }
    const start = wordStart(lineText, now.col)
    menuAnchor = { line: now.row, col: start }
    menuIncomplete = reply.isIncomplete
    setMenuItems(reply.items)
    setMenuPrefix(lineText.slice(start, now.col))
    setMenuSelected(0)
    anchorMenuAt(now.col - start)
    setMenuOpen(true)
  }

  const scheduleAutoCompletion = () => {
    if (completionTimer) clearTimeout(completionTimer)
    completionTimer = setTimeout(() => {
      completionTimer = null
      if (editor && props.focused && !props.blocked) void requestCompletions(false)
    }, COMPLETION_DEBOUNCE_MS)
  }

  /**
   * Runs on the cursor-sync tick after every key: while the menu is open it
   * re-reads the prefix (typing filters, backspace widens, leaving the word
   * closes); while closed it decides whether the key that just landed should
   * open it. The tick runs after the buffer settled, so the prefix is never
   * read mid-edit.
   */
  const refreshMenu = () => {
    if (!editor) return
    const typed = typedChar
    typedChar = null
    if (menuOpen()) {
      if (menuItems().length === 0) return closeMenu() // the "No suggestions" notice reads once
      const { row, col } = editor.logicalCursor
      if (row !== menuAnchor.line || col < menuAnchor.col) return closeMenu()
      const prefix = lineTextAt(row).slice(menuAnchor.col, col)
      if (prefix.split('').some(char => !isWordChar(char))) {
        closeMenu()
        // A trigger character typed over the open menu starts the member ask,
        // as VS Code's widget does — closing alone would swallow the `.`.
        if (typed && TRIGGER_CHARS.has(typed)) scheduleAutoCompletion()
        return
      }
      if (prefix !== menuPrefix()) {
        setMenuPrefix(prefix)
        setMenuSelected(0)
        anchorMenuAt(prefix.length)
        if (menuIncomplete) void requestCompletions(false)
      }
      return
    }
    if (!typed || !props.complete || props.blocked || !props.focused) return
    if (props.vim && vimState.mode !== 'insert') return
    if (TRIGGER_CHARS.has(typed) || isWordChar(typed)) scheduleAutoCompletion()
  }

  /** Where the popup goes: under the cursor's row, above when the file ends near
   * the bottom, clamped into the pane — with the label column sitting exactly
   * over the word it is completing. */
  const menuBox = createMemo(() => {
    if (!menuOpen() || !editor || !host) return null
    const list = matches()
    const rowsShown =
      list.length === 0 ? 1 : Math.min(list.length, MENU_ROWS) + (list.length > MENU_ROWS ? 1 : 0)
    const height = rowsShown + 2
    const paneHeight = viewHeight() || editor.height
    const screenRow = menuPos().row - viewTop()
    const below = screenRow + 1
    const top = paneHeight - below >= height || screenRow < height ? below : screenRow - height
    const width = Math.min(menuWidth(list), Math.max(MENU_ROWS, host.width - 2))
    // Label column = border + selection bar + glyph pair, hence the 4.
    const anchorX = editor.x - host.x + 1 + menuPos().col
    const left = Math.max(0, Math.min(anchorX - 4, host.width - width))
    return { top: editor.y - host.y + top, left, width }
  })

  const gutterWidth = () => String(lineCount()).length + 2

  createEffect(() => {
    const width = gutterWidth()
    if (gutter?.gutter) gutter.gutter._minWidth = width
  })

  // Line signs are a method, not a settable prop, so Solid cannot bind them.
  const applyLineSigns = () => {
    // The colors are read here because `ui` is a store: a table built at module
    // scope would hold the first theme's palette forever.
    const signColor: Record<LineChange, string> = {
      added: ui.gitAdded,
      modified: ui.gitModified,
      deleted: ui.gitDeleted,
    }
    const signs = new Map<number, { before?: string; beforeColor?: string }>()
    for (const [line, change] of props.gitLines) {
      signs.set(line, { before: SIGN_GLYPH[change], beforeColor: signColor[change] })
    }
    // After the git marks, so a line holding both shows the problem: the mark
    // says "you touched this", the problem says "and it is broken".
    for (const [line, problem] of props.problems) {
      signs.set(line, { before: '●', beforeColor: PROBLEM_COLORS[problem.severity]() })
    }
    // The sign column only widens the gutter while a sign exists, so the first
    // mark or diagnostic used to shift the whole file one column right — and
    // back again when it cleared. A blank sign keeps the column reserved.
    if (signs.size === 0) signs.set(0, { before: ' ' })
    gutter?.setLineSigns?.(signs)
  }
  createEffect(applyLineSigns)

  const syncViewport = () => {
    if (!editor) return
    setViewTop(editor.scrollY)
    setViewHeight(editor.height)
    setViewTotal(editor.lineCount)
  }

  /**
   * Vertical caret moves emit no cursor-change event at all, and the position is
   * only settled once the key has been handled — so the readout is refreshed a
   * tick after every key rather than from the event payload.
   */
  const syncCursor = () => {
    if (!editor) return
    // Height is still zero while the first frame lays out, so the scrollbar has
    // to be measured again once the editor is on screen.
    syncViewport()
    const at = editor.visualCursor
    if (!at) return
    if (at.logicalRow === cursor.line && at.logicalCol === cursor.col) return
    cursor.line = at.logicalRow
    cursor.col = at.logicalCol
    setCursorLine(at.visualRow)
    props.onCursor({ ...cursor })
  }

  /**
   * Segment the lines about to be painted, once each. The parse covers the whole
   * file, but turning captures into segments walks every character it is given —
   * doing that for the document on each keystroke costs more than the parse.
   */
  const ensureSegments = (from: number, to: number) => {
    if (!parsed) return
    for (let line = from; line <= to; line++) {
      // A line a previous window already did — jump away, jump back — must not be
      // segmented twice, or it collects a second copy of its segments and gets
      // highlighted twice. Recorded even when it had no captures at all.
      if (segmented.has(line)) continue
      segmented.add(line)
      for (const segment of segmentsIn(parsed, line, line)) {
        const list = byLine.get(segment.line)
        if (list) list.push(segment)
        else byLine.set(segment.line, [segment])
      }
    }
  }

  /**
   * Text of logical line `line` as the parse holds it — what a segment's columns
   * index. Null until a file's first parse lands, which is the only state in
   * which a line can be marked without having been segmented.
   */
  const parsedLine = (line: number): string | null => {
    const doc = parsed
    const at = doc?.starts[line]
    if (!doc || at === undefined) return null
    const next = doc.starts[line + 1]
    return next === undefined ? doc.content.slice(at) : doc.content.slice(at, next - 1)
  }

  /**
   * The spans, bucketed by the line they start on. `applyWindow` marks one line
   * at a time, so a flat scan meant every line of the window walked every
   * diagnostic in the file — a file with hundreds of them paid that on each
   * scroll tick.
   */
  const problemsByLine = createMemo(() => {
    const byStart = new Map<number, EditorPaneProps['problemRanges']>()
    for (const problem of props.problemRanges) {
      const list = byStart.get(problem.line)
      if (list) list.push(problem)
      else byStart.set(problem.line, [problem])
    }
    return byStart
  })

  /**
   * Mark the spans of every problem starting on `line`. Layered over the syntax
   * highlights: a fault keeps its text color and gains a faint severity tint,
   * while an Unnecessary-tagged span fades instead. A multi-line span marks its
   * first line only — the gutter dot marks the rest, and measuring every
   * continuation line costs more than it says.
   */
  const markProblems = (line: number) => {
    const problems = problemsByLine().get(line)
    if (!editor || !problems) return
    // Only now: without a parse this walks the buffer to find the line, and most
    // lines of a window carry no diagnostic at all.
    const text = parsedLine(line) ?? lineTextAt(line)
    for (const problem of problems) {
      const group = problem.unnecessary ? 'unnecessary' : problem.severity
      const styleId = styleIdForGroup(`druk.problem.${group}`)
      if (styleId == null) continue
      const sameLine = problem.endLine === problem.line
      // A zero-width or line-crossing span still marks something visible.
      const end = sameLine ? Math.max(problem.endCol, problem.col + 1) : problem.col + 1
      editor.addHighlight(line, inCells({ start: problem.col, end, styleId, priority: 100 }, text))
    }
  }

  /** Keep the viewport (plus overscan) highlighted, touching only what changed. */
  const applyWindow = (force = false) => {
    if (!editor) return
    syncViewport()
    if (force) {
      editor.clearAllHighlights()
      appliedLines.clear()
    }
    const { from, to } = logicalWindow(editor.scrollY, editor.height, wrapMap(), OVERSCAN)

    for (const line of appliedLines) {
      if (line < from || line > to) {
        editor.clearLineHighlights(line)
        appliedLines.delete(line)
      }
    }
    ensureSegments(from, to)
    for (let line = from; line <= to; line++) {
      if (appliedLines.has(line)) continue
      appliedLines.add(line)
      const segments = byLine.get(line)
      if (segments) {
        const text = parsedLine(line) ?? ''
        for (const segment of segments) editor.addHighlight(line, inCells(segment, text))
      }
      markProblems(line)
    }
  }

  /**
   * Scroll so line `wanted` is at the top (the buffer scrolls in visual rows).
   *
   * `scrollY` is read-only, and moving the caret would be wrong — dragging a
   * scrollbar must not retarget the cursor. So the move is delivered as the one
   * scroll input the buffer already accepts: a wheel event, whose delta is in rows.
   * The coordinates have to land inside the textarea or `ignoreScrollOutsideBounds`
   * drops it.
   */
  const scrollTo = (wanted: number) => {
    if (!editor) return
    const delta = rowAtLine(Math.round(wanted)) - editor.scrollY
    if (delta === 0) return
    const host = editor as unknown as { onMouseEvent: (event: unknown) => void }
    host.onMouseEvent({
      type: 'scroll',
      x: editor.x + 1,
      y: editor.y + 1,
      scroll: { direction: delta > 0 ? 'down' : 'up', delta: Math.abs(delta) },
    })
    syncViewport()
    applyWindow()
  }

  const dragTo = (screenY: number) => {
    const m = scrollMetrics()
    if (!m || !track) return
    const within = Math.max(0, Math.min(m.span, screenY - track.y - Math.floor(m.size / 2)))
    // Across lines, matching the thumb: `m.height` counts rows, and a wrapped
    // file shows far fewer lines than that, so subtracting it here would stop
    // the drag short of the end of the file.
    scrollTo(m.span === 0 ? 0 : (within / m.span) * Math.max(0, m.total - 1))
  }

  /**
   * One pass per burst of events, on the next macrotask — which is when the frame
   * is painted anyway. A wheel notch is several scroll events and a trackpad
   * flick is dozens, and each one would otherwise walk the applied lines, clear
   * what left the window and highlight what entered, work whose result only the
   * last event's position survives.
   */
  let cursorSync: ReturnType<typeof setTimeout> | null = null
  const scheduleCursorSync = () => {
    if (cursorSync) return
    cursorSync = setTimeout(() => {
      cursorSync = null
      // ↑/↓ emit no cursor-change event, so this tick is also the only chance to
      // move the highlight window with a scroll they caused. Without it the
      // window stays wherever the file opened and deep lines render unstyled.
      applyWindow()
      syncCursor()
      refreshMenu()
    }, 0)
  }

  /**
   * Move the caret a page up or down, with the viewport following it.
   *
   * One row of overlap, as every pager keeps: the line the eye stopped on is
   * still on screen after the jump. Viewport first, caret second — the buffer
   * scrolls a moved caret into view by the smallest amount that shows it, so
   * setting the caret first turned a page jump into a one-row nudge, while
   * moving it after this scroll finds it already on screen and scrolls nothing.
   */
  const movePage = (direction: -1 | 1) => {
    if (!editor) return
    closeMenu()
    const rows = Math.max(1, editor.height - 1)
    const { row, col } = editor.logicalCursor
    const target = Math.max(0, Math.min(editor.lineCount - 1, row + direction * rows))
    scrollTo(lineAtRow(editor.scrollY + direction * rows))
    editor.setCursor(target, col)
    scheduleCursorSync()
  }

  const highlight = async (snapshot: string, forPath: string | null) => {
    const result = await computeHighlights(
      snapshot,
      props.filetype,
      props.tabSize,
      () => !editor || forPath !== props.path || editor.plainText !== snapshot,
    )
    if (result === STALE) return
    // Stale guard: only apply if this is still the same file AND the buffer text
    // is byte-for-byte what we highlighted — otherwise offsets would drift.
    if (!editor || forPath !== props.path || editor.plainText !== snapshot) return
    parsed = result
    byLine = new Map()
    segmented.clear()
    applyWindow(true)
  }

  /**
   * One parse at a time, with the newest text always winning.
   *
   * The worker is the whole cost of recolouring — measured on this machine at 17ms
   * for 200 lines, 71ms for 1 000 and 354ms for 5 000, against ~6ms of preparation
   * and well under 1ms of segmentation. It is far slower than anyone types, so
   * firing a parse per keystroke just queues work that is already stale when it
   * starts, and each one delays the parse that finally matters. Instead the pending
   * request collapses to a single flag: whatever the buffer says when the worker
   * comes free is what gets parsed.
   */
  const runHighlight = async (text: string) => {
    if (parsing) {
      queuedParse = true
      return
    }
    parsing = true
    try {
      await highlight(text, props.path)
    } finally {
      parsing = false
    }
    if (!queuedParse) return
    queuedParse = false
    if (editor) void runHighlight(editor.plainText)
  }

  /** The text changed: drop the stale segments before re-highlighting the new text. */
  const rehighlight = (text: string) => {
    // Every caller replaced the text wholesale — a file switch, undo, an outside
    // edit — and the word the menu was completing is gone with it.
    closeMenu()
    forgetLayout()
    parsed = null
    byLine = new Map()
    segmented.clear()
    void runHighlight(text)
  }

  /** The row an absolute character offset falls on. */
  const rowOfOffset = (text: string, offset: number) => {
    let row = 0
    for (let at = text.indexOf('\n'); at >= 0 && at < offset; at = text.indexOf('\n', at + 1)) row++
    return row
  }

  /** Rows a line edit applies to: the selection's span, else the cursor's line. */
  const editRange = (text: string) => {
    const selection = editor?.getSelection()
    if (!selection || selection.start === selection.end) {
      const row = editor!.logicalCursor.row
      return { from: row, to: row }
    }
    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    // `end` is exclusive: a selection stopping at column 0 does not take that line.
    return { from: rowOfOffset(text, start), to: rowOfOffset(text, Math.max(start, end - 1)) }
  }

  /** Replace the text as one undoable step and land the caret on `row`, `col`. */
  const applyLineEdit = (content: string, row: number, col: number) => {
    if (!editor) return
    editor.setText(content)
    editor.setCursor(row, col)
    props.onChange(content)
    rehighlight(content)
    scheduleCursorSync()
  }

  const acceptCompletion = async () => {
    const match = matches()[menuSelected()]
    if (!match || !editor) return closeMenu()
    // Captured before the await: a new menu opened during the resolve wait
    // would re-aim `menuAnchor` at a different word.
    const anchorCol = menuAnchor.col
    const acceptedRow = editor.logicalCursor.row
    closeMenu()

    let item = match.item
    // Most servers withhold auto-import edits from the list and compute them
    // only for the item actually chosen — ask, briefly, before inserting.
    if (item.additionalTextEdits === undefined && props.resolveCompletion) {
      const resolved = await Promise.race([
        props.resolveCompletion(item),
        new Promise<null>(done => setTimeout(() => done(null), RESOLVE_TIMEOUT_MS)),
      ])
      if (resolved?.additionalTextEdits?.length) {
        item = { ...item, additionalTextEdits: resolved.additionalTextEdits }
      }
    }

    if (!editor || props.blocked) return
    const { row, col } = editor.logicalCursor
    // A cursor that left the line during the wait means the user moved on;
    // dropping the completion beats inserting it where they are not.
    if (row !== acceptedRow) return
    const applied = applyCompletion(
      editor.plainText,
      { line: row, character: col },
      anchorCol,
      item,
    )
    applyLineEdit(applied.content, applied.cursor.line, applied.cursor.character)
  }

  const toggleCommentLines = () => {
    if (!editor) return
    const prefix = commentPrefix(props.filetype)
    if (!prefix) return
    const text = editor.plainText
    const { from, to } = editRange(text)
    const next = toggleComment(text, from, to, prefix)
    const { row, col } = editor.logicalCursor
    if (next !== text) applyLineEdit(next, row, col)
  }

  const moveSelectedLines = (delta: -1 | 1) => {
    if (!editor) return
    const text = editor.plainText
    const { from, to } = editRange(text)
    const { row, col } = editor.logicalCursor
    const next = moveLines(text, from, to, delta)
    if (next !== null) applyLineEdit(next, row + delta, col)
  }

  /** Duplicate below; the caret follows onto the copy only when asked downward. */
  const duplicateSelectedLines = (follow: boolean) => {
    if (!editor) return
    const text = editor.plainText
    const { from, to } = editRange(text)
    const { row, col } = editor.logicalCursor
    applyLineEdit(duplicateLines(text, from, to), follow ? row + (to - from + 1) : row, col)
  }

  const stepHistory = (kind: 'undo' | 'redo') => {
    if (!editor) return
    const at = kind === 'undo' ? history.undo() : history.redo()
    if (!at) return
    // setText resets the buffer's own history, which is fine — `history` is the
    // one being stepped, and its entries are whole edit bursts.
    editor.setText(at.content)
    editor.cursorOffset = Math.min(at.cursor, at.content.length)
    props.onChange(at.content)
    rehighlight(at.content)
    scheduleCursorSync()
  }

  createEffect(
    on(
      () => props.history?.key,
      () => {
        const request = props.history
        if (request) stepHistory(request.kind)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.lineOp?.key,
      () => {
        switch (props.lineOp?.op) {
          case 'comment':
            return toggleCommentLines()
          case 'up':
            return moveSelectedLines(-1)
          case 'down':
            return moveSelectedLines(1)
          case 'duplicate':
            return duplicateSelectedLines(true)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.completionRequest?.key,
      () => {
        if (!props.completionRequest || !editor || props.blocked) return
        if (props.vim && vimState.mode !== 'insert') return
        void requestCompletions(true)
      },
      { defer: true },
    ),
  )

  // A modal opening or focus leaving mid-menu: the popup must not linger over
  // a pane that no longer hears its keys.
  createEffect(() => {
    if (props.blocked || !props.focused) closeMenu()
  })

  const scheduleHighlight = () => {
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      if (editor) void runHighlight(editor.plainText)
    }, DEBOUNCE_MS)
  }

  /**
   * Git changes down the track, so the whole file's changes are visible and not
   * only the part on screen. Cheap: one pass over the changed lines, no reading
   * of the text at all.
   */
  const changeTrack = createMemo(() => {
    const height = trackHeight()
    if (height <= 0) return []
    return changeRows(props.gitLines, trackTotal(), height)
  })

  /** The same idea for diagnostics: the whole file's errors, in their own column. */
  const problemTrack = createMemo(() => {
    const height = trackHeight()
    if (height <= 0) return []
    return problemRows(props.problems, trackTotal(), height)
  })

  /** Click the track to jump there, the way dragging the thumb does. */
  const jumpToRow = (row: number) => {
    const m = scrollMetrics()
    if (!m || !editor) return
    const line = Math.round((row / Math.max(1, m.height - 1)) * (m.total - 1))
    scrollTo(Math.max(0, line - Math.floor(editor.height / 2)))
  }

  /**
   * Closing the last tab swaps the textarea for the fallback and destroys the
   * native buffer while `editor` still points at it. Both pending timers touch
   * it, so they have to die with the renderable, not with the whole pane.
   */
  const releaseEditor = () => {
    closeMenu()
    editor = undefined
    setEditorEl(null)
    if (highlightTimer) clearTimeout(highlightTimer)
    if (cursorSync) clearTimeout(cursorSync)
    highlightTimer = null
    cursorSync = null
  }

  onCleanup(releaseEditor)

  // Clipboard and typing helpers, ahead of the textarea's own handling.
  useKeys((key: KeyEvent) => {
    // preventDefault only stops the textarea, not sibling global handlers, so a
    // key already claimed elsewhere (the tree's Enter) must be ignored here too.
    if (key.defaultPrevented) return
    if (props.blocked || !editor || !props.focused) return
    scheduleCursorSync()
    cursorBeforeEdit = editor.cursorOffset

    // Remember a printable keystroke for the sync tick that follows: whether it
    // should open the completion menu is decided there, once the buffer settled.
    const sequence = key.sequence
    typedChar =
      !key.ctrl && !key.meta && sequence?.length === 1 && sequence >= ' ' && sequence !== '\u007F'
        ? sequence
        : null

    // The menu owns its keys while it is up. Everything else falls through, so
    // typing keeps filtering and cursor keys it does not claim close it instead.
    if (menuOpen()) {
      const k = key.name
      if (k === 'down' || k === 'up') {
        key.preventDefault()
        const total = Math.max(1, matches().length)
        setMenuSelected(s => (s + (k === 'down' ? 1 : total - 1)) % total)
        return
      }
      if ((k === 'tab' && !key.shift) || k === 'return' || k === 'enter') {
        if (matches().length > 0) {
          key.preventDefault()
          void acceptCompletion()
          return
        }
        closeMenu() // "No suggestions" — let the key type through
      }
      if (k === 'escape') {
        key.preventDefault()
        closeMenu()
        return
      }
      if (
        k === 'left' ||
        k === 'right' ||
        k === 'home' ||
        k === 'end' ||
        k === 'pageup' ||
        k === 'pagedown'
      ) {
        closeMenu()
      }
    }

    // Ctrl+Space asks outright. Most terminals send it as a bare NUL byte, and
    // some parsers surface that with no ctrl flag at all — hence both spellings.
    if ((key.ctrl && key.name === 'space') || sequence === '\u0000') {
      key.preventDefault()
      if (props.complete && (!props.vim || vimState.mode === 'insert')) {
        void requestCompletions(true)
      }
      return
    }

    // The textarea reads Ctrl+A as line-start, the readline habit; claim it first
    // so it means select-all, as it does in every GUI editor.
    if (key.ctrl && key.name === 'a') {
      key.preventDefault()
      editor.selectAll()
      applyWindow(true)
      return
    }

    // Typing over a selection has to replace it. The buffer inserts at the caret
    // and leaves the selected text in place, so the delete is done here — for a
    // Ctrl+A selection and an ordinary mouse drag alike. Not in vim's command
    // modes, where a visual selection is live and d/y/c are commands, not text.
    if (editor.hasSelection() && (!props.vim || vimState.mode === 'insert')) {
      const typed = key.sequence
      // Backspace and friends arrive as a one-character sequence too, so the
      // check is on the character being printable, not on its length.
      const printable =
        typed?.length === 1 && typed >= ' ' && typed !== '\u007F' && !key.ctrl && !key.meta
      if (key.name === 'backspace' || key.name === 'delete' || printable) {
        key.preventDefault()
        editor.deleteSelection()
        if (printable) editor.insertText(typed!)
        props.onChange(editor.plainText)
        scheduleHighlight()
        applyWindow(true)
        return
      }
    }

    // Ctrl+Shift+Z is not encodable in every terminal, so Ctrl+Y redoes too.
    if (key.ctrl && key.name === 'z') {
      key.preventDefault()
      stepHistory(key.shift ? 'redo' : 'undo')
      return
    }
    if (key.ctrl && key.name === 'y') {
      key.preventDefault()
      stepHistory('redo')
      return
    }

    if (key.ctrl && (key.name === 'c' || key.name === 'x')) {
      key.preventDefault()
      const selected = editor.getSelectedText()
      if (!selected) {
        // Nothing to copy, so Ctrl+C is the quit key. Swallowed either way — the
        // renderer no longer exits on it, and letting it through would type a
        // control character.
        if (key.name === 'c') props.onQuit()
        return
      }
      copyToClipboard(selected)
      // OSC52 as well: the subprocess route reaches this machine's clipboard,
      // the escape sequence reaches the one the terminal is really on over SSH.
      renderer.copyToClipboardOSC52(selected)
      if (key.name === 'x') {
        editor.deleteSelection()
        applyWindow(true)
      }
      return
    }

    if (key.ctrl && key.name === 'v') {
      key.preventDefault()
      const text = readClipboard()
      if (text === null) return
      editor.deleteSelection()
      editor.insertText(text)
      return
    }

    // Ctrl+/ arrives as Ctrl+_ (0x1F) in most terminals, as '/' under the kitty
    // protocol, and in some (Terminal.app) not at all — hence Ctrl+L as well.
    if (key.ctrl && (key.name === '_' || key.name === '/' || key.name === 'l')) {
      key.preventDefault()
      toggleCommentLines()
      return
    }

    // Opt+↑/↓ moves the line or selection; with Shift it duplicates instead.
    if ((key.option || key.meta) && !key.ctrl && (key.name === 'up' || key.name === 'down')) {
      key.preventDefault()
      if (key.shift) duplicateSelectedLines(key.name === 'down')
      else moveSelectedLines(key.name === 'up' ? -1 : 1)
      return
    }

    // MacBook keyboards have no page keys at all, so Ctrl+U / Ctrl+D carry the
    // same move — the pager spelling vim and less use. Claimed from the textarea,
    // which reads the pair as delete-to-line-start and delete-forward — the
    // Delete key is the spelling of the latter that survives. In vim's command
    // modes the pair is vim's own half-screen move, and taking it here would
    // leave the editor with two different answers to the same key.
    const pagerChord = key.ctrl && !(props.vim && vimState.mode !== 'insert')
    const paged =
      key.name === 'pageup' || (pagerChord && key.name === 'u')
        ? -1
        : key.name === 'pagedown' || (pagerChord && key.name === 'd')
          ? 1
          : 0
    if (paged !== 0) {
      key.preventDefault()
      movePage(paged)
      return
    }

    // Vim normal mode does its own thing with these keys.
    if (props.vim && vimState.mode !== 'insert') return
    if (handleTyping(editor, key, props.tabSize)) key.preventDefault()
  })

  useKeys((key: KeyEvent) => {
    if (key.defaultPrevented) return
    if (props.blocked || !props.vim || !editor || !props.focused) return
    const before = vimState.mode
    const stepped = { undo: () => stepHistory('undo'), redo: () => stepHistory('redo') }
    if (handleVimKey(editor, key, vimState, stepped)) key.preventDefault()
    if (vimState.mode !== before) {
      setVimMode(vimState.mode)
      props.onVimMode(vimState.mode)
    }
  })

  // Switching files reuses the same textarea — remounting it would delete the
  // gutter's target and OpenTUI throws (`Cannot remove target directly`).
  createEffect(
    on(
      () => props.path,
      () => {
        if (!editor) return
        scheduleCursorSync()
        if (editor.plainText !== props.content) editor.setText(props.content)
        editor.setCursor(0, 0)
        history.reset({ content: props.content, cursor: 0 })
        editor.syntaxStyle = getSyntaxStyle()
        rehighlight(props.content)
      },
    ),
  )

  createEffect(
    on(
      () => props.focused,
      focused => {
        if (focused) editor?.focus()
      },
    ),
  )

  // Every overlay mounts its own focused input, which takes renderer focus away.
  // Nothing hands it back when the overlay closes — `focused` never changed — so
  // without this the editor silently drops every key until focus is cycled.
  createEffect(
    on(
      () => props.blocked,
      blocked => {
        if (!blocked && props.focused) editor?.focus()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [props.vim, props.path],
      () => {
        Object.assign(vimState, initialVimState())
        setVimMode(vimState.mode)
        props.onVimMode(props.vim ? 'normal' : null)
      },
    ),
  )

  createEffect(
    on(
      // `paintedTheme`, not config: a live preview paints without writing the
      // setting, and the buffer's style ids have to follow that paint.
      () => [paintedTheme(), props.tabSize] as const,
      (curr, prev) => {
        if (!editor) return
        editor.syntaxStyle = getSyntaxStyle()
        // Style ids are per SyntaxStyle instance. Drop the segment cache and
        // repaint from the (theme-independent) parse — a full rehighlight is
        // wasted and races a preview that is already being cancelled, which is
        // what left the editor on the previewed colors after Esc.
        byLine = new Map()
        segmented.clear()
        if (parsed && prev && curr[1] === prev[1]) {
          applyWindow(true)
          return
        }
        void highlight(editor.plainText, props.path)
      },
      { defer: true },
    ),
  )

  // Diagnostics arrive after the window has painted its lines, and `appliedLines`
  // would skip them — a changed set forces the one full reapply that carries the
  // underlines in and out.
  createEffect(
    on(
      () => props.problemRanges,
      () => applyWindow(true),
      { defer: true },
    ),
  )

  // External change: the file was reloaded from disk. Keyed on reloadKey, never
  // on content, so typing is never interrupted.
  createEffect(
    on(
      () => props.reloadKey,
      () => {
        if (editor && props.content !== editor.plainText) {
          editor.setText(props.content)
          history.reset({ content: props.content, cursor: editor.cursorOffset })
          rehighlight(props.content)
        }
      },
      { defer: true },
    ),
  )

  // As above, but the edit stays undoable: setText fires the buffer's
  // content-changed event, whose handler records it — so no reset here.
  createEffect(
    on(
      () => props.edit?.key,
      () => {
        const edit = props.edit
        if (!edit || !editor || edit.content === editor.plainText) return
        const at = editor.cursorOffset
        editor.setText(edit.content)
        editor.cursorOffset = Math.min(at, edit.content.length)
        props.onChange(edit.content)
        rehighlight(edit.content)
        scheduleCursorSync()
      },
      { defer: true },
    ),
  )

  // Not deferred: `druk file.ts:42` sets the target before this effect first
  // runs, and a deferred effect would swallow exactly that initial value.
  createEffect(
    on(
      () => props.goto?.key,
      () => {
        const target = props.goto
        if (!target || !editor) return
        editor.setCursor(target.line, target.col)
        editor.focus()
      },
    ),
  )

  return (
    // A wrapper only so the refusal has something to sit on top of: it has to cover
    // the empty state as much as an open file.
    <box flexGrow={1} flexDirection="column" backgroundColor={ui.bg}>
      <Show when={props.notice}>
        {(refused: () => { name: string; reason: string }) => (
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            backgroundColor={ui.bg}
            zIndex={10}
          >
            <text
              fg={ui.text}
              bg={ui.bg}
              content={`${refused().name} cannot be shown`}
              attributes={TextAttributes.BOLD}
            />
            <text fg={ui.faint} bg={ui.bg} content="" />
            <text fg={ui.dim} bg={ui.bg} content={refused().reason} />
            <text fg={ui.faint} bg={ui.bg} content="" />
            <text fg={ui.faint} bg={ui.bg} content="Press any key to go back" />
          </box>
        )}
      </Show>
      <Show
        when={props.path != null}
        fallback={
          <Welcome rootName={props.rootName} branch={props.branch} version={props.version} />
        }
      >
        {/* Drag capture lives on the wrapper, not the tracks: the pointer leaves a
          one-cell target on the first stray pixel, and each drag event goes to
          whatever sits under it. Guarded on `dragging` so a plain text
          selection across the pane never scrolls. */}
        <box
          ref={(el: { x: number; y: number; width: number }) => {
            host = el
          }}
          flexGrow={1}
          flexDirection="row"
          backgroundColor={ui.bg}
          onMouseDown={() => props.onFocus()}
          onMouseDrag={(event: MouseEvent) => {
            if (dragging()) dragTo(event.y)
          }}
          onMouseDragEnd={() => setDragging(false)}
          onMouseUp={() => setDragging(false)}
        >
          <line_number
            ref={(el: unknown) => {
              gutter = el as GutterHost
            }}
            target={editorEl() ?? undefined}
            fg={ui.gutter}
            bg={ui.bg}
            minWidth={gutterWidth()}
            paddingRight={1}
            flexGrow={1}
            lineColors={
              // Both entries are backgrounds, not text colors — a bright value here
              // paints a solid block behind the line number.
              new Map([[cursorLine(), { gutter: ui.currentLine, content: ui.currentLine }]])
            }
          >
            <textarea
              ref={el => {
                editor = el
                setEditorEl(el)
                ignoreScrollOutsideBounds(el)
                // The gutter paints into a cached buffer and repaints only when
                // it is dirty or the scroll moved. A file switch reuses this
                // textarea (setText), and the rewrap lands after the git-signs
                // effect has already dirtied and repainted the gutter — so the
                // old file's wrap layout stays on screen. LineNumberRenderable
                // only dirties *itself* on this event; the cached child is the
                // one that has to hear it.
                el.on('line-info-change', () => {
                  gutter?.gutter?.requestRender?.()
                  // The rows moved, so the cached layout describes the buffer as
                  // it was before this edit or resize. This event is the buffer's
                  // own signal for it, and the only one that covers typing.
                  forgetLayout()
                  setWrapKey(key => key + 1)
                })
                afterResize(el, () => {
                  applyLineSigns()
                  syncViewport()
                  forgetLayout()
                  applyWindow(true)
                })
                allowSelectionOnlyInEditor(el)
                onCleanup(releaseEditor)
              }}
              initialValue={props.content}
              focused={props.focused}
              syntaxStyle={getSyntaxStyle()}
              backgroundColor={ui.bg}
              textColor={ui.text}
              focusedBackgroundColor={ui.bg}
              focusedTextColor={ui.text}
              cursorColor={ui.cursor}
              // Vim owns the caret while it is on: the shape is how normal and insert
              // are told apart, so the setting yields to it. Every input to the shape
              // is read here rather than some of them assigned when the mode changes —
              // this runs again whenever any of the three moves, so a `cursorStyle`
              // edit made while vim sits in insert mode would otherwise repaint the
              // caret block and leave it there until the next mode change.
              // `blinking: true` is OpenTUI's default, restated because this replaces
              // the whole option object rather than one field of it.
              cursorStyle={{
                style: props.vim ? (vimMode() === 'insert' ? 'line' : 'block') : props.cursorStyle,
                blinking: true,
              }}
              // Always wrapping: OpenTUI's textarea scrolls sideways only by
              // dragging the caret along, so unwrapped long lines have no way to be
              // read that does not move the cursor.
              wrapMode="word"
              // OpenTUI takes a glyph, not a width: the number it accepts is a code
              // point, so passing a tab size painted control characters into the first
              // cell of every tab. A terminal drops those, leaving whatever the cell
              // held before — stale text that changes as the file scrolls.
              // A filled block in the guide color is the only way to match the space
              // guides, which are a background tint: the indicator sets a foreground.
              tabIndicator="█"
              tabIndicatorColor={ui.indentGuide}
              flexGrow={1}
              paddingLeft={1}
              onContentChange={() => {
                if (!editor) return
                history.record({ content: editor.plainText, cursor: cursorBeforeEdit }, Date.now())
                props.onChange(editor.plainText)
                scheduleHighlight()
              }}
              onMouse={() => scheduleCursorSync()}
              onCursorChange={() => {
                applyWindow()
                syncCursor()
                // Mouse clicks land here without a key event, and the menu has
                // to notice the cursor leaving the word it was completing.
                scheduleCursorSync()
              }}
            />
          </line_number>
          <For each={inlineNotes()}>
            {note => (
              <text
                position="absolute"
                top={note.top}
                left={note.left}
                zIndex={5}
                fg={note.color}
                bg={ui.bg}
                content={note.text}
              />
            )}
          </For>
          <Show when={menuBox()}>
            {(at: () => { top: number; left: number; width: number }) => (
              <CompletionMenu
                matches={matches()}
                selected={menuSelected()}
                top={at().top}
                left={at().left}
                width={at().width}
              />
            )}
          </Show>
          {/* LSP problems, in a column of their own left of the git track. A dot
              rather than git's bar: side by side, one glyph in two palettes
              would read as one kind of mark, and the dot is what the gutter
              already uses for a diagnostic. */}
          <Show when={problemTrack().some(Boolean)}>
            <box
              width={1}
              flexShrink={0}
              backgroundColor={ui.bg}
              onMouseDown={(event: MouseEvent) => {
                if (!dragging()) jumpToRow(event.y - (editor?.y ?? 0))
              }}
            >
              {/* `Index`, not `For`, on all three tracks: the rows are a fixed
                  column of marks whose *values* change as the file scrolls, and
                  keyed reconciliation on a list of duplicate primitives tears
                  down and rebuilds text renderables on every wheel tick. Indexed,
                  each row is built once and only its content and colour move. */}
              <Index each={problemTrack()}>
                {severity => (
                  <text
                    fg={trackColor(PROBLEM_COLORS, severity())}
                    bg={ui.bg}
                    content={severity() ? '•' : ' '}
                  />
                )}
              </Index>
            </box>
          </Show>
          {/* Git changes for the whole file, beside the scrollbar rather than in
              it: the thumb says where you are, and a mark under it would be
              hidden exactly when you are reading that part of the file. */}
          <Show when={changeTrack().some(Boolean)}>
            <box
              width={1}
              flexShrink={0}
              backgroundColor={ui.bg}
              onMouseDown={(event: MouseEvent) => {
                if (!dragging()) jumpToRow(event.y - (editor?.y ?? 0))
              }}
            >
              <Index each={changeTrack()}>
                {change => (
                  <text
                    fg={trackColor(CHANGE_COLORS, change())}
                    bg={ui.bg}
                    content={change() ? '▎' : ' '}
                  />
                )}
              </Index>
            </box>
          </Show>
          <Show when={scrollbar().length > 0}>
            <box
              ref={(el: { y: number }) => {
                track = el
              }}
              width={1}
              flexShrink={0}
              backgroundColor={ui.bg}
              onMouseDown={(event: MouseEvent) => {
                setDragging(true)
                dragTo(event.y)
              }}
            >
              <Index each={scrollbar()}>
                {/* The trough is a space, not a glyph hidden by painting it in
                    the background color: with `transparent` on there is no
                    background color to hide it in. */}
                {filled => <text fg={ui.scrollbar} bg={ui.bg} content={filled() ? '█' : ' '} />}
              </Index>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
