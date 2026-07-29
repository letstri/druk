import { TextAttributes } from '@opentui/core'
import type { KeyEvent, MouseEvent, TextareaRenderable } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'

import { copyToClipboard, readClipboard } from '../core/clipboard'
import type { LineChange } from '../core/git'
import { changeRows } from '../editor/changes'
import { History } from '../editor/history'
import { duplicateLines, moveLines, toggleComment } from '../editor/lines'
import { handleTyping } from '../editor/typing'
import { handleVimKey, initialVimState } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { lineAt, logicalWindow } from '../editor/window'
import { commentPrefix } from '../languages'
import { computeHighlights, getSyntaxStyle, segmentsIn, STALE } from '../languages/highlight'
import type { Highlighted, Segment } from '../languages/highlight'
import { ui } from '../themes'
import type { ThemeName } from '../themes'

export interface EditorPaneProps {
  path: string | null
  content: string
  filetype?: string
  focused: boolean
  theme: ThemeName
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
  /** VS Code keymap preset — the empty-state hints must name the right palette key. */
  vscodeKeys: boolean
  tabSize: number
  /** True while a modal owns the keyboard; the editor must ignore all keys. */
  blocked: boolean
  /** Lines changed against git HEAD, for the gutter marks. */
  gitLines: Map<number, LineChange>
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

const SIGN_GLYPH: Record<LineChange, string> = { added: '▎', modified: '▎', deleted: '▁' }

/** Read at paint time: `ui` is a store, so a table built at module scope freezes. */
const CHANGE_COLORS: Record<LineChange, () => string> = {
  added: () => ui.gitAdded,
  modified: () => ui.gitModified,
  deleted: () => ui.gitDeleted,
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
  const viewport = () => ({ top: viewTop(), height: viewHeight(), total: viewTotal() })
  /**
   * Visual row to logical line. Wrapping makes those two different things, and
   * `scrollY` counts visual rows while highlights are addressed by logical line:
   * on a lockfile whose lines wrap four times, scrolling to line 1500 asked for
   * a window around line 5970 — past the end of a 3000-line file, so nothing was
   * highlighted and the text went white.
   *
   * The table costs ~2ms to fetch on such a file, so it is cached and rebuilt
   * only when the text or the width changes.
   */
  let visualToLogical: number[] | null = null
  const forgetWrapMap = () => {
    visualToLogical = null
  }

  /**
   * Not guarded on `virtualLineCount`: that reports the viewport's rows, not the
   * buffer's — it says 22 on a file whose 3 000 lines wrap to 12 000 — so the
   * table is the only honest answer.
   */
  const wrapMap = (): number[] => {
    if (!editor) return []
    if (!visualToLogical) visualToLogical = editor.lineInfo.lineSources as number[]
    return visualToLogical
  }

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

  /** Track geometry, shared by the painter and the drag handler. */
  const scrollMetrics = createMemo(() => {
    const measured = viewport()
    // The textarea reports height 0 until the first layout, so until then fall
    // back to the terminal minus the tab bar and status bar.
    const height = measured.height || dimensions().height - 2
    const total = measured.total || lineCount()
    if (height <= 0 || total <= height) return null
    const size = Math.max(1, Math.round((height * height) / total))
    // `top` counts visual rows and `total` counts lines. Left mixed, a wrapped
    // file drives the thumb to the bottom while the change marks — which are
    // per line — still sit halfway, so the two disagree about the same place.
    return { height, total, size, span: height - size, top: lineAtRow(measured.top) }
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
    gutter?.setLineSigns?.(
      new Map(
        [...props.gitLines].map(([line, change]) => [
          line,
          { before: SIGN_GLYPH[change], beforeColor: signColor[change] },
        ]),
      ),
    )
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
    // One call per contiguous run of unsegmented lines. A range whose ends are new
    // but whose middle was done by an earlier window — jump away, jump back — must
    // not re-segment that middle, or every line in it collects a second copy of its
    // segments and gets highlighted twice.
    for (let line = from; line <= to; line++) {
      if (segmented.has(line)) continue
      let last = line
      while (last + 1 <= to && !segmented.has(last + 1)) last++

      for (const segment of segmentsIn(parsed, line, last)) {
        const list = byLine.get(segment.line)
        if (list) list.push(segment)
        else byLine.set(segment.line, [segment])
      }
      // Recorded even when a line had no captures, so it is not re-segmented.
      for (let done = line; done <= last; done++) segmented.add(done)
      line = last
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
      for (const segment of byLine.get(line) ?? []) editor.addHighlight(line, segment)
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
    }, 0)
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
    forgetWrapMap()
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
    const m = scrollMetrics()
    const height = m?.height ?? viewHeight()
    const total = m?.total ?? viewTotal()
    if (height <= 0) return []
    return changeRows(props.gitLines, total, height)
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
    editor = undefined
    setEditorEl(null)
    if (highlightTimer) clearTimeout(highlightTimer)
    if (cursorSync) clearTimeout(cursorSync)
    highlightTimer = null
    cursorSync = null
  }

  onCleanup(releaseEditor)

  // Clipboard and typing helpers, ahead of the textarea's own handling.
  useKeyboard((key: KeyEvent) => {
    // preventDefault only stops the textarea, not sibling global handlers, so a
    // key already claimed elsewhere (the tree's Enter) must be ignored here too.
    if (key.defaultPrevented) return
    if (props.blocked || !editor || !props.focused) return
    scheduleCursorSync()
    cursorBeforeEdit = editor.cursorOffset

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

    // Vim normal mode does its own thing with these keys.
    if (props.vim && vimState.mode !== 'insert') return
    if (handleTyping(editor, key, props.tabSize)) key.preventDefault()
  })

  useKeyboard((key: KeyEvent) => {
    if (key.defaultPrevented) return
    if (props.blocked || !props.vim || !editor || !props.focused) return
    const before = vimState.mode
    const stepped = { undo: () => stepHistory('undo'), redo: () => stepHistory('redo') }
    if (handleVimKey(editor, key, vimState, stepped)) key.preventDefault()
    if (vimState.mode !== before) {
      editor.cursorStyle = {
        style: vimState.mode === 'insert' ? 'line' : 'block',
        blinking: true,
      }
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
        props.onVimMode(props.vim ? 'normal' : null)
      },
    ),
  )

  createEffect(
    on(
      () => [props.theme, props.tabSize],
      () => {
        if (!editor) return
        editor.syntaxStyle = getSyntaxStyle()
        void highlight(editor.plainText, props.path)
      },
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
          <box
            flexGrow={1}
            flexDirection="column"
            backgroundColor={ui.bg}
            alignItems="center"
            justifyContent="center"
          >
            <text fg={ui.dim} bg={ui.bg} content="druk" attributes={TextAttributes.BOLD} />
            <text fg={ui.faint} bg={ui.bg} content="" />
            <text fg={ui.faint} bg={ui.bg} content="Enter   open file from the tree" />
            <text
              fg={ui.faint}
              bg={ui.bg}
              content={props.vscodeKeys ? 'F1      commands' : 'Ctrl+P  commands'}
            />
            <text fg={ui.faint} bg={ui.bg} content="Ctrl+F  find" />
          </box>
        }
      >
        {/* Drag capture lives on the wrapper, not the tracks: the pointer leaves a
          one-cell target on the first stray pixel, and each drag event goes to
          whatever sits under it. Guarded on `dragging` so a plain text
          selection across the pane never scrolls. */}
        <box
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
                el.on('line-info-change', () => gutter?.gutter?.requestRender?.())
                afterResize(el, () => {
                  applyLineSigns()
                  syncViewport()
                  // A resize re-wraps every line, so the visual-to-logical table
                  // built at the old width no longer describes this one.
                  forgetWrapMap()
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
              onMouse={() => applyWindow()}
              onCursorChange={() => {
                applyWindow()
                syncCursor()
              }}
            />
          </line_number>
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
              <For each={changeTrack()}>
                {change => (
                  <text
                    fg={change ? CHANGE_COLORS[change]() : ui.bg}
                    bg={ui.bg}
                    content={change ? '▎' : ' '}
                  />
                )}
              </For>
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
              <For each={scrollbar()}>
                {filled => (
                  <text
                    fg={filled ? ui.scrollbar : ui.bg}
                    bg={ui.bg}
                    content={filled ? '█' : '│'}
                  />
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
