import { setTimeout as sleep } from 'node:timers/promises'

import { TextAttributes } from '@opentui/core'
import type {
  KeyEvent,
  MouseEvent,
  PasteEvent,
  TextareaRenderable,
} from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  Show,
} from 'solid-js'

import { readClipboard } from '../core/clipboard'
import type { CursorStyle } from '../core/config'
import { covers } from '../core/conflicts'
import type { MergeConflict } from '../core/conflicts'
import type { LineChange } from '../core/git'
import { secondary } from '../core/keybindings'
import { plural } from '../core/text'
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
import {
  duplicateLines,
  moveLines,
  removeLines,
  toggleComment,
} from '../editor/lines'
import { problemRows } from '../editor/problems'
import { handleTyping } from '../editor/typing'
import { handleVimKey, initialVimState } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { lineAt, logicalWindow } from '../editor/window'
import { lineRangeAt, wordRangeAt } from '../editor/words'
import { commentPrefix } from '../languages'
import {
  computeHighlights,
  CONFLICT_GROUPS,
  FLASH_GROUP,
  getSyntaxStyle,
  mixColors,
  segmentsIn,
  STALE,
  styleIdForGroup,
  styleIdOver,
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
import { EDIT_KEYS } from './editKeys'
import { useHover } from './hover'
import { chordFor } from './keys'
import { allowSelectionIn, copyText } from './selection'
import { SEVERITY_COLOR, SEVERITY_GLYPH } from './severity'
import { cut, wrapText } from './text'
import { useKeys } from './useKeys'
import { Welcome } from './Welcome'

interface EditorPaneProps {
  path: string | null
  content: string
  rootName: string
  branch: string | null
  version: string
  filetype?: string
  focused: boolean
  reloadKey: number
  goto: { line: number; col: number; key: number } | null
  history: { kind: 'undo' | 'redo'; key: number } | null
  edit: { content: string; key: number } | null
  lineOp: {
    op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete'
    key: number
  } | null
  lineHome: { key: number } | null
  foldOp: { op: FoldOp; key: number } | null
  vim: boolean
  cursorStyle: CursorStyle
  wrap: boolean
  scrollPastEnd: boolean
  tabSize: number
  blocked: boolean
  gitLines: Map<number, LineChange>
  problems: Map<number, { severity: ProblemSeverity; message: string }>
  problemRanges: {
    line: number
    col: number
    endLine: number
    endCol: number
    severity: ProblemSeverity
    unnecessary: boolean
    deprecated: boolean
  }[]
  problemText: boolean
  conflicts: readonly MergeConflict[]
  reviews: Map<number, { draft: boolean; label: string; text: string }>
  reviewText: boolean
  reviewCard: {
    line: number
    draft: boolean
    heading: string
    body: string
    replies: { label: string; body: string }[]
  } | null
  complete:
    | ((line: number, col: number) => Promise<CompletionReply | null>)
    | null
  resolveCompletion:
    | ((item: CompletionItem) => Promise<CompletionItem | null>)
    | null
  completionRequest: { key: number } | null
  onCompletionMenu: (open: boolean) => void
  notice: { name: string; reason: string } | null
  onChange: (text: string) => void
  onCursor: (pos: { line: number; col: number }) => void
  onSelection: (lines: { from: number; to: number } | null) => void
  onFocus: () => void
  onVimMode: (mode: VimMode | null) => void
  onStatus: (message: string) => void
  onQuit: () => void
}

type ProblemRange = EditorPaneProps['problemRanges'][number]

const DEBOUNCE_MS = 16
const OVERSCAN = 60
const COMPLETION_DEBOUNCE_MS = 90
const RESOLVE_TIMEOUT_MS = 300

const giveUpResolving = async (): Promise<null> => {
  await sleep(RESOLVE_TIMEOUT_MS)
  return null
}
const INFO_DEBOUNCE_MS = 120

const SIGN_GLYPH: Record<LineChange, string> = {
  added: '▎',
  deleted: '▁',
  modified: '▎',
}

const CONFLICT_GLYPH = '┃'

// `ui` is a store: a table of values built at module scope freezes on the first theme.
const CHANGE_COLORS: Record<LineChange, () => string> = {
  added: () => ui.gitAdded,
  deleted: () => ui.gitDeleted,
  modified: () => ui.gitModified,
}

const trackColor = <T extends string>(
  colors: Record<T, () => string>,
  mark: T | undefined
): string => (mark ? colors[mark]() : ui.bg)

const PROBLEM_NOTE_COLORS: Record<ProblemSeverity, () => string> = {
  error: () => mixColors(ui.solidBg, ui.error, 0.62),
  hint: () => ui.dim,
  info: () => ui.dim,
  warning: () => mixColors(ui.solidBg, ui.dirty, 0.62),
}

const REVIEW_GLYPH = { draft: '◆', fetched: '◇' } as const
const reviewColor = (draft: boolean) => (draft ? ui.accent : ui.folder)
const reviewNoteColor = (draft: boolean) =>
  mixColors(ui.solidBg, draft ? ui.accent : ui.folder, 0.62)

// OpenTUI reports a pane resize nowhere else; `onResize` is protected, overridden in place.
function afterResize(el: TextareaRenderable, after: () => void) {
  const host = el as unknown as {
    onResize: (width: number, height: number) => void
  }
  const resize = host.onResize.bind(host)
  host.onResize = (width: number, height: number) => {
    resize(width, height)
    after()
  }
}

// A wheel event hitting nothing goes to whatever is focused; only this hook can drop it.
export function ignoreScrollOutsideBounds(el: TextareaRenderable) {
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    if (event.type === 'scroll') {
      const { x, y, width, height } = el
      const inside =
        event.x >= x &&
        event.x < x + width &&
        event.y >= y &&
        event.y < y + height
      if (!inside) {
        return
      }
    }
    handle(event)
  }
}

// VS Code's cursorSurroundingLines. OpenTUI's own 0.2 is a *fraction of the pane*, so
// the view scrolls a fifth of a screen before the caret has reached an edge.
const SCROLL_MARGIN = 0

// The renderable takes `scrollMargin` as a constructor option alone, and stops its own
// scrolling with the last line at the bottom.
function ownScrolling(el: TextareaRenderable, pastEndOn: () => boolean) {
  const view = el.editorView
  view.setScrollMargin(SCROLL_MARGIN)
  const pastEnd = (offset: number, rows: number, height: number) =>
    offset > Math.max(0, rows - height)

  // `handleScroll` and `onResize` are protected; overrides without the subclass.
  const host = el as unknown as {
    handleScroll: (event: ScrollEvent) => void
    onResize: (width: number, height: number) => void
  }
  const handle = host.handleScroll.bind(host)
  host.handleScroll = (event: ScrollEvent) => {
    const { scroll } = event
    const vertical = scroll?.direction === 'up' || scroll?.direction === 'down'
    if (!scroll || !vertical) {
      return handle(event)
    }
    const port = view.getViewport()
    const rows = view.getTotalVirtualLineCount()
    // A short file would slide away with no scrollbar to say so.
    const floor = Math.max(0, rows - port.height)
    const last = pastEndOn() ? (rows > port.height ? rows - 1 : 0) : floor
    const next =
      scroll.direction === 'down'
        ? Math.min(port.offsetY + scroll.delta, last)
        : Math.max(0, port.offsetY - scroll.delta)
    if (next === port.offsetY) {
      return
    }
    // `moveCursor`: the Zig view pins the viewport to the caret when it draws, so a
    // scroll that leaves the caret behind is undone before the frame reaches the screen.
    view.setViewport(port.offsetX, next, port.width, port.height, true)
    el.requestRender()
  }

  const resize = host.onResize.bind(host)
  host.onResize = (width: number, height: number) => {
    const port = view.getViewport()
    const wanted = port.offsetY
    const was =
      pastEndOn() &&
      pastEnd(wanted, view.getTotalVirtualLineCount(), port.height)
    resize(width, height)
    if (!was) {
      return
    }
    const next = view.getViewport()
    // A width change rewrapped: the row that was at the top may no longer exist.
    const offset = Math.min(
      wanted,
      Math.max(0, view.getTotalVirtualLineCount() - 1)
    )
    if (next.offsetY === offset) {
      return
    }
    view.setViewport(next.offsetX, offset, next.width, next.height, true)
    el.requestRender()
  }
}

interface ScrollEvent {
  scroll?: { direction: 'up' | 'down' | 'left' | 'right'; delta: number }
}

// OpenTUI has no double-click event; counted from consecutive downs.
const CARD_COLUMNS = 100
const DOUBLE_CLICK_MS = 400
/** How long a jump's landing row stays tinted. */
const FLASH_MS = 1000

// Runs after the buffer took the click: `setSelection` clears the zero-width mouse selection.
function selectOnMultiClick(el: TextareaRenderable, after: () => void) {
  let last = { at: 0, count: 0, x: -1, y: -1 }
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    handle(event)
    if (event.type !== 'down') {
      return
    }
    const now = Date.now()
    const same =
      event.x === last.x &&
      event.y === last.y &&
      now - last.at < DOUBLE_CLICK_MS
    const count = same ? last.count + 1 : 1
    last = { at: now, count, x: event.x, y: event.y }
    if (count < 2) {
      return
    }
    const text = el.plainText
    const at = el.cursorOffset
    const range = count >= 3 ? lineRangeAt(text, at) : wordRangeAt(text, at)
    if (range.start >= range.end) {
      return
    }
    el.setSelection(range.start, range.end)
    if (count >= 3) {
      last.count = 0
    }
    after()
  }
}

const CARET_KEYS = new Set(['up', 'down', 'home', 'end', 'pageup', 'pagedown'])

// Left/right collapse a selection themselves; every other move only clears the renderer's own,
// which a multi-click selection is not — left standing it would be typed over from a line away.
const movesCaret = (key: KeyEvent): boolean => {
  if (key.shift) {
    return false
  }
  if (key.name === 'left' || key.name === 'right') {
    return key.ctrl || key.option || key.meta
  }
  // Opt/Cmd + up/down move the selected lines and need the selection.
  return CARET_KEYS.has(key.name ?? '') && !key.option && !key.meta
}

// The character a key types, or null: backspace arrives as a one-character sequence too.
const typedChar = (key: KeyEvent): string | null => {
  const typed = key.sequence
  if (key.ctrl || key.meta) {
    return null
  }
  return typed?.length === 1 && typed >= ' ' && typed !== '\u007F'
    ? typed
    : null
}

const isEditingKey = (key: KeyEvent): boolean => {
  // Ahead of the modifier check: Ctrl/Opt/Cmd + backspace are word and line deletes.
  if (key.name === 'backspace' || key.name === 'delete') {
    return true
  }
  if (key.ctrl || key.meta) {
    return key.name === 'v'
  }
  return (
    key.name === 'return' ||
    key.name === 'enter' ||
    key.name === 'tab' ||
    typedChar(key) !== null
  )
}

// The text drawn after a line: a fold's `⋯ N lines`, a diagnostic, a review remark.
function Notes(props: {
  each: { top: number; left: number; text: string; color: string }[]
  onPress: (x: number, y: number) => void
}) {
  return (
    <For each={props.each}>
      {(note) => (
        <text
          position="absolute"
          top={note.top}
          left={note.left}
          zIndex={5}
          fg={note.color}
          bg={ui.bg}
          content={note.text}
          onMouseDown={(event: MouseEvent) => props.onPress(event.x, event.y)}
        />
      )}
    </For>
  )
}

// The dot tracks beside the scrollbar. Always a column, empty or not: a diagnostic
// arriving would otherwise narrow the pane and re-wrap every line the reader was on.
function Track<T extends string>(props: {
  rows: (T | undefined)[]
  colors: Record<T, () => string>
  glyph: string
  hover: ReturnType<typeof useHover>
  onJump: (y: number) => void
}) {
  const marked = () => props.rows.some(Boolean)
  const bg = () => (props.hover.hovered() && marked() ? ui.hoverBg : ui.bg)
  return (
    <box
      width={1}
      flexShrink={0}
      backgroundColor={bg()}
      onMouseDown={(event: MouseEvent) => props.onJump(event.y)}
      onMouseOver={props.hover.enter}
      onMouseOut={props.hover.leave}
    >
      {/* `Index`, not `For`: keyed rows of duplicate primitives rebuild every tick. */}
      <Index each={props.rows}>
        {(mark) => (
          <text
            fg={trackColor(props.colors, mark())}
            bg={bg()}
            content={mark() ? props.glyph : ' '}
          />
        )}
      </Index>
    </box>
  )
}

interface LineSign {
  before?: string
  beforeColor?: string
  after?: string
  afterColor?: string
}

const VIM_EDITS = new Set([
  'x',
  'X',
  'd',
  'D',
  'c',
  'C',
  's',
  'S',
  'p',
  'P',
  'o',
  'O',
  'J',
  'r',
])

const flat = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

export function EditorPane(props: EditorPaneProps) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  // `minWidth` is constructor-only and Solid builds elements bare, so it is poked in by hand.
  interface GutterHost {
    gutter?: { _minWidth?: number; requestRender?: () => void }
    setLineSigns?: (signs: Map<number, LineSign>) => void
    setLineNumbers?: (numbers: Map<number, number>) => void
    setHideLineNumbers?: (rows: Set<number>) => void
  }
  let gutter: GutterHost | undefined
  let editor: TextareaRenderable | undefined
  let highlightTimer: ReturnType<typeof setTimeout> | null = null
  let parsing = false
  let queuedParse = false
  let byLine = new Map<number, Segment[]>()
  let parsed: Highlighted | null = null
  const segmented = new Set<number>()
  const appliedLines = new Set<number>()
  const cursor = { col: 0, line: 0 }
  let reportedSelection: { from: number; to: number } | null = null
  const history = new History({ content: props.content, cursor: 0 })
  let cursorBeforeEdit = 0
  const vimState = initialVimState()
  const [vimMode, setVimMode] = createSignal<VimMode>(vimState.mode)

  const [editorEl, setEditorEl] = createSignal<TextareaRenderable | null>(null)
  /** The caret's buffer row — which is what the gutter keys every one of its maps by. */
  const [cursorRow, setCursorRow] = createSignal(0)
  /**
   * The buffer row a jump just landed on, tinted for `FLASH_MS` so the eye finds
   * it: a definition, a search hit or a problem lands mid-file with nothing but a
   * one-cell caret to say where, which is not something a reader who did not
   * watch it move can pick out of a screenful of code.
   */
  const [flashRow, setFlashRow] = createSignal<number | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const flashLanding = (row: number) => {
    setFlashRow(row)
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => setFlashRow(null), FLASH_MS)
  }
  onCleanup(() => clearTimeout(flashTimer))

  // The pane's box: the coordinate space the inline notes position in.
  let host: { x: number; y: number; width: number } | undefined

  // Null unless something is folded: with no view, a buffer line *is* a file line.
  const [baseFold, setFolded] = createSignal<FoldView | null>(null)

  const CARD_LINES = 8

  // Only while the editor has given up the keyboard: the gap's rows are not in the file.
  const cardGap = createMemo(() => {
    const card = props.reviewCard
    if (!card || !host || props.focused) {
      return null
    }
    const room = host.width - 4
    if (room < 12) {
      return null
    }
    const wrapped: { text: string; dim: boolean }[] = wrapText(
      flat(card.body),
      room
    ).map((text) => ({
      dim: false,
      text,
    }))
    for (const said of card.replies) {
      const body = wrapText(`↳ ${said.label}: ${flat(said.body)}`, room)
      for (const text of body) {
        wrapped.push({ dim: true, text })
      }
    }
    const lines = wrapped.slice(0, CARD_LINES)
    if (wrapped.length > CARD_LINES) {
      lines[CARD_LINES - 1] = {
        dim: true,
        text: `… ${wrapped.length - CARD_LINES + 1} more lines`,
      }
    }
    return {
      draft: card.draft,
      // Spaces of its own: the border draws straight up to the title otherwise.
      heading: cut(
        ` ${REVIEW_GLYPH[card.draft ? 'draft' : 'fetched']} ${card.heading} `,
        room
      ),
      line: card.line,
      lines: lines.map((line) => ({
        dim: line.dim,
        text: cut(line.text, room),
      })),
      rows: lines.length + 2,
    }
  })

  // Folds plus the card's gap; the gap is never remembered per path nor seen by a fold command.
  const folded = createMemo<FoldView | null>(() => {
    const base = baseFold()
    const gap = cardGap()
    if (!gap) {
      return base
    }
    return spacedView(base ?? plainView(props.content), gap.line, gap.rows)
  })
  const foldsFor = new Map<string, FoldRegion[]>()
  let refolding = false

  const docText = (): string => folded()?.source ?? editor?.plainText ?? ''

  // Buffer row → file line.
  const realLine = (row: number): number => folded()?.real[row] ?? row

  // File line → buffer row, or the anchor hiding it; never -1.
  const shownLine = (line: number): number => {
    const view = folded()
    if (!view) {
      return line
    }
    for (let at = Math.min(line, view.display.length - 1); at >= 0; at -= 1) {
      const row = view.display[at]!
      if (row >= 0) {
        return row
      }
    }
    return 0
  }

  // The last file line buffer row `row` speaks for, folded block included.
  const realSpanEnd = (row: number): number => {
    const view = folded()
    if (!view) {
      return row
    }
    const next = view.real[row + 1]
    return next === undefined ? view.starts.length - 1 : next - 1
  }

  // Offset into the file, not into the buffer.
  const documentOffset = (): number => {
    if (!editor) {
      return 0
    }
    const view = folded()
    if (!view) {
      return editor.cursorOffset
    }
    const { row, col } = editor.logicalCursor
    return (view.starts[realLine(row)] ?? 0) + col
  }

  // Marks arrive keyed by file line; the buffer is drawn by its own.
  const toDisplay = <T,>(marks: Map<number, T>): Map<number, T> => {
    const view = folded()
    if (!view) {
      return marks
    }
    const mapped = new Map<number, T>()
    for (const [line, mark] of marks) {
      const row = view.display[line]
      if (row !== undefined && row >= 0) {
        mapped.set(row, mark)
      }
    }
    return mapped
  }

  const displayGitLines = createMemo(() => toDisplay(props.gitLines))
  const displayProblems = createMemo(() => toDisplay(props.problems))
  const displayReviews = createMemo(() => toDisplay(props.reviews))
  const displayConflicts = createMemo(() => {
    const lines = new Map<number, true>()
    for (const conflict of props.conflicts) {
      for (let line = conflict.start; line <= conflict.end; line += 1) {
        lines.set(line, true)
      }
    }
    return toDisplay(lines)
  })
  // Three signals, not one object: a new identity per scroll step recomputes every reader.
  const [viewTop, setViewTop] = createSignal(0)
  const [viewHeight, setViewHeight] = createSignal(0)
  const [viewTotal, setViewTotal] = createSignal(0)
  // Cached: `lineInfo` unpacks four native arrays per call; invalidated from `line-info-change`.
  let layout: { sources: number[]; widths: number[] } | null = null
  const forgetLayout = () => {
    layout = null
  }

  // Not guarded on `virtualLineCount`: that reports the viewport's rows, not the buffer's.
  const lineLayout = (): { sources: number[]; widths: number[] } => {
    if (!editor) {
      return { sources: [], widths: [] }
    }
    if (!layout) {
      const info = editor.lineInfo
      layout = {
        sources: info.lineSources as number[],
        widths: info.lineWidthCols as number[],
      }
    }
    return layout
  }

  const wrapMap = (): number[] => lineLayout().sources

  const lineAtRow = (row: number): number => lineAt(wrapMap(), row)

  // Binary search: the table is non-decreasing.
  const rowAtLine = (line: number): number => {
    const map = wrapMap()
    if (map.length === 0) {
      return line
    }
    let low = 0
    let high = map.length - 1
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if ((map[mid] ?? 0) < line) {
        low = mid + 1
      } else {
        high = mid
      }
    }
    return low
  }

  // Offsets rather than a split(): this re-runs on every keystroke.
  const contentStarts = createMemo(() => {
    const starts = [0]
    for (
      let at = props.content.indexOf('\n');
      at >= 0;
      at = props.content.indexOf('\n', at + 1)
    ) {
      starts.push(at + 1)
    }
    return starts
  })

  const lineCount = createMemo(() => contentStarts().length)

  // The textarea reports height 0 until the first layout; hence the fallback.
  const trackHeight = createMemo(() => viewHeight() || dimensions().height - 2)
  const trackTotal = createMemo(() => viewTotal() || lineCount())

  const scrollMetrics = createMemo(() => {
    const height = trackHeight()
    const total = trackTotal()
    if (height <= 0 || total <= height) {
      return null
    }
    const size = Math.max(1, Math.round((height * height) / total))
    // `top` counts visual rows and `total` lines; mixed, thumb and change marks disagree.
    return {
      height,
      size,
      span: height - size,
      top: lineAtRow(viewTop()),
      total,
    }
  })

  const scrollbar = createMemo(() => {
    const m = scrollMetrics()
    if (!m) {
      return []
    }
    // Past-end scrolling makes the last line the topmost reachable one.
    const last = props.scrollPastEnd ? m.total - 1 : m.total - m.height
    const at = Math.min(m.span, Math.round((m.top / last) * m.span))
    return Array.from(
      { length: m.height },
      (_, row) => row >= at && row < at + m.size
    )
  })

  let track: { y: number } | undefined
  const [dragging, setDragging] = createSignal(false)
  const problemsHover = useHover()
  const changesHover = useHover()
  const scrollbarHover = useHover()
  const [hotFold, setHotFold] = createSignal<number | null>(null)

  const [menuOpen, setMenuOpenRaw] = createSignal(false)

  // Bumped on a re-wrap; the memos read it to re-measure.
  const [wrapKey, setWrapKey] = createSignal(0)

  // `below`: the caller needs the row *after* the wrapped line on screen, not its last row.
  const rowSpan = (
    row: number,
    below = false
  ): { first: number; last: number } | null => {
    const el = editorEl()
    if (!el) {
      return null
    }
    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources } = lineLayout()
    const first = rowAtLine(row)
    if (sources[first] !== row) {
      return null
    }
    let last = first
    while (sources[last + 1] === row) {
      last += 1
    }
    const wanted = below ? last + 1 : last
    if (wanted < top || wanted >= top + height) {
      return null
    }
    return { first, last }
  }

  const noteSlot = (
    row: number
  ): { top: number; left: number; room: number } | null => {
    const el = editorEl()
    const span = rowSpan(row)
    if (!el || !host || !span) {
      return null
    }
    const left = el.x - host.x + 1 + (lineLayout().widths[span.last] ?? 0) + 2
    const room = host.width - left - 2
    if (room < 8) {
      return null
    }
    return { left, room, top: el.y - host.y + (span.last - viewTop()) }
  }

  // Covers the rows under the line rather than opening a gap: a gap needs the keyboard given up.
  const problemCard = createMemo(() => {
    wrapKey()
    void props.content
    const el = editorEl()
    // The review card owns the rows under its own line.
    // The completion menu floats over the same rows; two boxes there overprint each other.
    if (!props.problemText || !el || !host || cardGap() || menuOpen()) {
      return null
    }
    const problem = displayProblems().get(cursorRow())
    const span = rowSpan(cursorRow())
    if (!problem || !span) {
      return null
    }
    const width = Math.min(host.width, CARD_COLUMNS)
    const room = width - 4
    if (room < 12) {
      return null
    }
    const flatMessage = problem.message.replaceAll(/\s+/gu, ' ').trim()

    const top = viewTop()
    const height = viewHeight() || el.height
    const below = top + height - (span.last + 1)
    const above = span.first - top
    const wrapped = wrapText(flatMessage, room)
    const rows = Math.min(
      wrapped.length + 2,
      Math.max(below, above),
      Math.max(3, Math.floor(height / 2))
    )
    if (rows < 3) {
      return null
    }
    const lines = wrapped.slice(0, rows - 2)
    if (wrapped.length > lines.length) {
      lines[lines.length - 1] =
        `… ${wrapped.length - lines.length + 1} more lines`
    }
    return {
      color: SEVERITY_COLOR[problem.severity](),
      heading: ` ${SEVERITY_GLYPH[problem.severity]} ${problem.severity} `,
      lines,
      // Buffer row, as `displayProblems` keys its marks.
      row: cursorRow(),
      top:
        el.y -
        host.y +
        (below >= rows ? span.last + 1 : span.first - rows) -
        top,
      width,
    }
  })

  const reviewCard = createMemo(() => {
    wrapKey()
    void props.content
    const gap = cardGap()
    const view = folded()
    const el = editorEl()
    if (!gap || !view || !el || !host) {
      return null
    }
    const anchor = view.display[gap.line]
    if (anchor === undefined || anchor < 0) {
      return null
    }
    const span = rowSpan(anchor, true)
    if (!span) {
      return null
    }

    return {
      draft: gap.draft,
      heading: gap.heading,
      lines: gap.lines,
      // Buffer row, as `displayReviews` keys its marks.
      row: anchor,
      top: el.y - host.y + (span.last + 1 - viewTop()),
      width: host.width,
    }
  })

  // Declared before the inline notes: both want the slot after the line, and those follow it.
  const foldNotes = createMemo(() => {
    wrapKey()
    void props.content
    const view = folded()
    if (!view) {
      return []
    }
    const chord = chordFor('editor.unfold')
    const notes: { top: number; left: number; text: string; hint?: boolean }[] =
      []
    for (const [line, count] of view.hidden) {
      const row = view.display[line]
      if (row === undefined || row < 0) {
        continue
      }
      const slot = noteSlot(row)
      if (!slot) {
        continue
      }
      const text = `⋯ ${plural(count, 'line')}`
      notes.push({ left: slot.left, text: cut(text, slot.room), top: slot.top })
      if (
        chord &&
        row === cursorRow() &&
        slot.room - text.length > chord.length + 1
      ) {
        notes.push({
          hint: true,
          left: slot.left + text.length,
          text: ` ${chord}`,
          top: slot.top,
        })
      }
    }
    return notes
  })

  const foldNoteEnds = createMemo(() => {
    const ends = new Map<number, number>()
    for (const note of foldNotes()) {
      const end = note.left + note.text.length
      ends.set(note.top, Math.max(ends.get(note.top) ?? 0, end))
    }
    return ends
  })

  const inlineNotes = createMemo(() => {
    wrapKey()
    void props.content
    // Review marks first, so a diagnostic on the same row wins; keyed by row, not file line.
    const wanted = new Map<
      number,
      { text: string; color: string; more?: boolean; chord?: string }
    >()
    if (props.reviewText) {
      const opened = reviewCard()?.row
      const panel = chordFor('view.review')
      for (const [row, mark] of displayReviews()) {
        if (row === opened) {
          continue
        }
        wanted.set(row, {
          chord: panel,
          color: reviewNoteColor(mark.draft),
          text: `${mark.label}: ${mark.text}`,
        })
      }
    }
    const chord = chordFor('problems.detail')
    if (props.problemText) {
      const carded = problemCard()?.row
      for (const [row, problem] of displayProblems()) {
        if (row === carded) {
          continue
        }
        const said = headline(problem.message)
        wanted.set(row, {
          chord,
          color: PROBLEM_NOTE_COLORS[problem.severity](),
          more: said.more,
          text: said.more ? `${said.text}…` : said.text,
        })
      }
    }
    if (wanted.size === 0) {
      return []
    }
    const ends = foldNoteEnds()
    const notes: { top: number; left: number; text: string; color: string }[] =
      []
    for (const [row, note] of wanted) {
      const slot = noteSlot(row)
      if (!slot) {
        continue
      }
      // A folded line already spent this slot: both are absolute at one zIndex, so they overprint.
      const end = ends.get(slot.top)
      const left = end === undefined ? slot.left : end + 1
      const room = slot.room - (left - slot.left)
      if (room < 8) {
        continue
      }
      const flatNote = note.text.replaceAll(/\s+/gu, ' ')
      // A message the row said in full keeps it: the hint is only taken out of the text where it was cut.
      const cutAway = note.more || flatNote.length > room
      const hint =
        note.chord &&
        row === cursorRow() &&
        (cutAway || flatNote.length + note.chord.length + 1 <= room) &&
        room - note.chord.length > 12
          ? ` ${note.chord}`
          : ''
      const text = cut(flatNote, room - hint.length)
      notes.push({ color: note.color, left, text, top: slot.top })
      if (hint) {
        notes.push({
          color: ui.faint,
          left: left + text.length,
          text: hint,
          top: slot.top,
        })
      }
    }
    return notes
  })

  const anyFoldable = createMemo(() => {
    const starts = contentStarts()
    for (let line = 0; line < starts.length; line += 1) {
      if (foldsFrom(props.content, starts, line, props.tabSize)) {
        return true
      }
    }
    return false
  })

  // Guarded on a size: the coordinates come from a ref and are zero before the first layout.
  const foldMarkers = createMemo(() => {
    wrapKey()
    const el = editorEl()
    if (!el || !host || el.width <= 0 || host.width <= 0) {
      return []
    }
    if (!anyFoldable()) {
      return []
    }
    const starts = contentStarts()
    const top = viewTop()
    const height = viewHeight() || el.height
    const { sources } = lineLayout()
    const rows = sources.length > 0 ? sources.length : viewTotal()
    const markers: { top: number; left: number; line: number }[] = []
    let previous = top > 0 ? (sources[top - 1] ?? top - 1) : -1
    for (let row = top; row < top + height && row < rows; row += 1) {
      const buffer = sources.length > 0 ? (sources[row] ?? row) : row
      if (buffer === previous) {
        continue
      }
      previous = buffer
      const line = realLine(buffer)
      if (!foldsFrom(props.content, starts, line, props.tabSize)) {
        continue
      }
      markers.push({
        left: el.x - host.x - 2,
        line,
        top: el.y - host.y + (row - top),
      })
    }
    return markers
  })

  const [menuItems, setMenuItems] = createSignal<CompletionItem[]>([])
  const [menuPrefix, setMenuPrefix] = createSignal('')
  const [menuSelected, setMenuSelected] = createSignal(0)
  // Absolute visual row (not the viewport's), visual column.
  const [menuPos, setMenuPos] = createSignal({ col: 0, row: 0 })
  let menuAnchor = { col: 0, line: 0 }
  let menuIncomplete = false
  let completionGen = 0
  let completionTimer: ReturnType<typeof setTimeout> | null = null
  let lastTyped: string | null = null

  const [menuInfo, setMenuInfo] = createSignal<ItemInfo | null>(null)
  const resolvedItems = new WeakMap<CompletionItem, CompletionItem>()
  let infoTimer: ReturnType<typeof setTimeout> | null = null
  let infoGen = 0

  const setMenuOpen = (open: boolean) => {
    if (menuOpen() === open) {
      return
    }
    setMenuOpenRaw(open)
    props.onCompletionMenu(open)
  }

  // Grows but never shrinks, so the box does not jump as the selection walks the list.
  let panelFloor = 0

  const closeMenu = () => {
    completionGen += 1
    if (completionTimer) {
      clearTimeout(completionTimer)
    }
    completionTimer = null
    if (infoTimer) {
      clearTimeout(infoTimer)
    }
    infoTimer = null
    infoGen += 1
    setMenuInfo(null)
    panelFloor = 0
    setMenuOpen(false)
  }

  const matches = createMemo(() => filterCompletions(menuItems(), menuPrefix()))

  const askForInfo = async (item: CompletionItem, gen: number) => {
    const reply = await props.resolveCompletion?.(item)
    // Cached as itself on a null reply: the server has answered.
    const merged = reply ? { ...item, ...reply } : item
    resolvedItems.set(item, merged)
    if (gen === infoGen && menuOpen()) {
      setMenuInfo(itemInfo(merged))
    }
  }

  createEffect(
    on([menuOpen, menuSelected, matches], () => {
      if (infoTimer) {
        clearTimeout(infoTimer)
      }
      infoTimer = null
      const item = menuOpen() ? matches()[menuSelected()]?.item : undefined
      if (!item) {
        setMenuInfo(null)
        return
      }
      const known = resolvedItems.get(item)
      setMenuInfo(itemInfo(known ?? item))
      if (known || !props.resolveCompletion) {
        return
      }
      infoGen += 1
      const gen = infoGen
      infoTimer = setTimeout(() => {
        infoTimer = null
        void askForInfo(item, gen)
      }, INFO_DEBOUNCE_MS)
    })
  )

  onCleanup(() => {
    if (infoTimer) {
      clearTimeout(infoTimer)
    }
  })

  const lineTextAt = (row: number): string => {
    const text = editor?.plainText ?? ''
    let start = 0
    for (let n = 0; n < row; n += 1) {
      const next = text.indexOf('\n', start)
      if (next === -1) {
        return ''
      }
      start = next + 1
    }
    const end = text.indexOf('\n', start)
    return end === -1 ? text.slice(start) : text.slice(start, end)
  }

  const anchorMenuAt = (prefixLength: number) => {
    if (!editor) {
      return
    }
    const at = editor.visualCursor
    // `visualRow` is a viewport row, not a buffer row; the scroll offset is added back.
    setMenuPos({
      col: Math.max(0, at.visualCol - prefixLength),
      row: at.visualRow + editor.scrollY,
    })
  }

  const requestCompletions = async (explicit: boolean) => {
    if (!props.complete || !editor) {
      return
    }
    completionGen += 1
    const gen = completionGen
    const forPath = props.path
    const { row, col } = editor.logicalCursor
    // The server has never been told anything is folded, so the ask is in file lines.
    const reply = await props.complete(realLine(row), col)
    if (
      !editor ||
      gen !== completionGen ||
      props.path !== forPath ||
      props.blocked
    ) {
      return
    }
    const now = editor.logicalCursor
    // The reply describes a scope the caret has left; shown anyway it lists globals as members.
    if (now.row !== row) {
      return
    }
    const lineText = lineTextAt(now.row)
    if (!extendsWord(lineText, col, now.col)) {
      return
    }
    if (!reply || reply.items.length === 0) {
      if (explicit) {
        menuAnchor = { col: now.col, line: now.row }
        menuIncomplete = false
        setMenuItems([])
        setMenuPrefix('')
        setMenuSelected(0)
        anchorMenuAt(0)
        setMenuOpen(true)
      } else {
        closeMenu()
      }
      return
    }
    const start = wordStart(lineText, now.col)
    menuAnchor = { col: start, line: now.row }
    menuIncomplete = reply.isIncomplete
    setMenuItems(reply.items)
    setMenuPrefix(lineText.slice(start, now.col))
    setMenuSelected(0)
    anchorMenuAt(now.col - start)
    setMenuOpen(true)
  }

  const scheduleAutoCompletion = () => {
    if (completionTimer) {
      clearTimeout(completionTimer)
    }
    // The reply guard again: a key typed inside the debounce carries the caret out of scope.
    const from = editor?.logicalCursor
    const at = from ? { col: from.col, row: from.row } : null
    completionTimer = setTimeout(() => {
      completionTimer = null
      if (!editor || !props.focused || props.blocked) {
        return
      }
      const now = editor.logicalCursor
      if (
        at &&
        (now.row !== at.row ||
          !extendsWord(lineTextAt(now.row), at.col, now.col))
      ) {
        return
      }
      void requestCompletions(false)
    }, COMPLETION_DEBOUNCE_MS)
  }

  // On the cursor-sync tick, after the buffer settled, so the prefix is never mid-edit.
  const refreshMenu = () => {
    if (!editor) {
      return
    }
    const typed = lastTyped
    lastTyped = null
    if (menuOpen()) {
      if (menuItems().length === 0) {
        return closeMenu()
      }
      const { row, col } = editor.logicalCursor
      if (row !== menuAnchor.line || col < menuAnchor.col) {
        return closeMenu()
      }
      const prefix = lineTextAt(row).slice(menuAnchor.col, col)
      if ([...prefix].some((char) => !isWordChar(char))) {
        closeMenu()
        // Closing alone would swallow a `.` typed over the open menu.
        if (typed && TRIGGER_CHARS.has(typed)) {
          scheduleAutoCompletion()
        }
        return
      }
      if (prefix !== menuPrefix()) {
        setMenuPrefix(prefix)
        setMenuSelected(0)
        anchorMenuAt(prefix.length)
        if (menuIncomplete) {
          void requestCompletions(false)
        }
      }
      return
    }
    if (!typed || !props.complete || props.blocked || !props.focused) {
      return
    }
    if (props.vim && vimState.mode !== 'insert') {
      return
    }
    if (TRIGGER_CHARS.has(typed) || isWordChar(typed)) {
      scheduleAutoCompletion()
    }
  }

  const menuBox = createMemo(() => {
    if (!menuOpen() || !editor || !host) {
      return null
    }
    const paneHeight = viewHeight() || editor.height
    const screenRow = menuPos().row - viewTop()
    const below = screenRow + 1
    const menu = layoutMenu(
      matches(),
      menuInfo(),
      {
        height: Math.max(3, Math.max(paneHeight - below, screenRow)),
        width: host.width - 2,
      },
      props.resolveCompletion !== null,
      panelFloor
    )
    panelFloor = Math.max(panelFloor, menu.panelRows)
    const top =
      paneHeight - below >= menu.height || screenRow < menu.height
        ? below
        : screenRow - menu.height
    // Label column = border + selection bar + glyph pair, hence the 4.
    const anchorX = editor.x - host.x + 1 + menuPos().col
    const left = Math.max(0, Math.min(anchorX - 4, host.width - menu.width))
    return { left, menu, top: editor.y - host.y + top }
  })

  const gutterWidth = () => String(lineCount()).length + 2

  createEffect(() => {
    const width = gutterWidth()
    if (gutter?.gutter) {
      gutter.gutter._minWidth = width
    }
  })

  // Line signs are a method, not a settable prop, so Solid cannot bind them.
  const applyLineSigns = () => {
    // `ui` is a store: a table at module scope holds the first theme forever.
    const signColor: Record<LineChange, string> = {
      added: ui.gitAdded,
      deleted: ui.gitDeleted,
      modified: ui.gitModified,
    }
    const signs = new Map<number, LineSign>()
    for (const [line, change] of displayGitLines()) {
      signs.set(line, {
        before: SIGN_GLYPH[change],
        beforeColor: signColor[change],
      })
    }
    // After the git marks: a line holding both shows the remark.
    for (const [row, mark] of displayReviews()) {
      signs.set(row, {
        before: mark.draft ? REVIEW_GLYPH.draft : REVIEW_GLYPH.fetched,
        beforeColor: reviewColor(mark.draft),
      })
    }
    // Then a problem, which outranks a remark about it.
    for (const [line, problem] of displayProblems()) {
      signs.set(line, {
        before: '●',
        beforeColor: SEVERITY_COLOR[problem.severity](),
      })
    }
    // Last: every line of a conflict is "modified" and most are a diagnostic too.
    for (const [line] of displayConflicts()) {
      signs.set(line, { before: CONFLICT_GLYPH, beforeColor: ui.dirty })
    }
    // A blank sign keeps the column reserved: the first diagnostic would shift the file right.
    if (signs.size === 0) {
      signs.set(0, { before: ' ' })
    }
    // Reserved for the whole file: a column that came and went while scrolling would shift lines.
    if (anyFoldable()) {
      signs.set(0, { ...signs.get(0), after: signs.get(0)?.after ?? ' ' })
      const view = folded()
      const closed = new Set(view?.folds.map((fold) => fold.start))
      const starts = contentStarts()
      for (let line = 0; line < starts.length; line += 1) {
        if (!foldsFrom(props.content, starts, line, props.tabSize)) {
          continue
        }
        const row = view ? (view.display[line] ?? -1) : line
        if (row < 0) {
          continue
        }
        const shut = closed.has(line)
        signs.set(row, {
          ...signs.get(row),
          after: shut ? '▸' : '▾',
          afterColor:
            hotFold() === line ? ui.accent : shut ? ui.text : ui.gutter,
        })
      }
    }
    gutter?.setLineSigns?.(signs)
  }
  createEffect(applyLineSigns)

  // The gutter numbers a buffer line by its index, which folding stops being the file's line.
  createEffect(() => {
    const view = folded()
    const numbers = new Map<number, number>()
    if (view) {
      for (const [row, line] of view.real.entries()) {
        numbers.set(row, line + 1)
      }
    }
    gutter?.setLineNumbers?.(numbers)
    // `real` repeats the anchor on the gap's rows, so without this each would draw its number.
    gutter?.setHideLineNumbers?.(new Set(view?.spacers))
  })

  const rowOfOffset = (text: string, offset: number) => {
    let row = 0
    for (
      let at = text.indexOf('\n');
      at >= 0 && at < offset;
      at = text.indexOf('\n', at + 1)
    ) {
      row += 1
    }
    return row
  }

  const editRange = (text: string) => {
    const span = editor?.getSelection()
    if (!span || span.start === span.end) {
      const { row } = editor!.logicalCursor
      return { from: row, to: row }
    }
    const start = Math.min(span.start, span.end)
    const end = Math.max(span.start, span.end)
    // `end` is exclusive: a selection stopping at column 0 does not take that line.
    return {
      from: rowOfOffset(text, start),
      to: rowOfOffset(text, Math.max(start, end - 1)),
    }
  }

  const syncViewport = () => {
    if (!editor) {
      return
    }
    setViewTop(editor.scrollY)
    setViewHeight(editor.height)
    setViewTotal(editor.lineCount)
  }

  // Vertical caret moves emit no cursor-change event, so this runs a tick after every key.
  const syncCursor = () => {
    if (!editor) {
      return
    }
    syncViewport()
    // Before the unchanged-position return: Shift+↑ at the last line grows the selection alone.
    const rows = editor.hasSelection() ? editRange(editor.plainText) : null
    const span = rows
      ? { from: realLine(rows.from), to: realLine(rows.to) }
      : null
    if (
      span?.from !== reportedSelection?.from ||
      span?.to !== reportedSelection?.to
    ) {
      reportedSelection = span
      props.onSelection(span)
    }
    const at = editor.visualCursor
    if (!at) {
      return
    }
    if (at.logicalRow === cursor.line && at.logicalCol === cursor.col) {
      return
    }
    cursor.line = at.logicalRow
    cursor.col = at.logicalCol
    setCursorRow(at.logicalRow)
    // File lines: the status bar, the server and the history all mean those.
    props.onCursor({ col: cursor.col, line: realLine(cursor.line) })
  }

  const ensureSegments = (from: number, to: number) => {
    if (!parsed) {
      return
    }
    for (let line = from; line <= to; line += 1) {
      // Recorded even with no captures: a line segmented twice collects a second copy.
      if (segmented.has(line)) {
        continue
      }
      segmented.add(line)
      for (const segment of segmentsIn(parsed, line, line)) {
        const list = byLine.get(segment.line)
        if (list) {
          list.push(segment)
        } else {
          byLine.set(segment.line, [segment])
        }
      }
    }
  }

  // As the parse holds it — what a segment's columns index.
  const parsedLine = (line: number): string | null => {
    const doc = parsed
    const at = doc?.starts[line]
    if (!doc || at === undefined) {
      return null
    }
    const next = doc.starts[line + 1]
    return next === undefined
      ? doc.content.slice(at)
      : doc.content.slice(at, next - 1)
  }

  // A crossing span stays out of the buckets: one over a thousand lines would cost an entry each.
  const problemsByLine = createMemo(() => {
    const byStart = new Map<number, ProblemRange[]>()
    const crossing: ProblemRange[] = []
    for (const problem of props.problemRanges) {
      const list = byStart.get(problem.line)
      if (list) {
        list.push(problem)
      } else {
        byStart.set(problem.line, [problem])
      }
      if (problem.endLine > problem.line) {
        crossing.push(problem)
      }
    }
    return { byStart, crossing }
  })

  // One highlight over the whole range *replaces* the syntax under it rather than layering.
  const overlay = (
    row: number,
    line: number,
    text: string,
    start: number,
    end: number,
    group: string,
    priority: number
  ) => {
    const paint = (from: number, to: number, base: number | null) => {
      if (to <= from) {
        return
      }
      const styleId = styleIdOver(group, base)
      if (styleId === null || styleId === undefined) {
        return
      }
      editor?.addHighlight(
        row,
        inCells({ end: to, priority, start: from, styleId }, text)
      )
    }
    let at = start
    for (const segment of byLine.get(line) ?? []) {
      if (segment.end <= at || segment.start >= end) {
        continue
      }
      const from = Math.max(segment.start, at)
      const to = Math.min(segment.end, end)
      paint(at, from, null)
      paint(from, to, segment.styleId)
      at = to
    }
    paint(at, end, null)
  }

  const markProblems = (row: number, line: number) => {
    if (!editor) {
      return
    }
    const { byStart, crossing } = problemsByLine()
    const starting = byStart.get(line)
    const covering = crossing.filter(
      (problem) => problem.line < line && line <= problem.endLine
    )
    if (!starting && covering.length === 0) {
      return
    }
    const text = parsedLine(line) ?? lineTextAt(row)
    const mark = (problem: ProblemRange, start: number, end: number) => {
      if (end <= start) {
        return
      }
      const group = problem.unnecessary
        ? 'unnecessary'
        : problem.deprecated
          ? 'deprecated'
          : problem.severity
      overlay(row, line, text, start, end, `druk.problem.${group}`, 100)
    }
    for (const problem of starting ?? []) {
      // A zero-width span still marks something visible.
      const end =
        problem.endLine === problem.line
          ? Math.max(problem.endCol, problem.col + 1)
          : Math.max(text.length, problem.col + 1)
      mark(problem, problem.col, end)
    }
    // A range ending at column 0 stops at the line above: `end <= start` leaves it unmarked.
    for (const problem of covering) {
      mark(problem, 0, line === problem.endLine ? problem.endCol : text.length)
    }
  }

  // Priority above the diagnostics': a conflict is not valid code, so every server reports it.
  const markConflict = (row: number, line: number) => {
    if (!editor || props.conflicts.length === 0) {
      return
    }
    const conflict = props.conflicts.find((one) => covers(one, line))
    if (!conflict) {
      return
    }
    const marker =
      line === conflict.start ||
      line === conflict.separator ||
      line === conflict.end ||
      line === conflict.base
    const group = marker
      ? CONFLICT_GROUPS.marker
      : line < (conflict.base ?? conflict.separator)
        ? CONFLICT_GROUPS.ours
        : CONFLICT_GROUPS.theirs
    const text = parsedLine(line) ?? lineTextAt(row)
    // Past the end of the text, or a blank line tints nothing.
    const end = Math.max(text.length, 1)
    // The marker rows carry a foreground of their own, so they do replace what is under them.
    if (marker) {
      const styleId = styleIdForGroup(group)
      if (styleId === null || styleId === undefined) {
        return
      }
      editor.addHighlight(
        row,
        inCells({ end, priority: 110, start: 0, styleId }, text)
      )
      return
    }
    overlay(row, line, text, 0, end, group, 110)
  }

  /** Tint the whole of the row a jump just landed on, over everything else. */
  const markFlash = (row: number, line: number) => {
    if (row !== flashRow()) {
      return
    }
    const text = parsedLine(line) ?? lineTextAt(row)
    // At least one cell, as a conflict's tint takes: a landing on a blank line
    // would otherwise tint nothing and say the jump went nowhere.
    overlay(row, line, text, 0, Math.max(text.length, 1), FLASH_GROUP, 120)
  }

  const applyWindow = (force = false) => {
    if (!editor) {
      return
    }
    syncViewport()
    if (force) {
      editor.clearAllHighlights()
      appliedLines.clear()
    }
    const { from, to } = logicalWindow(
      editor.scrollY,
      editor.height,
      wrapMap(),
      OVERSCAN
    )

    for (const line of appliedLines) {
      if (line < from || line > to) {
        editor.clearLineHighlights(line)
        appliedLines.delete(line)
      }
    }
    // The window is in buffer rows; everything it paints is keyed by the file's lines.
    for (let row = from; row <= to; row += 1) {
      if (appliedLines.has(row)) {
        continue
      }
      appliedLines.add(row)
      const line = realLine(row)
      ensureSegments(line, line)
      const segments = byLine.get(line)
      if (segments) {
        const text = parsedLine(line) ?? ''
        for (const segment of segments) {
          editor.addHighlight(row, inCells(segment, text))
        }
      }
      markProblems(row, line)
      markConflict(row, line)
      markFlash(row, line)
    }
  }

  // `handleScroll`, not a synthetic wheel: `ignoreScrollOutsideBounds` drops one before layout.
  const scrollByRows = (delta: number) => {
    if (!editor || delta === 0) {
      return
    }
    const view = editor as unknown as {
      handleScroll: (event: {
        scroll: { direction: 'up' | 'down'; delta: number }
      }) => void
    }
    view.handleScroll({
      scroll: { delta: Math.abs(delta), direction: delta > 0 ? 'down' : 'up' },
    })
    syncViewport()
    applyWindow()
  }

  // `scrollY` is read-only, and a scrollbar drag must not retarget the caret.
  const scrollToRow = (row: number) => {
    if (!editor) {
      return
    }
    scrollByRows(Math.max(0, Math.round(row)) - editor.scrollY)
  }

  const scrollTo = (wanted: number) =>
    scrollToRow(rowAtLine(Math.round(wanted)))

  // `setText` drops the view to the top, and placing the caret after scrolls the least that shows it.
  const keepingView = (rewrite: () => void) => {
    const wasTop = editor ? realLine(lineAtRow(editor.scrollY)) : 0
    rewrite()
    forgetLayout()
    if (!editor) {
      return
    }
    scrollToRow(rowAtLine(shownLine(wasTop)))
    const { height } = editor
    if (height <= 0) {
      return
    }
    const caret = rowAtLine(editor.logicalCursor.row)
    if (caret < editor.scrollY) {
      scrollToRow(caret)
    } else if (caret >= editor.scrollY + height) {
      scrollToRow(caret - height + 1)
    }
  }

  const dragTo = (screenY: number) => {
    const m = scrollMetrics()
    if (!m || !track) {
      return
    }
    const within = Math.max(
      0,
      Math.min(m.span, screenY - track.y - Math.floor(m.size / 2))
    )
    // In lines, matching the thumb: `m.height` counts rows, so subtracting it stops a wrap short.
    scrollTo(m.span === 0 ? 0 : (within / m.span) * Math.max(0, m.total - 1))
  }

  let cursorSync: ReturnType<typeof setTimeout> | null = null
  const scheduleCursorSync = () => {
    if (cursorSync) {
      return
    }
    cursorSync = setTimeout(() => {
      cursorSync = null
      // ↑/↓ emit no cursor-change event: this tick is the only chance to move the window.
      applyWindow()
      syncCursor()
      refreshMenu()
    }, 0)
  }

  // Anything drawn over the buffer claims those cells in the hit grid, so the click that
  // would have moved the caret never reaches the textarea: notes and cards place it here.
  const caretAt = (x: number, y: number) => {
    const el = editorEl()
    if (!editor || !el) {
      return
    }
    const display = viewTop() + (y - el.y)
    const line = lineAtRow(display)
    const { sources, widths } = lineLayout()
    let col = x - el.x - 1
    for (let row = display - 1; sources[row] === line; row -= 1) {
      col += widths[row] ?? 0
    }
    editor.setCursor(line, Math.max(0, Math.min(lineTextAt(line).length, col)))
    editor.requestRender()
    scheduleCursorSync()
  }

  // Viewport first, caret second: the buffer reveals a moved caret by the smallest scroll.
  const revealLine = (line: number, col: number) => {
    if (!editor) {
      return
    }
    const viewLine = shownLine(line)
    const row = rowAtLine(viewLine)
    const height = editor.height || editor.editorView.getViewport().height
    if (
      height > 0 &&
      (row < editor.scrollY || row >= editor.scrollY + height)
    ) {
      scrollToRow(row - Math.floor(height / 2))
    }
    editor.setCursor(viewLine, col)
    editor.requestRender()
    scheduleCursorSync()
  }

  // Viewport first, caret second, as in `revealLine`.
  const movePage = (direction: -1 | 1) => {
    if (!editor) {
      return
    }
    closeMenu()
    const rows = Math.max(1, editor.height - 1)
    const { row, col } = editor.logicalCursor
    const target = Math.max(
      0,
      Math.min(editor.lineCount - 1, row + direction * rows)
    )
    scrollTo(lineAtRow(editor.scrollY + direction * rows))
    editor.setCursor(target, col)
    scheduleCursorSync()
  }

  const applyFoldText = (text: string) => {
    if (!editor || editor.plainText === text) {
      return
    }
    refolding = true
    try {
      editor.setText(text)
    } finally {
      refolding = false
    }
  }

  const rememberFolds = (regions: FoldRegion[]) => {
    if (props.path === null || props.path === undefined) {
      return
    }
    if (regions.length > 0) {
      foldsFor.set(props.path, regions)
    } else {
      foldsFor.delete(props.path)
    }
  }

  const setFolds = (regions: FoldRegion[], keepAt?: number) => {
    if (!editor) {
      return
    }
    const source = docText()
    const line = keepAt ?? realLine(editor.logicalCursor.row)
    const { col } = editor.logicalCursor
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

  // `setText` drops the view to the top and the caret to 0; both are put back.
  const replaceBuffer = (wanted: string) => {
    if (!editor || editor.plainText === wanted) {
      return
    }
    const at = editor.cursorOffset
    keepingView(() => {
      applyFoldText(wanted)
      editor!.cursorOffset = Math.min(at, wanted.length)
    })
    applyWindow(true)
  }

  // Idempotent: the file's text once the buffer has taken an edit, fold model carried along.
  const syncDocument = (): string => {
    if (!editor) {
      return ''
    }
    // A gap is open: the buffer holds rows the file has not, so it may not be read back.
    const applied = folded()
    if (applied && applied.spacers.size > 0) {
      return applied.source
    }
    const view = baseFold()
    if (!view) {
      return editor.plainText
    }
    if (editor.plainText === view.text) {
      return view.source
    }
    const next = reconcileFolds(view, editor.plainText)
    const rebuilt =
      next.folds.length > 0 ? foldView(next.source, next.folds) : null
    setFolded(rebuilt)
    rememberFolds(rebuilt?.folds ?? [])
    replaceBuffer(rebuilt ? rebuilt.text : next.source)
    return next.source
  }

  // `props.content`, not `docText()`: on the closing pass no view is left holding the file.
  createEffect(
    on(cardGap, () => {
      if (!editor) {
        return
      }
      replaceBuffer(folded()?.text ?? baseFold()?.text ?? props.content)
    })
  )

  const clearFolds = () => {
    if (folded()) {
      setFolded(null)
    }
    if (props.path !== null && props.path !== undefined) {
      foldsFor.delete(props.path)
    }
  }

  const runFoldOp = (op: FoldOp) => {
    if (!editor || props.path === null || props.path === undefined) {
      return
    }
    const current = folded()?.folds ?? []
    const line = realLine(editor.logicalCursor.row)
    if (op === 'unfoldAll') {
      if (current.length > 0) {
        setFolds([], line)
      }
      return
    }
    if (op === 'foldAll') {
      const all = foldableRegions(docText(), props.tabSize)
      if (all.length > 0) {
        setFolds(all, line)
      }
      return
    }
    if (op === 'unfold') {
      const kept = current.filter((fold) => fold.start !== line)
      if (kept.length !== current.length) {
        setFolds(kept, line)
      }
      return
    }
    const region = innermostRegion(
      foldableRegions(docText(), props.tabSize),
      line
    )
    if (!region || current.some((fold) => fold.start === region.start)) {
      return
    }
    setFolds([...current, region], region.start)
  }

  // The block anchored *at* this line, not the innermost one covering it.
  const toggleFoldAt = (line: number) => {
    if (!editor) {
      return
    }
    const current = folded()?.folds ?? []
    if (current.some((fold) => fold.start === line)) {
      setFolds(
        current.filter((fold) => fold.start !== line),
        line
      )
      return
    }
    const region = foldableRegions(docText(), props.tabSize).find(
      (fold) => fold.start === line
    )
    if (region) {
      setFolds([...current, region], line)
    }
  }

  // The buffer lacks a fold's hidden lines: an edit on an anchor replays against a file with them.
  const releaseFoldForEdit = (key?: KeyEvent) => {
    const view = folded()
    if (!view || !editor || editor.hasSelection()) {
      return
    }
    const { row, col } = editor.logicalCursor
    const touched = new Set([realLine(row)])
    // The two keys that reach past their own line, onto what may be an anchor.
    if (key?.name === 'backspace' && col === 0 && row > 0) {
      touched.add(realLine(row - 1))
    }
    if (key?.name === 'delete' && col === lineTextAt(row).length) {
      touched.add(realLine(row + 1))
    }
    const kept = view.folds.filter((fold) => !touched.has(fold.start))
    if (kept.length !== view.folds.length) {
      setFolds(kept, realLine(row))
    }
  }

  // A bracketed paste never passes through a key handler, so the guard hangs on `handlePaste`.
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
      () => !editor || forPath !== props.path || docText() !== snapshot
    )
    if (result === STALE) {
      return
    }
    // Byte-for-byte the text that was highlighted, or every offset drifts.
    if (!editor || forPath !== props.path || docText() !== snapshot) {
      return
    }
    parsed = result
    byLine = new Map()
    segmented.clear()
    applyWindow(true)
  }

  // One parse at a time, newest text winning: a queue would start work already stale.
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
    if (!queuedParse) {
      return
    }
    queuedParse = false
    if (editor) {
      void runHighlight(docText())
    }
  }

  const rehighlight = (text: string) => {
    closeMenu()
    forgetLayout()
    parsed = null
    byLine = new Map()
    segmented.clear()
    void runHighlight(text)
  }

  // One undoable step; `row`/`col` are the file's own lines.
  const applyLineEdit = (content: string, row: number, col: number) => {
    if (!editor) {
      return
    }
    const view = folded()
    const next = view ? foldView(content, view.folds) : null
    keepingView(() => {
      setFolded(next)
      rememberFolds(next?.folds ?? [])
      applyFoldText(next ? next.text : content)
      editor!.setCursor(next ? shownLine(row) : row, col)
    })
    props.onChange(content)
    rehighlight(content)
    scheduleCursorSync()
  }

  const acceptCompletion = async () => {
    const match = matches()[menuSelected()]
    if (!match || !editor) {
      return closeMenu()
    }
    // Captured before the await: a new menu opened during the wait re-aims `menuAnchor`.
    const anchorCol = menuAnchor.col
    const acceptedRow = editor.logicalCursor.row
    closeMenu()

    let { item } = match
    const cached = resolvedItems.get(item)
    if (cached) {
      item = cached
    } else if (
      item.additionalTextEdits === undefined &&
      props.resolveCompletion
    ) {
      const resolved = await Promise.race([
        props.resolveCompletion(item),
        giveUpResolving(),
      ])
      if (resolved?.additionalTextEdits?.length) {
        item = { ...item, additionalTextEdits: resolved.additionalTextEdits }
      }
    }

    if (!editor || props.blocked) {
      return
    }
    const { row, col } = editor.logicalCursor
    if (row !== acceptedRow) {
      return
    }
    // File text and line: an auto-import edit aims at the file the server holds, folds and all.
    const applied = applyCompletion(
      docText(),
      { character: col, line: realLine(row) },
      anchorCol,
      item
    )
    applyLineEdit(
      applied.content,
      applied.cursor.line,
      applied.cursor.character
    )
  }

  // A folded anchor speaks for the whole block under it.
  const realRange = (span: { from: number; to: number }) => ({
    from: realLine(span.from),
    to: realSpanEnd(span.to),
  })

  const toggleCommentLines = () => {
    if (!editor) {
      return
    }
    const prefix = commentPrefix(props.filetype)
    if (!prefix) {
      return
    }
    const { from, to } = realRange(editRange(editor.plainText))
    const text = docText()
    const next = toggleComment(text, from, to, prefix)
    if (next !== text) {
      applyLineEdit(
        next,
        realLine(editor.logicalCursor.row),
        editor.logicalCursor.col
      )
    }
  }

  // A fold is line numbers into text these rewrite, so it cannot survive them.
  const withoutFolds = (): number => {
    const row = realLine(editor!.logicalCursor.row)
    if (folded()) {
      setFolds([], row)
    }
    return row
  }

  const moveSelectedLines = (delta: -1 | 1) => {
    if (!editor) {
      return
    }
    const { from, to } = realRange(editRange(editor.plainText))
    const { col } = editor.logicalCursor
    const row = withoutFolds()
    const next = moveLines(docText(), from, to, delta)
    if (next !== null) {
      applyLineEdit(next, row + delta, col)
    }
  }

  const duplicateSelectedLines = (follow: boolean) => {
    if (!editor) {
      return
    }
    const { from, to } = realRange(editRange(editor.plainText))
    const { col } = editor.logicalCursor
    const row = withoutFolds()
    applyLineEdit(
      duplicateLines(docText(), from, to),
      follow ? row + (to - from + 1) : row,
      col
    )
  }

  const deleteSelectedLines = () => {
    if (!editor) {
      return
    }
    const { from, to } = realRange(editRange(editor.plainText))
    const { col } = editor.logicalCursor
    withoutFolds()
    const next = removeLines(docText(), from, to)
    // The old selection is offsets into text that no longer exists.
    editor.clearSelection()
    const lines = next.split('\n')
    // The empty string after the file's final newline is no line to land on.
    const lastRow = Math.max(0, lines.length - (lines.at(-1) === '' ? 2 : 1))
    const row = Math.min(from, lastRow)
    applyLineEdit(next, row, Math.min(col, lines[row]?.length ?? 0))
  }

  const stepHistory = (kind: 'undo' | 'redo') => {
    if (!editor) {
      return
    }
    const at = kind === 'undo' ? history.undo() : history.redo()
    if (!at) {
      return
    }
    keepingView(() => {
      // The step replaces the file wholesale: the folds index text that no longer exists.
      if (folded()) {
        setFolded(null)
        rememberFolds([])
      }
      editor!.setText(at.content)
      editor!.cursorOffset = Math.min(at.cursor, at.content.length)
    })
    props.onChange(at.content)
    rehighlight(at.content)
    scheduleCursorSync()
  }

  createEffect(
    on(
      () => props.history?.key,
      () => {
        const request = props.history
        if (request) {
          stepHistory(request.kind)
        }
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => props.lineOp?.key,
      () => {
        switch (props.lineOp?.op) {
          case 'comment': {
            return toggleCommentLines()
          }
          case 'up': {
            return moveSelectedLines(-1)
          }
          case 'down': {
            return moveSelectedLines(1)
          }
          case 'duplicate': {
            return duplicateSelectedLines(true)
          }
          case 'delete': {
            return deleteSelectedLines()
          }
          default: {
            break
          }
        }
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => props.lineHome?.key,
      () => {
        if (!props.lineHome || !editor || props.blocked) {
          return
        }
        editor.gotoLineHome()
        applyWindow(true)
        scheduleCursorSync()
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => props.foldOp?.key,
      () => {
        const request = props.foldOp
        if (request) {
          runFoldOp(request.op)
        }
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => props.completionRequest?.key,
      () => {
        if (!props.completionRequest || !editor || props.blocked) {
          return
        }
        if (props.vim && vimState.mode !== 'insert') {
          return
        }
        void requestCompletions(true)
      },
      { defer: true }
    )
  )

  createEffect(() => {
    if (props.blocked || !props.focused) {
      closeMenu()
    }
  })

  const scheduleHighlight = () => {
    if (highlightTimer) {
      clearTimeout(highlightTimer)
    }
    highlightTimer = setTimeout(() => {
      if (editor) {
        void runHighlight(docText())
      }
    }, DEBOUNCE_MS)
  }

  const changeTrack = createMemo(() => {
    const height = trackHeight()
    if (height <= 0) {
      return []
    }
    return changeRows(displayGitLines(), trackTotal(), height)
  })

  const problemTrack = createMemo(() => {
    const height = trackHeight()
    if (height <= 0) {
      return []
    }
    return problemRows(displayProblems(), trackTotal(), height)
  })

  const jumpToRow = (row: number) => {
    const m = scrollMetrics()
    if (!m || !editor) {
      return
    }
    const line = Math.round((row / Math.max(1, m.height - 1)) * (m.total - 1))
    scrollTo(Math.max(0, line - Math.floor(editor.height / 2)))
  }

  // A track click is in screen rows; a drag on the scrollbar owns the pointer instead.
  const jumpFromTrack = (y: number) => {
    if (!dragging()) {
      jumpToRow(y - (editor?.y ?? 0))
    }
  }

  // The native buffer dies with the renderable, not the pane, and both timers touch it.
  const releaseEditor = () => {
    closeMenu()
    editor = undefined
    setEditorEl(null)
    if (highlightTimer) {
      clearTimeout(highlightTimer)
    }
    if (cursorSync) {
      clearTimeout(cursorSync)
    }
    highlightTimer = null
    cursorSync = null
  }

  onCleanup(releaseEditor)

  const copySelection = (): boolean => {
    const text = editor?.getSelectedText()
    if (!text) {
      return false
    }
    copyText(renderer, text, props.onStatus)
    return true
  }

  useKeys((key: KeyEvent) => {
    // preventDefault stops the textarea, not sibling handlers, so a claimed key is ignored here.
    if (key.defaultPrevented) {
      return
    }
    if (props.blocked || !editor || !props.focused) {
      return
    }
    // Before anything reads the caret; vim's command keys belong to the second handler.
    if (
      folded() &&
      (!props.vim || vimState.mode === 'insert') &&
      isEditingKey(key)
    ) {
      releaseFoldForEdit(key)
    }
    scheduleCursorSync()
    cursorBeforeEdit = documentOffset()

    const { sequence } = key
    lastTyped = typedChar(key)

    // Everything the menu does not claim falls through, so typing keeps filtering.
    if (menuOpen()) {
      const k = key.name
      const ctrlWalk = key.ctrl && (k === 'n' || k === 'p')
      if (k === 'down' || k === 'up' || ctrlWalk) {
        key.preventDefault()
        const total = Math.max(1, matches().length)
        const forward = k === 'down' || k === 'n'
        setMenuSelected((s) => (s + (forward ? 1 : total - 1)) % total)
        return
      }
      if ((k === 'tab' && !key.shift) || k === 'return' || k === 'enter') {
        if (matches().length > 0) {
          key.preventDefault()
          void acceptCompletion()
          return
        }
        // no return: the key types through
        closeMenu()
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

    // Most terminals send Ctrl+Space as a bare NUL, some with no ctrl flag — hence both spellings.
    if ((key.ctrl && key.name === 'space') || sequence === '\u0000') {
      key.preventDefault()
      if (props.complete && (!props.vim || vimState.mode === 'insert')) {
        void requestCompletions(true)
      }
      return
    }

    // OpenTUI's delete-to-line-start eats the newline above at column 0, where a Mac's
    // Cmd+Backspace — which arrives as this very chord — deletes nothing at all.
    if (
      key.ctrl &&
      key.name === 'u' &&
      !secondary(key) &&
      (!props.vim || vimState.mode === 'insert')
    ) {
      const at = editor.cursorOffset
      if (at === 0 || editor.plainText[at - 1] === '\n') {
        key.preventDefault()
        return
      }
    }

    // The textarea reads Ctrl+A as line-start; claimed first so it means select-all.
    if (key.ctrl && key.name === 'a') {
      key.preventDefault()
      editor.selectAll()
      applyWindow(true)
      return
    }

    if (
      editor.hasSelection() &&
      (!props.vim || vimState.mode === 'insert') &&
      movesCaret(key)
    ) {
      editor.clearSelection()
    }

    // The buffer inserts at the caret and leaves the selected text in place, so it deletes here.
    if (editor.hasSelection() && (!props.vim || vimState.mode === 'insert')) {
      const printable = typedChar(key)
      if (key.name === 'backspace' || key.name === 'delete' || printable) {
        key.preventDefault()
        editor.deleteSelection()
        if (printable) {
          editor.insertText(printable)
        }
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

    // Plain Ctrl+C/X: a second modifier makes it someone else's chord.
    if (key.ctrl && !secondary(key) && (key.name === 'c' || key.name === 'x')) {
      key.preventDefault()
      if (!copySelection()) {
        // Swallowed either way: letting it through would type a control character.
        if (key.name === 'c') {
          props.onQuit()
        }
        return
      }
      if (key.name === 'x') {
        editor.deleteSelection()
        applyWindow(true)
      }
      return
    }

    if (key.ctrl && key.name === 'v') {
      key.preventDefault()
      const text = readClipboard()
      if (text === null) {
        return
      }
      editor.deleteSelection()
      editor.insertText(text)
      return
    }

    // Ctrl+/ arrives as Ctrl+_, as '/' under kitty, and in Terminal.app not at all — hence Ctrl+L.
    if (
      key.ctrl &&
      (key.name === '_' || key.name === '/' || key.name === 'l')
    ) {
      key.preventDefault()
      toggleCommentLines()
      return
    }

    if (
      (key.option || key.meta) &&
      !key.ctrl &&
      (key.name === 'up' || key.name === 'down')
    ) {
      key.preventDefault()
      if (key.shift) {
        duplicateSelectedLines(key.name === 'down')
      } else {
        moveSelectedLines(key.name === 'up' ? -1 : 1)
      }
      return
    }

    // Ctrl+U/D page, for a MacBook with no page keys. Claimed from the textarea, which
    // reads them as delete-to-line-start and delete-forward; vim's own modes keep them.
    const pagerChord = key.ctrl && !(props.vim && vimState.mode !== 'insert')
    // No Ctrl+U here: macOS terminals send \x15 for Cmd+Backspace, so it is the buffer's
    // delete-to-line-start. Vim's normal mode still pages with it, from its own handler.
    const paged =
      key.name === 'pageup'
        ? -1
        : key.name === 'pagedown' || (pagerChord && key.name === 'd')
          ? 1
          : 0
    if (paged !== 0) {
      key.preventDefault()
      movePage(paged)
      return
    }

    if (props.vim && vimState.mode !== 'insert') {
      return
    }
    if (handleTyping(editor, key, props.tabSize)) {
      key.preventDefault()
    }
  })

  useKeys((key: KeyEvent, latin: string) => {
    if (key.defaultPrevented) {
      return
    }
    if (props.blocked || !props.vim || !editor || !props.focused) {
      return
    }
    const before = vimState.mode
    // The US name of the key, as `handleVimKey` reads it: a Cyrillic layout leaves `d` unread.
    const command =
      key.shift && /^[a-z]$/u.test(latin) ? latin.toUpperCase() : latin
    // As in the typing handler: an operator over a folded anchor opens it first.
    if (folded() && vimState.mode !== 'insert' && VIM_EDITS.has(command)) {
      releaseFoldForEdit()
    }
    const stepped = {
      centerLine: () => {
        if (!editor) {
          return
        }
        const row = rowAtLine(editor.logicalCursor.row)
        const height = editor.height || editor.editorView.getViewport().height
        if (height > 0) {
          scrollToRow(row - Math.floor(height / 2))
        }
      },
      redo: () => stepHistory('redo'),
      undo: () => stepHistory('undo'),
    }
    if (handleVimKey(editor, key, vimState, stepped)) {
      key.preventDefault()
    }
    if (vimState.mode !== before) {
      setVimMode(vimState.mode)
      props.onVimMode(vimState.mode)
    }
  })

  // The same textarea is reused: remounting it makes OpenTUI throw `Cannot remove target directly`.
  createEffect(
    on(
      () => props.path,
      () => {
        if (!editor) {
          return
        }
        scheduleCursorSync()
        const regions =
          props.path === null || props.path === undefined
            ? []
            : (foldsFor.get(props.path) ?? [])
        const view =
          regions.length > 0 ? foldView(props.content, regions) : null
        setFolded(view)
        rememberFolds(view?.folds ?? [])
        applyFoldText(view ? view.text : props.content)
        editor.setCursor(0, 0)
        history.reset({ content: props.content, cursor: 0 })
        editor.syntaxStyle = getSyntaxStyle()
        rehighlight(props.content)
      }
    )
  )

  createEffect(
    on(
      () => props.focused,
      (focused) => {
        if (focused) {
          editor?.focus()
        }
      }
    )
  )

  // An overlay's input takes renderer focus and hands nothing back, so the editor drops keys.
  createEffect(
    on(
      () => props.blocked,
      (blocked) => {
        if (!blocked && props.focused) {
          editor?.focus()
        }
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => [props.vim, props.path],
      () => {
        Object.assign(vimState, initialVimState())
        setVimMode(vimState.mode)
        props.onVimMode(props.vim ? 'normal' : null)
      }
    )
  )

  createEffect(
    on(
      // `paintedTheme`, not config: a live preview paints without writing the setting.
      () => [paintedTheme(), props.tabSize] as const,
      (curr, prev) => {
        if (!editor) {
          return
        }
        editor.syntaxStyle = getSyntaxStyle()
        // A full rehighlight races a cancelled preview and leaves its colors on.
        byLine = new Map()
        segmented.clear()
        if (parsed && prev && curr[1] === prev[1]) {
          applyWindow(true)
          return
        }
        void highlight(editor.plainText, props.path)
      },
      { defer: true }
    )
  )

  // Diagnostics arrive after the window painted its lines, which `appliedLines` would skip.
  createEffect(
    on(
      () => props.problemRanges,
      () => applyWindow(true),
      { defer: true }
    )
  )

  // The flash is one row of the window, but `appliedLines` skips a row it has
  // already painted — the same full reapply the diagnostics take carries the
  // tint in and, a second later, out again.
  createEffect(on(flashRow, () => applyWindow(true), { defer: true }))

  // Resolving one conflict moves every later one, so the whole window is repainted.
  createEffect(
    on(
      () => props.conflicts,
      () => applyWindow(true),
      { defer: true }
    )
  )

  // Keyed on reloadKey, never on content, so typing is never interrupted.
  createEffect(
    on(
      () => props.reloadKey,
      () => {
        if (editor && props.content !== docText()) {
          clearFolds()
          editor.setText(props.content)
          history.reset({ content: props.content, cursor: editor.cursorOffset })
          rehighlight(props.content)
        }
      },
      { defer: true }
    )
  )

  // Undoable, unlike the reload above: `setText` fires content-changed and its handler records.
  createEffect(
    on(
      () => props.edit?.key,
      () => {
        const { edit } = props
        if (!edit || !editor || edit.content === docText()) {
          return
        }
        const at = editor.cursorOffset
        // A replace rewrites lines this pane never showed, so the fold ranges are stale.
        clearFolds()
        editor.setText(edit.content)
        editor.cursorOffset = Math.min(at, edit.content.length)
        props.onChange(edit.content)
        rehighlight(edit.content)
        scheduleCursorSync()
      },
      { defer: true }
    )
  )

  // Not deferred (`druk file.ts:42` sets the target first); the microtask lets a switch land.
  createEffect(
    on(
      () => props.goto?.key,
      () => {
        const target = props.goto
        if (!target) {
          return
        }
        const { key } = target
        queueMicrotask(() => {
          if (!editor || props.goto?.key !== key) {
            return
          }
          // A jump names a file line, so the block hiding it opens.
          const view = folded()
          if (view && (view.display[target.line] ?? 0) < 0) {
            setFolds(
              view.folds.filter(
                (fold) => target.line <= fold.start || target.line > fold.end
              ),
              target.line
            )
          }
          revealLine(target.line, target.col)
          flashLanding(shownLine(target.line))
          editor.focus()
        })
      }
    )
  )

  return (
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
        when={props.path !== null && props.path !== undefined}
        fallback={
          <Welcome
            rootName={props.rootName}
            branch={props.branch}
            version={props.version}
          />
        }
      >
        {/* Drag capture on the wrapper: the pointer leaves a one-cell target on a stray pixel. */}
        <box
          ref={(el: { x: number; y: number; width: number }) => {
            host = el
          }}
          flexGrow={1}
          flexDirection="row"
          backgroundColor={ui.bg}
          onMouseDown={() => props.onFocus()}
          onMouseDrag={(event: MouseEvent) => {
            if (dragging()) {
              dragTo(event.y)
            }
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
              // Backgrounds, not text colors, and keyed by buffer row as every other
              // gutter map is: a visual row lands a screenful off once the file scrolls.
              new Map([
                [
                  cursorRow(),
                  { content: ui.currentLine, gutter: ui.currentLine },
                ],
              ])
            }
          >
            <textarea
              keyBindings={EDIT_KEYS}
              ref={(el) => {
                editor = el
                setEditorEl(el)
                ignoreScrollOutsideBounds(el)
                ownScrolling(el, () => props.scrollPastEnd)
                selectOnMultiClick(el, () => {
                  scheduleCursorSync()
                  copySelection()
                })
                // LineNumberRenderable dirties only *itself*; the cached child must hear it too.
                el.on('line-info-change', () => {
                  gutter?.gutter?.requestRender?.()
                  forgetLayout()
                  setWrapKey((key) => key + 1)
                })
                afterResize(el, () => {
                  applyLineSigns()
                  syncViewport()
                  forgetLayout()
                  applyWindow(true)
                  // Notes and fold targets position against the pane; zero until the first layout.
                  setWrapKey((key) => key + 1)
                })
                allowSelectionIn(el)
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
              // No selection colour means OpenTUI inverts the cell — black under `transparent`.
              selectionBg={ui.treeSelectedBg}
              // `blinking: true` restated: this replaces the whole option object, not one field.
              cursorStyle={{
                blinking: true,
                style: props.vim
                  ? vimMode() === 'insert'
                    ? 'line'
                    : 'block'
                  : props.cursorStyle,
              }}
              wrapMode={props.wrap ? 'word' : 'none'}
              // A code point, not a width: a tab size paints control chars the terminal drops.
              tabIndicator="█"
              tabIndicatorColor={ui.indentGuide}
              flexGrow={1}
              paddingLeft={1}
              onContentChange={() => {
                // A fold rewriting the buffer is the one reported change that records nothing.
                if (!editor || refolding) {
                  return
                }
                const content = syncDocument()
                history.record(
                  { content, cursor: cursorBeforeEdit },
                  Date.now()
                )
                props.onChange(content)
                scheduleHighlight()
              }}
              onMouse={() => scheduleCursorSync()}
              onCursorChange={() => {
                applyWindow()
                syncCursor()
                // A mouse click lands here with no key event; the menu must see the caret leave.
                scheduleCursorSync()
              }}
            />
          </line_number>
          <Notes each={inlineNotes()} onPress={caretAt} />
          {/* Above the inline notes' zIndex, or the text drawn after a covered row shows through. */}
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
                  {(line) => (
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
          {/* Below the review card, above the inline notes it covers. */}
          <Show when={problemCard()}>
            {(card: () => NonNullable<ReturnType<typeof problemCard>>) => (
              <box
                position="absolute"
                top={card().top}
                left={0}
                width={card().width}
                zIndex={19}
                flexDirection="column"
                backgroundColor={ui.panelBg}
                paddingLeft={1}
                paddingRight={1}
                border
                borderStyle="rounded"
                borderColor={card().color}
                title={card().heading}
                onMouseDown={(event: MouseEvent) => caretAt(event.x, event.y)}
              >
                <For each={card().lines}>
                  {(line) => (
                    <text
                      fg={ui.text}
                      bg={ui.panelBg}
                      wrapMode="none"
                      content={line}
                    />
                  )}
                </For>
              </box>
            )}
          </Show>
          {/* Painting nothing: the gutter drew the glyph, and a box is what reports a click. */}
          <For each={foldMarkers()}>
            {(marker) => (
              <box
                position="absolute"
                top={marker.top}
                left={marker.left}
                width={1}
                height={1}
                zIndex={6}
                onMouseDown={() => toggleFoldAt(marker.line)}
                onMouseOver={() => setHotFold(marker.line)}
                onMouseOut={() =>
                  setHotFold((line) => (line === marker.line ? null : line))
                }
              />
            )}
          </For>
          <Notes
            each={foldNotes().map((note) => ({
              ...note,
              color: note.hint ? ui.faint : ui.dim,
            }))}
            onPress={caretAt}
          />
          <Show when={menuBox()}>
            {(at: () => NonNullable<ReturnType<typeof menuBox>>) => (
              <CompletionMenu
                matches={matches()}
                selected={menuSelected()}
                detail={menuInfo()?.detail ?? ''}
                filetype={props.filetype}
                layout={at().menu}
                top={at().top}
                left={at().left}
              />
            )}
          </Show>
          <Track
            rows={problemTrack()}
            colors={SEVERITY_COLOR}
            glyph="•"
            hover={problemsHover}
            onJump={jumpFromTrack}
          />
          <Track
            rows={changeTrack()}
            colors={CHANGE_COLORS}
            glyph="▎"
            hover={changesHover}
            onJump={jumpFromTrack}
          />
          {/* Always a column, empty or not: a file growing past the pane would otherwise
              add one and re-wrap every line. */}
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
              {/* A space, not a glyph hidden in the background: `transparent` has none. */}
              {(filled) => (
                <text
                  fg={
                    scrollbarHover.hovered() || dragging()
                      ? ui.dim
                      : ui.scrollbar
                  }
                  bg={ui.bg}
                  content={filled() ? '█' : ' '}
                />
              )}
            </Index>
          </box>
        </box>
      </Show>
    </box>
  )
}
