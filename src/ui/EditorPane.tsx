import { TextAttributes } from '@opentui/core'
import type { KeyEvent, MouseEvent, PasteEvent, TextareaRenderable } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'

import { copyToClipboard, readClipboard } from '../core/clipboard'
import type { CursorStyle } from '../core/config'
import type { LineChange } from '../core/git'
import { secondary } from '../core/keybindings'
import { changeRows } from '../editor/changes'
import { inCells } from '../editor/columns'
import {
  foldableRegions,
  foldsFrom,
  foldView,
  innermostRegion,
  plainView,
  reconcileFolds,
  spacedView,
} from '../editor/folds'
import type { FoldOp, FoldRegion, FoldView } from '../editor/folds'
import { History } from '../editor/history'
import { duplicateLines, moveLines, removeLines, toggleComment } from '../editor/lines'
import { problemRows } from '../editor/problems'
import { handleTyping } from '../editor/typing'
import { handleVimKey, initialVimState } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { lineAt, logicalWindow } from '../editor/window'
import { lineRangeAt, wordRangeAt } from '../editor/words'
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
  itemInfo,
  TRIGGER_CHARS,
  wordStart,
} from '../lsp/completion'
import type { CompletionReply, ItemInfo } from '../lsp/completion'
import { headline } from '../lsp/protocol'
import type { CompletionItem, ProblemSeverity } from '../lsp/protocol'
import { paintedTheme, ui } from '../themes'
import { layoutMenu } from './completionLayout'
import { CompletionMenu } from './CompletionMenu'
import { useHover } from './hover'
import { chordFor } from './keys'
import { SEVERITY_COLOR } from './severity'
import { cut, wrapText } from './text'
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
  lineOp: { op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete'; key: number } | null
  /** A fold asked for from the palette or a chord; bumped `key` re-applies. */
  foldOp: { op: FoldOp; key: number } | null
  vim: boolean
  /** Caret shape, for as long as vim is off — see the `cursorStyle` config key. */
  cursorStyle: CursorStyle
  /** Soft-wrap long lines — see the `wrap` config key. */
  wrap: boolean
  /** Scroll on until the last line is the only one left — see `scrollPastEnd`. */
  scrollPastEnd: boolean
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
    deprecated: boolean
  }[]
  /** Also draw each problem's message after the end of its line. */
  problemText: boolean
  /**
   * Review remarks on lines of this file: the notes written here and the pull
   * request's comments. A gutter mark each, and the text after the line when
   * `reviewText` is on — the same two the diagnostics get, in their own colours,
   * because "somebody asked about this line" is not a diagnostic.
   */
  reviews: Map<number, { draft: boolean; label: string; text: string }>
  reviewText: boolean
  /**
   * The one remark to open in full, under the line it is about — the review
   * panel's cursor, so reading a comment is reading it in its code rather than
   * in a thirty-column row. Null whenever the panel is not up, which is what
   * keeps the card out of ordinary editing.
   *
   * `line` is the *file's*, as every line in these props is; the card finds its
   * own row, folds included. `replies` is the rest of the thread, in the order
   * it was said — a remark answered is read as the conversation it became.
   */
  reviewCard: {
    line: number
    draft: boolean
    heading: string
    body: string
    replies: { label: string; body: string }[]
  } | null
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
  /** The lines the selection spans, or null when there is none. */
  onSelection: (lines: { from: number; to: number } | null) => void
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
/**
 * How long the selection rests on an item before its documentation is asked
 * for. Holding ↓ walks a hundred rows; resolving each of them is a request per
 * keystroke for a panel nobody reads on the way past.
 */
const INFO_DEBOUNCE_MS = 120

const SIGN_GLYPH: Record<LineChange, string> = { added: '▎', modified: '▎', deleted: '▁' }

/** Read at paint time: `ui` is a store, so a table built at module scope freezes. */
const CHANGE_COLORS: Record<LineChange, () => string> = {
  added: () => ui.gitAdded,
  modified: () => ui.gitModified,
  deleted: () => ui.gitDeleted,
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

/**
 * Review marks: a filled lozenge for a note written here, a hollow one for a
 * comment that came from the forge. Deliberately neither the git glyph nor the
 * diagnostic dot — a line can carry all three, and what each says is different.
 */
const REVIEW_GLYPH = { draft: '◆', fetched: '◇' } as const
const reviewColor = (draft: boolean) => (draft ? ui.accent : ui.folder)
/** As the problem text is: pulled toward the background so it annotates rather than shouts. */
const reviewNoteColor = (draft: boolean) =>
  mixColors(ui.solidBg, draft ? ui.accent : ui.folder, 0.62)

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
function afterResize(el: TextareaRenderable, after: () => void) {
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

/**
 * OpenTUI's own, which it takes as a constructor option and exposes no setter
 * for — so a margin turned off for a scroll past the end has to be put back by
 * value. Rows the caret is kept away from the edge by, as a share of the pane.
 */
const SCROLL_MARGIN = 0.2

/**
 * Let the viewport go past the last line, until that line is the only one drawn
 * — VS Code's `editor.scrollBeyondLastLine`, which the `scrollPastEnd` key is.
 *
 * `handleScroll` stops with the last line at the *bottom*, so the end of a file
 * can only ever be read from the very edge of the terminal. Two things have to
 * give for the rows below it to be blank, and both are why this is a rewrite of
 * the handler rather than a clamp raised on it: the caret has to travel with the
 * viewport, since the renderer keeps it on screen and would otherwise pull the
 * view straight back to it; and the scroll margin has to go, since it is what
 * holds the caret — and so the last line — a fifth of a screen off the bottom.
 *
 * Everything druk scrolls with — the wheel, a scrollbar drag, `scrollByRows` —
 * comes through here, so this one hook covers them all. It answers with the
 * margin's keeper: the caret may leave the tail without scrolling, so the
 * viewport has to be watched for its way back rather than waited on here.
 */
export function allowScrollPastEnd(el: TextareaRenderable, active: () => boolean) {
  const view = el.editorView
  let margin = SCROLL_MARGIN
  /** True once the last line has been scrolled off the bottom of the pane. */
  const pastEnd = (offset: number, rows: number, height: number) =>
    offset > Math.max(0, rows - height)
  const setMargin = (wanted: number) => {
    if (margin === wanted) return
    margin = wanted
    view.setScrollMargin(wanted)
  }

  // `handleScroll` is protected, and this is a subclass's override without the
  // subclass — same as `ignoreScrollOutsideBounds` above.
  const host = el as unknown as { handleScroll: (event: ScrollEvent) => void }
  const handle = host.handleScroll.bind(host)
  host.handleScroll = (event: ScrollEvent) => {
    const scroll = event.scroll
    const vertical = scroll?.direction === 'up' || scroll?.direction === 'down'
    if (!active() || !scroll || !vertical) return handle(event)
    const port = view.getViewport()
    const rows = view.getTotalVirtualLineCount()
    // Only a file taller than the pane: a short one would slide away with no
    // scrollbar drawn to say where it went.
    const last = rows > port.height ? rows - 1 : 0
    const next =
      scroll.direction === 'down'
        ? Math.min(port.offsetY + scroll.delta, last)
        : Math.max(0, port.offsetY - scroll.delta)
    if (next === port.offsetY) return
    setMargin(pastEnd(next, rows, port.height) ? 0 : SCROLL_MARGIN)
    view.setViewport(port.offsetX, next, port.width, port.height, true)
    el.requestRender()
  }

  /** Put the margin back once the file fills the pane again. */
  return () => {
    if (margin === SCROLL_MARGIN) return
    const port = view.getViewport()
    if (pastEnd(port.offsetY, view.getTotalVirtualLineCount(), port.height)) return
    setMargin(SCROLL_MARGIN)
  }
}

interface ScrollEvent {
  scroll?: { direction: 'up' | 'down' | 'left' | 'right'; delta: number }
}

/** OpenTUI has no double-click event, so detect it from consecutive downs — same as FileTree. */
const DOUBLE_CLICK_MS = 400

/**
 * Expand the selection on a double-click (word) or triple-click (line). Runs after
 * the buffer has taken the click: the renderer places the caret in `startSelection`
 * before this hook sees the down, and `setSelection` clears that zero-width mouse
 * selection so the word/line range is what survives the mouse-up.
 */
export function selectOnMultiClick(el: TextareaRenderable, after: () => void) {
  let last = { x: -1, y: -1, at: 0, count: 0 }
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    handle(event)
    if (event.type !== 'down') return
    const now = Date.now()
    const same = event.x === last.x && event.y === last.y && now - last.at < DOUBLE_CLICK_MS
    const count = same ? last.count + 1 : 1
    last = { x: event.x, y: event.y, at: now, count }
    if (count < 2) return
    const text = el.plainText
    const at = el.cursorOffset
    const range = count >= 3 ? lineRangeAt(text, at) : wordRangeAt(text, at)
    if (range.start >= range.end) return
    el.setSelection(range.start, range.end)
    if (count >= 3) last.count = 0
    after()
  }
}

/** Keys that reach the buffer as an edit rather than as a move. */
const isEditingKey = (key: KeyEvent): boolean => {
  if (key.ctrl || key.meta) return key.name === 'v'
  const typed = key.sequence
  return (
    key.name === 'backspace' ||
    key.name === 'delete' ||
    key.name === 'return' ||
    key.name === 'enter' ||
    key.name === 'tab' ||
    (typed?.length === 1 && typed >= ' ' && typed !== '\u007F')
  )
}

/** What the gutter accepts per line — `after` is the column the fold marker rides in. */
interface LineSign {
  before?: string
  beforeColor?: string
  after?: string
  afterColor?: string
}

/** Vim's normal-mode commands that write, as opposed to the ones that move. */
const VIM_EDITS = new Set(['x', 'X', 'd', 'D', 'c', 'C', 's', 'S', 'p', 'P', 'o', 'O', 'J', 'r'])

export function EditorPane(props: EditorPaneProps) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  /** LineNumberRenderable takes `minWidth` in its constructor only, and Solid's
   * reconciler builds elements bare, so the width has to be poked in by hand. */
  interface GutterHost {
    gutter?: { _minWidth?: number; requestRender?: () => void }
    setLineSigns?: (signs: Map<number, LineSign>) => void
    /** Buffer line → the number drawn on it, which folding makes two things. */
    setLineNumbers?: (numbers: Map<number, number>) => void
    /** Rows to draw no number on at all — the blank gap a review card sits in. */
    setHideLineNumbers?: (rows: Set<number>) => void
  }
  let gutter: GutterHost | undefined
  let editor: TextareaRenderable | undefined
  /** `allowScrollPastEnd`'s keeper, run wherever the viewport is read back. */
  let keepScrollMargin: (() => void) | null = null
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
  /** Last selection span reported upward, so unchanged ones are not re-reported. */
  let reportedSelection: { from: number; to: number } | null = null
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
  /** The caret's *buffer* row, where `cursorLine` is the wrapped row it draws on. */
  const [cursorRow, setCursorRow] = createSignal(0)

  // ── Folding ───────────────────────────────────────────────────────────────
  /**
   * Null unless something is folded, and that is load-bearing: with no view the
   * buffer's text *is* the file and every line number means one thing, which is
   * what the rest of this component was written against. Only the folded case
   * pays for the translation.
   */
  /** The pane's row box, the coordinate space the inline notes position in. */
  let host: { x: number; y: number; width: number } | undefined

  const [baseFold, setFolded] = createSignal<FoldView | null>(null)

  /** Rows of body a card will show before it says how many it left. */
  const CARD_LINES = 8

  /**
   * The card's contents, and how many rows of buffer they need — everything
   * about it that does not depend on where the row ends up on screen.
   *
   * This is what opens the gap, so it has to be answerable before the view that
   * places it exists; `reviewCard` below only positions what this decides.
   *
   * Never while the editor holds the keyboard. The gap is rows the file does not
   * have, and the one rule that keeps them harmless is that they cannot be typed
   * into — so taking the keyboard closes the card rather than freezing it.
   */
  const cardGap = createMemo(() => {
    const card = props.reviewCard
    if (!card || !host || props.focused) return null
    // Two columns of border and one of padding either side.
    const room = host.width - 4
    if (room < 12) return null
    const flat = (text: string) => text.replaceAll(/\s+/g, ' ').trim()
    // The remark, then whatever was said back to it — each answer marked by its
    // own first line rather than by a blank row, which in an eight-row box is a
    // row of the conversation given up to punctuation.
    const wrapped: { text: string; dim: boolean }[] = wrapText(flat(card.body), room).map(text => ({
      text,
      dim: false,
    }))
    for (const said of card.replies) {
      const body = wrapText(`↳ ${said.label}: ${flat(said.body)}`, room)
      for (const text of body) wrapped.push({ text, dim: true })
    }
    const lines = wrapped.slice(0, CARD_LINES)
    if (wrapped.length > CARD_LINES) {
      lines[CARD_LINES - 1] = { text: `… ${wrapped.length - CARD_LINES + 1} more lines`, dim: true }
    }
    return {
      line: card.line,
      draft: card.draft,
      // Spaces of its own: the border draws straight up to the title otherwise.
      heading: cut(` ${REVIEW_GLYPH[card.draft ? 'draft' : 'fetched']} ${card.heading} `, room),
      lines: lines.map(line => ({ text: cut(line.text, room), dim: line.dim })),
      /** Borders included — the gap has to hold the whole box. */
      rows: lines.length + 2,
    }
  })

  /**
   * The view the buffer actually holds: whatever is folded, plus the blank gap a
   * review card is drawn in. Split from `baseFold` because the gap is not a
   * fold — it is not remembered per path, it is never reconciled back into the
   * file, and every fold command works on the folds alone.
   *
   * Everything that renders reads this, so the gap moves the git marks, the
   * diagnostics, the highlighting and the gutter with it for free.
   */
  const folded = createMemo<FoldView | null>(() => {
    const base = baseFold()
    const gap = cardGap()
    if (!gap) return base
    return spacedView(base ?? plainView(props.content), gap.line, gap.rows)
  })
  /** Collapsed regions per path — the pane outlives a tab switch, so folds do. */
  const foldsFor = new Map<string, FoldRegion[]>()
  /** True while a fold is rewriting the buffer, so its own change event is not an edit. */
  let refolding = false

  /** The file's text: the buffer's, with whatever is folded put back into it. */
  const docText = (): string => folded()?.source ?? editor?.plainText ?? ''

  /** The file's line a buffer line stands for. */
  const realLine = (row: number): number => folded()?.real[row] ?? row

  /**
   * The buffer line a file line is drawn on, or the anchor hiding it — every
   * caller wants somewhere to put a caret, not the -1 that says "not on screen".
   */
  const shownLine = (line: number): number => {
    const view = folded()
    if (!view) return line
    for (let at = Math.min(line, view.display.length - 1); at >= 0; at--) {
      const row = view.display[at]!
      if (row >= 0) return row
    }
    return 0
  }

  /** The last file line the buffer line `row` speaks for, folded block included. */
  const realSpanEnd = (row: number): number => {
    const view = folded()
    if (!view) return row
    const next = view.real[row + 1]
    return next === undefined ? view.starts.length - 1 : next - 1
  }

  /** The caret's offset into the file, which is where undo has to land. */
  const documentOffset = (): number => {
    if (!editor) return 0
    const view = folded()
    if (!view) return editor.cursorOffset
    const { row, col } = editor.logicalCursor
    return (view.starts[realLine(row)] ?? 0) + col
  }

  /** Marks and diagnostics come keyed by file line; the buffer is drawn by its own. */
  const toDisplay = <T,>(marks: Map<number, T>): Map<number, T> => {
    const view = folded()
    if (!view) return marks
    const mapped = new Map<number, T>()
    for (const [line, mark] of marks) {
      const row = view.display[line]
      if (row !== undefined && row >= 0) mapped.set(row, mark)
    }
    return mapped
  }

  const displayGitLines = createMemo(() => toDisplay(props.gitLines))
  const displayProblems = createMemo(() => toDisplay(props.problems))
  const displayReviews = createMemo(() => toDisplay(props.reviews))
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

  /**
   * Where each line of the file begins. Offsets rather than a split(): this
   * re-runs on every keystroke, and allocating a string per line to count them
   * — or to read the indent of the forty on screen — is the expensive way to
   * find '\n'. The line count and the fold markers are both read off it.
   */
  const contentStarts = createMemo(() => {
    const starts = [0]
    for (let at = props.content.indexOf('\n'); at >= 0; at = props.content.indexOf('\n', at + 1)) {
      starts.push(at + 1)
    }
    return starts
  })

  const lineCount = createMemo(() => contentStarts().length)

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
    // The topmost line the file can be scrolled to, which past-end scrolling
    // moves to the last one — without this the thumb reaches the bottom of the
    // track while there is still a screenful of scrolling left.
    const last = props.scrollPastEnd ? m.total - 1 : m.total - m.height
    const at = Math.min(m.span, Math.round((m.top / last) * m.span))
    return Array.from({ length: m.height }, (_, row) => row >= at && row < at + m.size)
  })

  let track: { y: number } | undefined
  /** True between grabbing the scrollbar thumb and letting go. */
  const [dragging, setDragging] = createSignal(false)
  const problemsHover = useHover()
  const changesHover = useHover()
  const scrollbarHover = useHover()
  /** The real line of the fold chevron under the pointer, or null. */
  const [hotFold, setHotFold] = createSignal<number | null>(null)

  /** Bumped when the buffer re-wraps, so the inline notes re-measure. */
  const [wrapKey, setWrapKey] = createSignal(0)

  /**
   * Where a note after buffer line `row` would go, or null when the line is off
   * screen or the pane has no room left for one. Positions come from
   * `lineInfo`: the note sits on the line's *last* visual row (wrapping), after
   * the columns that row actually uses.
   */
  const noteSlot = (row: number): { top: number; left: number; room: number } | null => {
    const el = editorEl()
    if (!el || !host) return null
    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources, widths } = lineLayout()
    const first = rowAtLine(row)
    if (sources[first] !== row) return null
    let lastRow = first
    while (sources[lastRow + 1] === row) lastRow++
    if (lastRow < top || lastRow >= top + height) return null

    const left = el.x - host.x + 1 + (widths[lastRow] ?? 0) + 2
    const room = host.width - left - 2
    if (room < 8) return null
    return { top: el.y - host.y + (lastRow - top), left, room }
  }

  /**
   * Where the card is drawn: over the blank rows `cardGap` opened under its
   * line, so it hides no code and the gutter's numbering carries on across it.
   */
  const reviewCard = createMemo(() => {
    wrapKey()
    void props.content
    const gap = cardGap()
    const view = folded()
    const el = editorEl()
    if (!gap || !view || !el || !host) return null
    const anchor = view.display[gap.line]
    if (anchor === undefined || anchor < 0) return null

    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources } = lineLayout()
    const first = rowAtLine(anchor)
    if (sources[first] !== anchor) return null
    let lastRow = first
    while (sources[lastRow + 1] === anchor) lastRow++
    if (lastRow + 1 < top || lastRow + 1 >= top + height) return null

    return {
      /** Buffer row of the line itself, as `displayReviews` keys its marks. */
      row: anchor,
      top: el.y - host.y + (lastRow + 1 - top),
      width: host.width,
      heading: gap.heading,
      lines: gap.lines,
      draft: gap.draft,
    }
  })

  /**
   * The worst problem's message, drawn after the end of its line — the gutter
   * dot says where, this says what, without a trip to the problems list.
   */
  const inlineNotes = createMemo(() => {
    wrapKey()
    void props.content
    // Both annotations share the geometry, so they are merged into one map of
    // buffer row → what to draw — the review marks first, so a diagnostic on the
    // same line wins it. Keyed by *row*: with a fold open, the file's line and
    // the line the buffer draws are two different numbers.
    const wanted = new Map<
      number,
      { text: string; color: string; more?: boolean; chord?: string }
    >()
    if (props.reviewText) {
      // The row the card is open on says the same thing twice otherwise — the
      // suffix is the short form of exactly what the box below it spells out.
      const opened = reviewCard()?.row
      // A remark too long for its row is read in the panel, which opens the card
      // under the line; the chord is the only way in that is not the sidebar.
      const panel = chordFor('view.review')
      for (const [row, mark] of displayReviews()) {
        if (row === opened) continue
        wanted.set(row, {
          text: `${mark.label}: ${mark.text}`,
          color: reviewNoteColor(mark.draft),
          chord: panel,
        })
      }
    }
    // The chord that reads the whole diagnostic, named after a note that could
    // not say all of it — on the cursor's row alone, since a column of the same
    // hint down the file is noise and the row being read is the one that needs
    // it. Nothing to advertise when the command has been unbound.
    const chord = chordFor('problems.detail')
    if (props.problemText) {
      for (const [row, problem] of displayProblems()) {
        // What broke, not how to fix it: the whole of it is a keystroke away,
        // and a row of a server's advice says nothing about this line.
        const said = headline(problem.message)
        wanted.set(row, {
          text: said.more ? `${said.text}…` : said.text,
          color: PROBLEM_NOTE_COLORS[problem.severity](),
          more: said.more,
          chord,
        })
      }
    }
    if (wanted.size === 0) return []
    const notes: { top: number; left: number; text: string; color: string }[] = []
    for (const [row, note] of wanted) {
      const slot = noteSlot(row)
      if (!slot) continue
      const flat = note.text.replaceAll(/\s+/g, ' ')
      // Cut by the terminal's width counts as well as cut by `headline`: a
      // message that says all of itself needs no key, and one the pane ran out
      // of columns for is exactly the case the chord exists for.
      const hint =
        note.chord &&
        row === cursorRow() &&
        (note.more || flat.length > slot.room) &&
        // A hint that leaves no room for the message is two truncations, not one.
        slot.room - note.chord.length > 12
          ? ` ${note.chord}`
          : ''
      const text = cut(flat, slot.room - hint.length)
      notes.push({ top: slot.top, left: slot.left, text, color: note.color })
      // Its own renderable rather than a suffix on that string: the hint is not
      // part of what the server said, and a shared colour would read as if it were.
      if (hint) {
        notes.push({
          top: slot.top,
          left: slot.left + text.length,
          text: hint,
          color: ui.faint,
        })
      }
    }
    return notes
  })

  /**
   * What a collapsed block says for itself. Without it a fold is only a jump in
   * the gutter's numbers, which reads as a rendering fault rather than as
   * something the editor was told to do.
   */
  const foldNotes = createMemo(() => {
    wrapKey()
    void props.content
    const view = folded()
    if (!view) return []
    // The `▸` in the gutter opens it with a click; the chord is what a keyboard
    // has, and only the row the caret is standing on says it — see the inline
    // diagnostic note for why the hint follows the caret rather than the marks.
    const chord = chordFor('editor.unfold')
    const notes: { top: number; left: number; text: string; hint?: boolean }[] = []
    for (const [line, count] of view.hidden) {
      const row = view.display[line]
      if (row === undefined || row < 0) continue
      const slot = noteSlot(row)
      if (!slot) continue
      const text = `⋯ ${count} line${count === 1 ? '' : 's'}`
      notes.push({ top: slot.top, left: slot.left, text: cut(text, slot.room) })
      if (chord && row === cursorRow() && slot.room - text.length > chord.length + 1) {
        notes.push({
          top: slot.top,
          left: slot.left + text.length,
          text: ` ${chord}`,
          hint: true,
        })
      }
    }
    return notes
  })

  /**
   * Whether the file has anything to fold at all — what decides the marker
   * column exists. Answered by the same local test the markers use, from the
   * top: a file with code in it says yes within a few lines, and only a wholly
   * flat one is walked to the end.
   */
  const anyFoldable = createMemo(() => {
    const starts = contentStarts()
    for (let line = 0; line < starts.length; line++) {
      if (foldsFrom(props.content, starts, line, props.tabSize)) return true
    }
    return false
  })

  /**
   * Where each chevron the gutter drew can be clicked. Nothing is painted here
   * — the glyph is a `lineSign` — so this is only a hit target, laid over the
   * column the gutter reserves for it.
   *
   * Guarded on the editor having a size: this is read from a ref rather than
   * from a signal, and before the first layout every coordinate is zero, which
   * would put the whole column two cells left of the pane.
   */
  const foldMarkers = createMemo(() => {
    wrapKey()
    const el = editorEl()
    if (!el || !host || el.width <= 0 || host.width <= 0) return []
    if (!anyFoldable()) return []
    const starts = contentStarts()
    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources } = lineLayout()
    const rows = sources.length > 0 ? sources.length : viewTotal()
    const markers: { top: number; left: number; line: number }[] = []
    let previous = top > 0 ? (sources[top - 1] ?? top - 1) : -1
    for (let row = top; row < top + height && row < rows; row++) {
      const buffer = sources.length > 0 ? (sources[row] ?? row) : row
      // Only the first visual row of a line: a wrapped line is one block, and a
      // target on each of its rows would answer for a row with no glyph on it.
      if (buffer === previous) continue
      previous = buffer
      const line = realLine(buffer)
      if (!foldsFrom(props.content, starts, line, props.tabSize)) continue
      markers.push({ top: el.y - host.y + (row - top), left: el.x - host.x - 2, line })
    }
    return markers
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

  /** Signature and documentation for the selected item; null until they arrive. */
  const [menuInfo, setMenuInfo] = createSignal<ItemInfo | null>(null)
  /** Items already resolved, so walking back up the list costs no round trip. */
  const resolvedItems = new WeakMap<CompletionItem, CompletionItem>()
  let infoTimer: ReturnType<typeof setTimeout> | null = null
  let infoGen = 0

  const setMenuOpen = (open: boolean) => {
    if (menuOpen() === open) return
    setMenuOpenRaw(open)
    props.onCompletionMenu(open)
  }

  const closeMenu = () => {
    completionGen++
    if (completionTimer) clearTimeout(completionTimer)
    completionTimer = null
    if (infoTimer) clearTimeout(infoTimer)
    infoTimer = null
    infoGen++
    setMenuInfo(null)
    setMenuOpen(false)
  }

  const matches = createMemo(() => filterCompletions(menuItems(), menuPrefix()))

  const askForInfo = async (item: CompletionItem, gen: number) => {
    const reply = await props.resolveCompletion?.(item)
    // A null reply is cached as the item itself: the server has answered, and
    // asking again every time the selection returns is pure traffic.
    const merged = reply ? { ...item, ...reply } : item
    resolvedItems.set(item, merged)
    if (gen === infoGen && menuOpen()) setMenuInfo(itemInfo(merged))
  }

  /**
   * Fill the detail panel for whatever is selected. Servers withhold docs from
   * the list — they are expensive per candidate — so the item under the
   * selection is resolved on its own, and what came with the list is shown
   * meanwhile rather than leaving the panel blank until the reply lands.
   */
  createEffect(
    on([menuOpen, menuSelected, matches], () => {
      if (infoTimer) clearTimeout(infoTimer)
      infoTimer = null
      const item = menuOpen() ? matches()[menuSelected()]?.item : undefined
      if (!item) {
        setMenuInfo(null)
        return
      }
      const known = resolvedItems.get(item)
      setMenuInfo(itemInfo(known ?? item))
      if (known || !props.resolveCompletion) return
      const gen = ++infoGen
      infoTimer = setTimeout(() => {
        infoTimer = null
        void askForInfo(item, gen)
      }, INFO_DEBOUNCE_MS)
    }),
  )

  onCleanup(() => {
    if (infoTimer) clearTimeout(infoTimer)
  })

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
    // The server holds the file, not the buffer: it has never been told that
    // anything is folded, so the ask is in the file's own line numbers.
    const reply = await props.complete(realLine(row), col)
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
    // The reply guard, applied before the ask as well: a `'` or `)` typed inside
    // the debounce carries the cursor out of the scope the trigger character
    // named, and the request would go out at the new one — the closing quote of
    // `from '@opentui/'` asked one column late answers with every identifier in
    // file scope instead of the paths under the slash.
    const from = editor?.logicalCursor
    const at = from ? { row: from.row, col: from.col } : null
    completionTimer = setTimeout(() => {
      completionTimer = null
      if (!editor || !props.focused || props.blocked) return
      const now = editor.logicalCursor
      if (at && (now.row !== at.row || !extendsWord(lineTextAt(now.row), at.col, now.col))) return
      void requestCompletions(false)
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

  /** Where the popup goes and how big it gets: under the cursor's row, above
   * when the file ends near the bottom, sized to whichever side has more room —
   * the detail panel is dropped before the list is — and clamped into the pane,
   * with the label column sitting exactly over the word it is completing. */
  const menuBox = createMemo(() => {
    if (!menuOpen() || !editor || !host) return null
    const paneHeight = viewHeight() || editor.height
    const screenRow = menuPos().row - viewTop()
    const below = screenRow + 1
    const layout = layoutMenu(
      matches(),
      menuInfo(),
      { width: host.width - 2, height: Math.max(3, Math.max(paneHeight - below, screenRow)) },
      props.resolveCompletion !== null,
    )
    const top =
      paneHeight - below >= layout.height || screenRow < layout.height
        ? below
        : screenRow - layout.height
    // Label column = border + selection bar + glyph pair, hence the 4.
    const anchorX = editor.x - host.x + 1 + menuPos().col
    const left = Math.max(0, Math.min(anchorX - 4, host.width - layout.width))
    return { top: editor.y - host.y + top, left, layout }
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
    const signs = new Map<number, LineSign>()
    for (const [line, change] of displayGitLines()) {
      signs.set(line, { before: SIGN_GLYPH[change], beforeColor: signColor[change] })
    }
    // After the git marks, so a line holding both shows the review remark: the
    // mark says "you touched this", the remark says "and somebody asked about it".
    for (const [row, mark] of displayReviews()) {
      signs.set(row, {
        before: mark.draft ? REVIEW_GLYPH.draft : REVIEW_GLYPH.fetched,
        beforeColor: reviewColor(mark.draft),
      })
    }
    // Last of the three: a broken line is worth more than a remark about it.
    for (const [line, problem] of displayProblems()) {
      signs.set(line, { before: '●', beforeColor: SEVERITY_COLOR[problem.severity]() })
    }
    // The sign column only widens the gutter while a sign exists, so the first
    // mark or diagnostic used to shift the whole file one column right — and
    // back again when it cleared. A blank sign keeps the column reserved.
    if (signs.size === 0) signs.set(0, { before: ' ' })
    // The fold markers are the gutter's own column rather than an overlay of
    // ours: it knows where the column is on a frame whose layout has not run
    // yet, and it repaints the cursor's row underneath them. Reserved for the
    // whole file, not just for the lines carrying a glyph — the column's width
    // is what the code sits to the right of, and one that came and went as the
    // viewport scrolled past the last block would shift every line sideways.
    if (anyFoldable()) {
      signs.set(0, { ...signs.get(0), after: signs.get(0)?.after ?? ' ' })
      const view = folded()
      const closed = new Set(view?.folds.map(fold => fold.start))
      const starts = contentStarts()
      for (let line = 0; line < starts.length; line++) {
        if (!foldsFrom(props.content, starts, line, props.tabSize)) continue
        const row = view ? (view.display[line] ?? -1) : line
        if (row < 0) continue
        const shut = closed.has(line)
        signs.set(row, {
          ...signs.get(row),
          after: shut ? '▸' : '▾',
          // The chevron under the pointer takes the accent — the open ones sit
          // in gutter colour and read as furniture until something says they act.
          afterColor: hotFold() === line ? ui.accent : shut ? ui.text : ui.gutter,
        })
      }
    }
    gutter?.setLineSigns?.(signs)
  }
  createEffect(applyLineSigns)

  /**
   * The gutter numbers a buffer line by its own index, which stops being the
   * file's line the moment anything is folded. Empty map while nothing is —
   * the override table costs an entry per visible line, and unfolded there is
   * nothing for it to say.
   */
  createEffect(() => {
    const view = folded()
    const numbers = new Map<number, number>()
    if (view) view.real.forEach((line, row) => numbers.set(row, line + 1))
    gutter?.setLineNumbers?.(numbers)
    // The gap's rows stand for no line, and `real` repeats the anchor on them —
    // without this they would each draw the anchor's number again.
    gutter?.setHideLineNumbers?.(new Set(view?.spacers ?? []))
  })

  /** The row an absolute character offset falls on. */
  const rowOfOffset = (text: string, offset: number) => {
    let row = 0
    for (let at = text.indexOf('\n'); at >= 0 && at < offset; at = text.indexOf('\n', at + 1)) row++
    return row
  }

  /**
   * Rows a line edit applies to: the selection's span, else the cursor's line.
   * Also what a review note attaches to — above `syncCursor` for that reason,
   * which is the only caller that runs before the line edits are wired up.
   */
  const editRange = (text: string) => {
    const span = editor?.getSelection()
    if (!span || span.start === span.end) {
      const row = editor!.logicalCursor.row
      return { from: row, to: row }
    }
    const start = Math.min(span.start, span.end)
    const end = Math.max(span.start, span.end)
    // `end` is exclusive: a selection stopping at column 0 does not take that line.
    return { from: rowOfOffset(text, start), to: rowOfOffset(text, Math.max(start, end - 1)) }
  }

  const syncViewport = () => {
    if (!editor) return
    keepScrollMargin?.()
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
    // Ahead of the unchanged-position return below: Shift+↑ from the last line of
    // a file grows the selection without moving the caret off it, and a review
    // note taken then would be about one line instead of the block on screen.
    // Gated on `hasSelection` because the offset→row walk is per keystroke.
    // In the file's own lines, as the cursor below is: a note taken over a
    // selection while a fold is open is about the lines someone would go to,
    // not the rows the fold happened to leave them on.
    const rows = editor.hasSelection() ? editRange(editor.plainText) : null
    const span = rows ? { from: realLine(rows.from), to: realLine(rows.to) } : null
    if (span?.from !== reportedSelection?.from || span?.to !== reportedSelection?.to) {
      reportedSelection = span
      props.onSelection(span)
    }
    const at = editor.visualCursor
    if (!at) return
    if (at.logicalRow === cursor.line && at.logicalCol === cursor.col) return
    cursor.line = at.logicalRow
    cursor.col = at.logicalCol
    setCursorLine(at.visualRow)
    setCursorRow(at.logicalRow)
    // Reported in the file's own lines: the status bar, the language server and
    // the visit history all mean the line someone would go to, not the row a
    // fold happens to have left it on.
    props.onCursor({ line: realLine(cursor.line), col: cursor.col })
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
   * while an Unnecessary-tagged span fades and a Deprecated one is struck
   * through. A multi-line span marks its first line only — the gutter dot marks
   * the rest, and measuring every continuation line costs more than it says.
   */
  const markProblems = (row: number, line: number) => {
    const problems = problemsByLine().get(line)
    if (!editor || !problems) return
    // Only now: without a parse this walks the buffer to find the line, and most
    // lines of a window carry no diagnostic at all.
    const text = parsedLine(line) ?? lineTextAt(row)
    for (const problem of problems) {
      const group = problem.unnecessary
        ? 'unnecessary'
        : problem.deprecated
          ? 'deprecated'
          : problem.severity
      const styleId = styleIdForGroup(`druk.problem.${group}`)
      if (styleId == null) continue
      const sameLine = problem.endLine === problem.line
      // A zero-width or line-crossing span still marks something visible.
      const end = sameLine ? Math.max(problem.endCol, problem.col + 1) : problem.col + 1
      editor.addHighlight(row, inCells({ start: problem.col, end, styleId, priority: 100 }, text))
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
    // The window is in buffer rows and everything it paints is keyed by the
    // file's lines, which folding makes two different numbers.
    for (let row = from; row <= to; row++) {
      if (appliedLines.has(row)) continue
      appliedLines.add(row)
      const line = realLine(row)
      ensureSegments(line, line)
      const segments = byLine.get(line)
      if (segments) {
        const text = parsedLine(line) ?? ''
        for (const segment of segments) editor.addHighlight(row, inCells(segment, text))
      }
      markProblems(row, line)
    }
  }

  /**
   * Scroll the viewport by `delta` visual rows. The buffer's own `handleScroll`
   * is used rather than a synthetic wheel event — those are dropped by
   * `ignoreScrollOutsideBounds` when the textarea's screen bounds are not ready,
   * which is exactly when a programmatic jump runs.
   */
  const scrollByRows = (delta: number) => {
    if (!editor || delta === 0) return
    const host = editor as unknown as {
      handleScroll: (event: { scroll: { direction: 'up' | 'down'; delta: number } }) => void
    }
    host.handleScroll({
      scroll: { direction: delta > 0 ? 'down' : 'up', delta: Math.abs(delta) },
    })
    syncViewport()
    applyWindow()
  }

  /**
   * Scroll so visual row `row` is the top one.
   *
   * `scrollY` is read-only, and moving the caret would be wrong — dragging a
   * scrollbar must not retarget the cursor.
   */
  const scrollToRow = (row: number) => {
    if (!editor) return
    scrollByRows(Math.max(0, Math.round(row)) - editor.scrollY)
  }

  /** The same, for callers that count in lines rather than in wrapped rows. */
  const scrollTo = (wanted: number) => scrollToRow(rowAtLine(Math.round(wanted)))

  /**
   * Rewrite the buffer's text without the view jumping.
   *
   * `setText` drops the buffer back to the top, and placing the caret afterwards
   * scrolls the least amount that reveals it — which leaves the caret pinned to
   * the bottom edge and the code the user was reading gone from the screen. So
   * the line that was at the top is put back at the top, and the caret is only
   * chased if that leaves it off screen.
   */
  const keepingView = (rewrite: () => void) => {
    const wasTop = editor ? realLine(lineAtRow(editor.scrollY)) : 0
    rewrite()
    forgetLayout()
    if (!editor) return
    scrollToRow(rowAtLine(shownLine(wasTop)))
    const height = editor.height
    if (height <= 0) return
    const caret = rowAtLine(editor.logicalCursor.row)
    if (caret < editor.scrollY) scrollToRow(caret)
    else if (caret >= editor.scrollY + height) scrollToRow(caret - height + 1)
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
   * Land on a file line, centering it only when it is not already drawn.
   *
   * Viewport first, caret second — the buffer scrolls a moved caret into view by
   * the smallest amount that shows it, which pins a far jump to an edge with the
   * code around it off screen. A line that is already on screen is left where it
   * is: walking search hits or the problems list steps a few lines at a time, and
   * recentring each of those would slide the text out from under the eye.
   */
  const revealLine = (line: number, col: number) => {
    if (!editor) return
    const viewLine = shownLine(line)
    const row = rowAtLine(viewLine)
    const height = editor.height || editor.editorView.getViewport().height
    if (height > 0 && (row < editor.scrollY || row >= editor.scrollY + height)) {
      scrollToRow(row - Math.floor(height / 2))
    }
    editor.setCursor(viewLine, col)
    editor.requestRender()
    scheduleCursorSync()
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

  /** Put text into the buffer without it reading as an edit of the file. */
  const applyFoldText = (text: string) => {
    if (!editor || editor.plainText === text) return
    refolding = true
    try {
      editor.setText(text)
    } finally {
      refolding = false
    }
  }

  const rememberFolds = (regions: FoldRegion[]) => {
    if (props.path == null) return
    if (regions.length > 0) foldsFor.set(props.path, regions)
    else foldsFor.delete(props.path)
  }

  /**
   * Collapse `regions` — an empty list being "show the whole file" — and leave
   * the caret on the file line it was on, or on the anchor now hiding it.
   */
  const setFolds = (regions: FoldRegion[], keepAt?: number) => {
    if (!editor) return
    const source = docText()
    const line = keepAt ?? realLine(editor.logicalCursor.row)
    const col = editor.logicalCursor.col
    const view = regions.length > 0 ? foldView(source, regions) : null
    keepingView(() => {
      setFolded(view)
      rememberFolds(view?.folds ?? [])
      applyFoldText(view ? view.text : source)
      editor!.setCursor(shownLine(line), col)
    })
    applyWindow(true)
    scheduleCursorSync()
  }

  /**
   * The file's text once the buffer has taken an edit, with the fold model
   * carried along. Idempotent while the two already agree, which is what lets
   * every path that reports a change call it rather than remember to.
   */
  const syncDocument = (): string => {
    if (!editor) return ''
    // A card's gap is open: the buffer holds rows the file has not. Nothing may
    // be read back out of it, and nothing has edited it — the card is gone the
    // moment the editor takes the keyboard — so the file is what it already was.
    const applied = folded()
    if (applied && applied.spacers.size > 0) return applied.source
    const view = baseFold()
    if (!view) return editor.plainText
    if (editor.plainText === view.text) return view.source
    const next = reconcileFolds(view, editor.plainText)
    const rebuilt = next.folds.length > 0 ? foldView(next.source, next.folds) : null
    setFolded(rebuilt)
    rememberFolds(rebuilt?.folds ?? [])
    // An edit that carried an anchor away releases its block, and the lines it
    // was hiding have to come back into the buffer, not only into the file.
    const wanted = rebuilt ? rebuilt.text : next.source
    if (wanted !== editor.plainText) {
      const at = editor.cursorOffset
      keepingView(() => {
        applyFoldText(wanted)
        editor!.cursorOffset = Math.min(at, wanted.length)
      })
      applyWindow(true)
    }
    return next.source
  }

  /**
   * Open and close the card's gap in the buffer, the same way a fold is applied
   * — a rewrite that does not read as an edit of the file. Driven by `cardGap`
   * alone, so an ordinary keystroke never reaches it.
   *
   * `props.content` is what the buffer holds without a gap, and it has to be
   * asked rather than `docText()`: on the closing pass there is no view left to
   * hold the file, so `docText()` falls through to the buffer — which is the
   * gapped text this is here to take away. Comparing it against itself left the
   * blank rows in, and the next read of the buffer made them part of the file.
   */
  createEffect(
    on(cardGap, () => {
      if (!editor) return
      const wanted = folded()?.text ?? baseFold()?.text ?? props.content
      if (editor.plainText === wanted) return
      const at = editor.cursorOffset
      keepingView(() => {
        applyFoldText(wanted)
        editor!.cursorOffset = Math.min(at, wanted.length)
      })
      applyWindow(true)
    }),
  )

  /** Show the file whole again — what anything that replaces the text wholesale does. */
  const clearFolds = () => {
    if (folded()) setFolded(null)
    if (props.path != null) foldsFor.delete(props.path)
  }

  const runFoldOp = (op: FoldOp) => {
    if (!editor || props.path == null) return
    const current = folded()?.folds ?? []
    const line = realLine(editor.logicalCursor.row)
    if (op === 'unfoldAll') {
      if (current.length > 0) setFolds([], line)
      return
    }
    if (op === 'foldAll') {
      const all = foldableRegions(docText(), props.tabSize)
      if (all.length > 0) setFolds(all, line)
      return
    }
    if (op === 'unfold') {
      const kept = current.filter(fold => fold.start !== line)
      if (kept.length !== current.length) setFolds(kept, line)
      return
    }
    const region = innermostRegion(foldableRegions(docText(), props.tabSize), line)
    if (!region || current.some(fold => fold.start === region.start)) return
    setFolds([...current, region], region.start)
  }

  /**
   * What the gutter's chevron does: the block anchored *at* this line, rather
   * than the innermost one covering it — a click names its own row.
   */
  const toggleFoldAt = (line: number) => {
    if (!editor) return
    const current = folded()?.folds ?? []
    if (current.some(fold => fold.start === line)) {
      setFolds(
        current.filter(fold => fold.start !== line),
        line,
      )
      return
    }
    const region = foldableRegions(docText(), props.tabSize).find(fold => fold.start === line)
    if (region) setFolds([...current, region], line)
  }

  /**
   * Open the block the caret is about to edit. The buffer is missing the lines
   * a fold hides, so an edit that rewrites an anchor line would be replayed
   * against a file that still holds them — opening first is what keeps the two
   * texts describing the same edit. A *selection* over an anchor is left alone:
   * rebuilding the buffer would drop the selection and with it the keystroke,
   * and `reconcileFolds` rescues the block instead.
   */
  const releaseFoldForEdit = (key?: KeyEvent) => {
    const view = folded()
    if (!view || !editor || editor.hasSelection()) return
    const { row, col } = editor.logicalCursor
    const touched = new Set([realLine(row)])
    // The two keys that reach past the line they are pressed on: each joins a
    // neighbour up, and that neighbour may be the anchor of a block.
    if (key?.name === 'backspace' && col === 0 && row > 0) touched.add(realLine(row - 1))
    if (key?.name === 'delete' && col === lineTextAt(row).length) touched.add(realLine(row + 1))
    const kept = view.folds.filter(fold => !touched.has(fold.start))
    if (kept.length !== view.folds.length) setFolds(kept, realLine(row))
  }

  /**
   * A bracketed paste never passes through a key handler, so the one guard the
   * editing keys get has to be hung on the textarea's own entry point.
   */
  const unfoldBeforePaste = (el: TextareaRenderable) => {
    const paste = el.handlePaste.bind(el)
    el.handlePaste = (event: PasteEvent) => {
      releaseFoldForEdit()
      paste(event)
    }
  }

  const highlight = async (snapshot: string, forPath: string | null) => {
    const result = await computeHighlights(
      snapshot,
      props.filetype,
      props.tabSize,
      () => !editor || forPath !== props.path || docText() !== snapshot,
    )
    if (result === STALE) return
    // Stale guard: only apply if this is still the same file AND the buffer text
    // is byte-for-byte what we highlighted — otherwise offsets would drift.
    if (!editor || forPath !== props.path || docText() !== snapshot) return
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
    if (editor) void runHighlight(docText())
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

  /**
   * Replace the file's text as one undoable step and land the caret on `row`,
   * `col` — both in the file's own lines, since every caller works out where the
   * edit went from the text it just built rather than from the buffer.
   */
  const applyLineEdit = (content: string, row: number, col: number) => {
    if (!editor) return
    const view = folded()
    const next = view ? foldView(content, view.folds) : null
    setFolded(next)
    rememberFolds(next?.folds ?? [])
    applyFoldText(next ? next.text : content)
    editor.setCursor(next ? shownLine(row) : row, col)
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
    // The detail panel resolves whatever the selection rests on, so the item
    // being accepted has usually been asked about already — and that answer
    // carries the auto-import edits the wait below is for.
    const cached = resolvedItems.get(item)
    if (cached) item = cached
    // Most servers withhold auto-import edits from the list and compute them
    // only for the item actually chosen — ask, briefly, before inserting.
    else if (item.additionalTextEdits === undefined && props.resolveCompletion) {
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
    // The file's text and line: an auto-import edit is aimed at the top of the
    // file the server holds, which a fold does not shorten.
    const applied = applyCompletion(
      docText(),
      { line: realLine(row), character: col },
      anchorCol,
      item,
    )
    applyLineEdit(applied.content, applied.cursor.line, applied.cursor.character)
  }

  /**
   * The file lines a buffer-line range stands for. A folded anchor speaks for
   * the whole block under it, so commenting or moving one takes it all.
   */
  const realRange = (span: { from: number; to: number }) => ({
    from: realLine(span.from),
    to: realSpanEnd(span.to),
  })

  const toggleCommentLines = () => {
    if (!editor) return
    const prefix = commentPrefix(props.filetype)
    if (!prefix) return
    const { from, to } = realRange(editRange(editor.plainText))
    const text = docText()
    const next = toggleComment(text, from, to, prefix)
    if (next !== text)
      applyLineEdit(next, realLine(editor.logicalCursor.row), editor.logicalCursor.col)
  }

  /**
   * Line counts move under these two, and a fold is a pair of line numbers into
   * the text being rewritten — so the file comes back open rather than with its
   * blocks hiding whatever ended up at those numbers.
   */
  const withoutFolds = (): number => {
    const row = realLine(editor!.logicalCursor.row)
    if (folded()) setFolds([], row)
    return row
  }

  const moveSelectedLines = (delta: -1 | 1) => {
    if (!editor) return
    const { from, to } = realRange(editRange(editor.plainText))
    const col = editor.logicalCursor.col
    const row = withoutFolds()
    const next = moveLines(docText(), from, to, delta)
    if (next !== null) applyLineEdit(next, row + delta, col)
  }

  /** Duplicate below; the caret follows onto the copy only when asked downward. */
  const duplicateSelectedLines = (follow: boolean) => {
    if (!editor) return
    const { from, to } = realRange(editRange(editor.plainText))
    const col = editor.logicalCursor.col
    const row = withoutFolds()
    applyLineEdit(duplicateLines(docText(), from, to), follow ? row + (to - from + 1) : row, col)
  }

  /**
   * Delete the cursor's line, or every line the selection touches. The caret
   * lands on the line that took the first one's place, at the column it was on,
   * so a run of deletes takes line after line without moving the hand.
   */
  const deleteSelectedLines = () => {
    if (!editor) return
    const { from, to } = realRange(editRange(editor.plainText))
    const col = editor.logicalCursor.col
    withoutFolds()
    const next = removeLines(docText(), from, to)
    // The old selection is a pair of offsets into text that no longer exists,
    // and the next keystroke would delete whatever now sits at them.
    editor.clearSelection()
    const lines = next.split('\n')
    // The empty string after the file's final newline is no line to land on.
    const lastRow = Math.max(0, lines.length - (lines.at(-1) === '' ? 2 : 1))
    const row = Math.min(from, lastRow)
    applyLineEdit(next, row, Math.min(col, lines[row]?.length ?? 0))
  }

  const stepHistory = (kind: 'undo' | 'redo') => {
    if (!editor) return
    const at = kind === 'undo' ? history.undo() : history.redo()
    if (!at) return
    // The step replaces the file wholesale, so its folds are line numbers into
    // a text that no longer exists.
    if (folded()) {
      setFolded(null)
      rememberFolds([])
    }
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
          case 'delete':
            return deleteSelectedLines()
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.foldOp?.key,
      () => {
        const request = props.foldOp
        if (request) runFoldOp(request.op)
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
      if (editor) void runHighlight(docText())
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
    return changeRows(displayGitLines(), trackTotal(), height)
  })

  /** The same idea for diagnostics: the whole file's errors, in their own column. */
  const problemTrack = createMemo(() => {
    const height = trackHeight()
    if (height <= 0) return []
    return problemRows(displayProblems(), trackTotal(), height)
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
    // Before anything reads the caret: a key that edits the anchor of a folded
    // block has to find the block open, or the edit lands in a buffer the file
    // does not match. Not for vim's command keys — the second handler owns those.
    if (folded() && (!props.vim || vimState.mode === 'insert') && isEditingKey(key)) {
      releaseFoldForEdit(key)
    }
    scheduleCursorSync()
    cursorBeforeEdit = documentOffset()

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
        props.onChange(syncDocument())
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

    // Plain Ctrl+C/X: a second modifier makes it someone else's chord, and quitting
    // on one that happens to be unbound is how Ctrl+Opt+C used to close the editor.
    if (key.ctrl && !secondary(key) && (key.name === 'c' || key.name === 'x')) {
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
    // Same reason as the typing handler: an operator about to rewrite a folded
    // anchor needs the block open first.
    if (folded() && vimState.mode !== 'insert' && VIM_EDITS.has(key.sequence ?? '')) {
      releaseFoldForEdit()
    }
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
        // The pane outlives the tab, so a file comes back folded the way it was
        // left. Rebuilt against the content as it reads now, since the tab may
        // have been away while the file was written to.
        const regions = props.path == null ? [] : (foldsFor.get(props.path) ?? [])
        const view = regions.length > 0 ? foldView(props.content, regions) : null
        setFolded(view)
        rememberFolds(view?.folds ?? [])
        applyFoldText(view ? view.text : props.content)
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
        if (editor && props.content !== docText()) {
          // The lines a fold was standing on are whatever the writer put there;
          // the file comes back open rather than hiding something else.
          clearFolds()
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
        if (!edit || !editor || edit.content === docText()) return
        const at = editor.cursorOffset
        // A replace rewrites lines this pane never showed, so the fold ranges
        // are numbers into a text that is going away.
        clearFolds()
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
  // A microtask after the handler still lets a same-tick file switch finish
  // loading — the path effect resets the buffer to the top before this lands.
  createEffect(
    on(
      () => props.goto?.key,
      () => {
        const target = props.goto
        if (!target) return
        const key = target.key
        queueMicrotask(() => {
          if (!editor || props.goto?.key !== key) return
          // A jump names a line of the file, and landing on the anchor that hides
          // it would be a jump to the wrong place — the block opens instead.
          const view = folded()
          if (view && (view.display[target.line] ?? 0) < 0) {
            setFolds(
              view.folds.filter(fold => target.line <= fold.start || target.line > fold.end),
              target.line,
            )
          }
          revealLine(target.line, target.col)
          editor.focus()
        })
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
                keepScrollMargin = allowScrollPastEnd(el, () => props.scrollPastEnd)
                selectOnMultiClick(el, () => scheduleCursorSync())
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
                  // The pane moved or changed size, so everything positioned
                  // against its coordinates — the notes and the fold targets —
                  // was measured against where it used to be. This also covers
                  // the first layout, where those coordinates were still zero.
                  setWrapKey(key => key + 1)
                })
                allowSelectionOnlyInEditor(el)
                unfoldBeforePaste(el)
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
              // Wrapped by default: OpenTUI's textarea scrolls sideways only by
              // dragging the caret along, so with `wrap` off a long line's tail is
              // reached by moving the cursor into it — the trade that setting makes
              // for one buffer line per screen row.
              wrapMode={props.wrap ? 'word' : 'none'}
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
                // A fold rewriting the buffer is not an edit of the file, and it
                // is the one change the buffer reports that must record nothing.
                if (!editor || refolding) return
                const content = syncDocument()
                history.record({ content, cursor: cursorBeforeEdit }, Date.now())
                props.onChange(content)
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
          {/* The remark under the review panel's cursor, opened under its line.
              Above the inline notes' zIndex: it covers the rows below, and the
              text drawn after one of them would otherwise show through it. */}
          <Show when={reviewCard()}>
            {(card: () => NonNullable<ReturnType<typeof reviewCard>>) => (
              <box
                position="absolute"
                top={card().top}
                left={0}
                width={card().width}
                zIndex={20}
                flexDirection="column"
                backgroundColor={ui.panelBg}
                paddingLeft={1}
                paddingRight={1}
                border
                borderStyle="rounded"
                borderColor={reviewColor(card().draft)}
                title={card().heading}
              >
                <For each={card().lines}>
                  {line => (
                    <text
                      fg={line.dim ? ui.dim : ui.text}
                      bg={ui.panelBg}
                      wrapMode="none"
                      content={line.text}
                    />
                  )}
                </For>
              </box>
            )}
          </Show>
          {/* The hit target over each of the gutter's chevrons — painting
              nothing, since the gutter has already drawn the glyph. A box is
              simply the only thing that reports a click. */}
          <For each={foldMarkers()}>
            {marker => (
              <box
                position="absolute"
                top={marker.top}
                left={marker.left}
                width={1}
                height={1}
                zIndex={6}
                onMouseDown={() => toggleFoldAt(marker.line)}
                onMouseOver={() => setHotFold(marker.line)}
                onMouseOut={() => setHotFold(line => (line === marker.line ? null : line))}
              />
            )}
          </For>
          {/* What a collapsed block says for itself, in the space after the line
              it is folded into. */}
          <For each={foldNotes()}>
            {note => (
              <text
                position="absolute"
                top={note.top}
                left={note.left}
                zIndex={5}
                fg={note.hint ? ui.faint : ui.dim}
                bg={ui.bg}
                content={note.text}
              />
            )}
          </For>
          <Show when={menuBox()}>
            {(at: () => NonNullable<ReturnType<typeof menuBox>>) => (
              <CompletionMenu
                matches={matches()}
                selected={menuSelected()}
                layout={at().layout}
                top={at().top}
                left={at().left}
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
              backgroundColor={problemsHover.hovered() ? ui.hoverBg : ui.bg}
              onMouseDown={(event: MouseEvent) => {
                if (!dragging()) jumpToRow(event.y - (editor?.y ?? 0))
              }}
              onMouseOver={problemsHover.enter}
              onMouseOut={problemsHover.leave}
            >
              {/* `Index`, not `For`, on all three tracks: the rows are a fixed
                  column of marks whose *values* change as the file scrolls, and
                  keyed reconciliation on a list of duplicate primitives tears
                  down and rebuilds text renderables on every wheel tick. Indexed,
                  each row is built once and only its content and colour move. */}
              <Index each={problemTrack()}>
                {severity => (
                  <text
                    fg={trackColor(SEVERITY_COLOR, severity())}
                    bg={problemsHover.hovered() ? ui.hoverBg : ui.bg}
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
              backgroundColor={changesHover.hovered() ? ui.hoverBg : ui.bg}
              onMouseDown={(event: MouseEvent) => {
                if (!dragging()) jumpToRow(event.y - (editor?.y ?? 0))
              }}
              onMouseOver={changesHover.enter}
              onMouseOut={changesHover.leave}
            >
              <Index each={changeTrack()}>
                {change => (
                  <text
                    fg={trackColor(CHANGE_COLORS, change())}
                    bg={changesHover.hovered() ? ui.hoverBg : ui.bg}
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
              onMouseOver={scrollbarHover.enter}
              onMouseOut={scrollbarHover.leave}
            >
              <Index each={scrollbar()}>
                {/* The trough is a space, not a glyph hidden by painting it in
                    the background color: with `transparent` on there is no
                    background color to hide it in. */}
                {filled => (
                  <text
                    fg={scrollbarHover.hovered() || dragging() ? ui.dim : ui.scrollbar}
                    bg={ui.bg}
                    content={filled() ? '█' : ' '}
                  />
                )}
              </Index>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
