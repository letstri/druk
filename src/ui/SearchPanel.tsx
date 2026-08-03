import { basename, relative } from 'node:path'

import { TextAttributes } from '@opentui/core'
import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'

import { readFile } from '../core/fs'
import type { Context, Match, SearchOptions } from '../core/search'
import { buildQuery, contextIn, searchProject, searchText } from '../core/search'
import {
  computeHighlights,
  filetypeForPath,
  segmentsIn,
  STALE,
  styleForId,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { windowAround } from './list'
import { modalWidth, PAD } from './modal'
import { ModalPanel, topInset } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export type SearchScope = 'file' | 'project'

export interface SearchPanelProps {
  scope: SearchScope
  rootDir: string
  activePath: string | null
  activeContent: string
  /** What the editor had selected, so the obvious query is already typed. */
  initialQuery?: string
  /** Open with the replacement field already showing. */
  replacing?: boolean
  /**
   * Open-buffer text the project scan reads instead of the disk, so the rows
   * show what a replace would act on. A function: each rescan wants the
   * buffers as they are now, not as they were when the panel opened.
   */
  buffers?: () => ReadonlyMap<string, string>
  /**
   * True while a modal owns the keyboard above the panel. Every key handler
   * in the app hears every key — nothing layers them — so the panel has to
   * stand down itself or Enter on a confirm would also apply the selected match.
   */
  suspended?: boolean
  onPick: (match: Match) => void
  /** Replace the selected match only. */
  onReplaceOne?: (match: Match, replacement: string) => void
  /** Replace every match in scope — the whole file, or the whole project. */
  onReplaceAll?: (query: string, replacement: string, options: SearchOptions) => void
  onClose: () => void
}

export const MIN_QUERY = 2

/** Lines either side of the selected match in the preview, at its smallest. */
const MIN_CONTEXT = 2
/** …and at its largest: past this the list is the thing being starved. */
const MAX_CONTEXT = 9

/**
 * A preview needs the lines around the hit to be worth reading at all, and a
 * three-line window rarely is. Below this height there is no room for one.
 */
const PREVIEW_MIN_HEIGHT = 24

/** Rows left unclaimed, so the panel never grows into the edge of the screen. */
const SLACK = 2

/**
 * Documents past this size are shown uncoloured. Parsing one costs a worker
 * round-trip on every step through the results, and the preview is eleven lines
 * of a file whose colour nobody is reading it for.
 */
const MAX_HIGHLIGHT_BYTES = 512 * 1024

/** A run of preview text painted as one `<text>`. */
interface Span {
  text: string
  fg?: string
  attributes?: number
}

/**
 * A project scan reads every file in the tree — around 90ms across 2 600 files, and
 * it grows from there. Running that on the keystroke means each character freezes
 * the editor, so the scan waits for the typing to settle. In-file search is only
 * string work on the open buffer, so it stays immediate.
 */
const SCAN_DEBOUNCE_MS = 140

/**
 * A file heading, or one of its matches. `at` indexes into `matches()` — a heading
 * points at the first of its own, so the summary and preview read the same off both.
 * Selection lands on a match, or on a heading once it is folded and stands in for them.
 */
type Row =
  | { kind: 'file'; path: string; count: number; at: number; folded: boolean }
  | { kind: 'match'; match: Match; at: number }

/** An open file's heading is scenery; a folded one stands in for its matches. */
const selectable = (row: Row) => row.kind === 'match' || row.folded

/**
 * The pieces of a painted line between columns `from` and `to`, splitting whichever
 * spans straddle them. Cutting the hit out of its coloured line and trimming the
 * line to the panel's width are the same operation on different bounds.
 */
function sliceSpans(spans: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = []
  let col = 0
  for (const span of spans) {
    const start = Math.max(from, col)
    const end = Math.min(to, col + span.text.length)
    if (end > start) out.push({ ...span, text: span.text.slice(start - col, end - col) })
    col += span.text.length
  }
  return out
}

export function SearchPanel(props: SearchPanelProps) {
  const dimensions = useTerminalDimensions()
  // Read once: the panel is mounted fresh each time it opens, and re-reading would
  // fight whatever has been typed since.
  const opened = props.initialQuery ?? ''
  const [query, setQuery] = createSignal(opened)
  /** The query the results belong to; trails `query` while a project scan is pending. */
  const [scanned, setScanned] = createSignal(opened)
  const [replacement, setReplacement] = createSignal('')
  const [replacing, setReplacing] = createSignal(props.replacing ?? false)
  /**
   * Which of the two inputs takes typing. In file scope the mount order used to
   * decide this — the replace field appears on Tab and arrives focused — but a
   * panel opened with both fields showing has no such order, so it is said
   * outright. Starts on the replacement only when a selection prefilled the
   * query — otherwise the query is the thing not yet typed.
   */
  const [field, setField] = createSignal<'query' | 'replace'>(
    props.replacing && props.initialQuery ? 'replace' : 'query',
  )
  /** Row the selection is nearest to, not the match: rows outnumber matches. */
  const [index, setIndex] = createSignal(0)
  /** Paths whose matches are hidden behind their heading. */
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(new Set())
  const [options, setOptions] = createSignal<SearchOptions>({})

  let scanTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (scanTimer) clearTimeout(scanTimer)
  })

  const type = (value: string) => {
    setQuery(value)
    setIndex(0)
    // The folds belong to the result set they were made in; carrying them over
    // leaves a fresh search with files already hidden for no visible reason.
    setFolded(new Set<string>())
    if (props.scope !== 'project') return setScanned(value)
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => setScanned(value), SCAN_DEBOUNCE_MS)
  }

  const pending = () => props.scope === 'project' && scanned() !== query()

  // Bumped after a project-scope apply: the scan reads disk and buffers, which
  // no signal covers, so freshness after our own replace is asked for by hand.
  const [generation, setGeneration] = createSignal(0)

  const matches = createMemo(() => {
    generation()
    const q = scanned()
    if (q.length < MIN_QUERY) return []
    return props.scope === 'project'
      ? searchProject(props.rootDir, q, options(), undefined, props.buffers?.())
      : searchText(props.activeContent, q, props.activePath ?? '', options())
  })

  /**
   * Matches grouped under their file. Grouping is what buys the line text the whole
   * width: the old flat list spent 34 columns repeating the same path on every row.
   */
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = []
    const all = matches()
    const hidden = folded()
    for (let i = 0; i < all.length; i++) {
      const match = all[i]!
      if (props.scope === 'project' && match.path !== all[i - 1]?.path) {
        let count = 0
        while (all[i + count]?.path === match.path) count++
        const shut = hidden.has(match.path)
        out.push({ kind: 'file', path: match.path, count, at: i, folded: shut })
        if (shut) {
          i += count - 1
          continue
        }
      }
      out.push({ kind: 'match', match, at: i })
    }
    return out
  })

  /** Index into `rows()` of the selected row, or -1 when there is nothing to select. */
  const selected = createMemo(() => {
    const all = rows()
    if (all.length === 0) return -1
    const from = Math.min(index(), all.length - 1)
    for (let i = from; i < all.length; i++) if (selectable(all[i]!)) return i
    for (let i = from - 1; i >= 0; i--) if (selectable(all[i]!)) return i
    return -1
  })

  const cursor = () => rows()[selected()]
  /** The selected match — a folded heading answers with the first it hides. */
  const current = () => matches()[cursor()?.at ?? -1]

  const move = (step: number) => {
    const all = rows()
    if (all.length === 0) return
    let at = selected()
    for (let n = 0; n < all.length; n++) {
      at = (at + step + all.length) % all.length
      if (selectable(all[at]!)) break
    }
    setIndex(at)
  }

  /**
   * Every file at once: fold them all, or open them all again once they are. What
   * it buys is a list of files to walk with ↑↓ — with a hundred hits across ten
   * files, reaching the next file otherwise means scrolling past every match in
   * this one.
   */
  const toggleFoldAll = () => {
    const paths = [...new Set(matches().map(match => match.path))]
    const shut = paths.length > 0 && paths.every(path => folded().has(path))
    // The file the selection is in, read before the rows move under it: afterwards
    // the same index is a different row, and the selection would follow it.
    const row = cursor()
    const path = row && (row.kind === 'file' ? row.path : row.match.path)
    setFolded(shut ? new Set<string>() : new Set(paths))
    const heading = rows().findIndex(other => other.kind === 'file' && other.path === path)
    if (heading >= 0) setIndex(shut ? heading + 1 : heading)
  }

  const toggleFold = () => {
    const row = cursor()
    if (!row) return
    const path = row.kind === 'file' ? row.path : row.match.path
    const folding = !folded().has(path)
    setFolded(prev => {
      const next = new Set(prev)
      if (folding) next.add(path)
      else next.delete(path)
      return next
    })
    // The rows just moved under the selection: folding takes its matches away, so
    // land on the heading that now stands for them, and unfolding gives them back.
    const heading = rows().findIndex(row => row.kind === 'file' && row.path === path)
    if (heading >= 0) setIndex(folding ? heading : heading + 1)
  }

  /**
   * The widest of the modals, and deliberately so: every other one shows short
   * labels, while this one shows lines of source that mean nothing truncated.
   */
  const width = () => modalWidth(dimensions().width, 0.86, 64, 160)
  /** Inside the border *and* the padding — miss either and every long row wraps. */
  const contentWidth = () => width() - 2 - PAD * 2

  /**
   * The text that would take each hit's place, or '' when nothing would. Every row
   * shows it beside the hit as it is typed, so the result is visible before anything
   * is written — which is the whole reason to look at the list before pressing Enter.
   */
  const swap = () => (replacing() ? replacement() : '')

  /**
   * The selected match's whole file, or null when it cannot be read. The preview is
   * a window on it and the highlighter wants the document rather than the window:
   * tree-sitter's error recovery misreads a fragment that starts mid-expression, so
   * a slice would come back with half its captures missing (the same reason the
   * diff view highlights the full texts and remaps).
   */
  type Source = { path: string; text: string } | null
  const source = createMemo<Source, Source>(
    () => {
      const match = current()
      if (!match) return null
      if (props.scope !== 'project') return { path: match.path, text: props.activeContent }
      try {
        return { path: match.path, text: readFile(match.path) }
      } catch {
        return null // deleted or unreadable since the scan
      }
    },
    null,
    // Stepping between two matches in one file is not a new document; without this
    // the parse below would be restarted, and the colours dropped, on every step.
    { equals: (a, b) => a?.path === b?.path && a?.text === b?.text },
  )

  /** Rows the panel spends on everything that is neither the list nor the preview. */
  const chromeRows = () => 7 + topInset(dimensions().height) + (replacing() ? 1 : 0)

  /**
   * How far the preview reaches either side of the hit. It grows with the terminal:
   * the preview is how you decide whether this is the match you were after, and on
   * a tall window there is no reason to answer that from five lines.
   */
  const contextLines = () => {
    const spare = dimensions().height - chromeRows() - SLACK
    return Math.max(MIN_CONTEXT, Math.min(MAX_CONTEXT, Math.floor(spare / 5)))
  }

  /** Rows the preview spends: the lines themselves plus the gap and rule above them. */
  const previewRows = () => contextLines() * 2 + 3

  /** Surroundings of the selected match, or null when there is no room to show them. */
  const preview = createMemo<Context | null>(() => {
    const match = current()
    const file = source()
    if (!match || !file || dimensions().height < PREVIEW_MIN_HEIGHT) return null
    return contextIn(file.text, match.line, contextLines())
  })

  /** The parsed document behind the preview's colours, once it lands. */
  const [parsed, setParsed] = createSignal<Highlighted | null>(null)

  createEffect(
    on(source, file => {
      // Dropped up front: the previous file's captures are wrong for this one, and
      // colouring one file's lines with another's is worse than no colour at all.
      setParsed(null)
      if (!file || file.text.length > MAX_HIGHLIGHT_BYTES) return
      let dropped = false
      onCleanup(() => {
        dropped = true
      })
      void (async () => {
        const doc = await computeHighlights(file.text, filetypeForPath(file.path), 2, () => dropped)
        if (!dropped && doc !== STALE) setParsed(doc)
      })()
    }),
  )

  /**
   * Rows the list may use. Named apart from `modal.ts`'s `listRows` on purpose: this
   * one has a preview to make room for. The panel has to fit a short terminal, and
   * the list gives way before the preview does — a preview of nothing is useless,
   * but a list of two rows is still a list.
   */
  const resultRows = () => {
    const chrome = chromeRows() + SLACK + (preview() ? previewRows() : 0)
    return Math.max(2, Math.min(18, dimensions().height - chrome))
  }

  /** The window of rows on screen, kept over the selected row. */
  // Lead 2: one row of lead-in, so the file heading above the selection stays visible.
  const windowed = createMemo(() => windowAround(rows(), selected(), resultRows(), 2))

  /** Ctrl+C / Ctrl+W / Ctrl+R flips an option; the results recompute from scratch. */
  const toggleOption = (name: keyof SearchOptions) => {
    setOptions(prev => ({ ...prev, [name]: !prev[name] }))
    setIndex(0)
    setFolded(new Set<string>())
  }
  const OPTION_KEYS: Partial<Record<string, keyof SearchOptions>> = {
    c: 'caseSensitive',
    w: 'wholeWord',
    r: 'regex',
  }

  useKeys((key: KeyEvent) => {
    if (props.suspended) return
    const k = key.name
    const option = key.ctrl ? OPTION_KEYS[k] : undefined
    if (option) {
      key.preventDefault()
      toggleOption(option)
    } else if (k === 'up') {
      key.preventDefault()
      move(-1)
    } else if (k === 'down') {
      key.preventDefault()
      move(1)
    } else if (k === 'tab' && key.shift && props.scope === 'project') {
      key.preventDefault()
      toggleFoldAll()
      // In file scope Tab is the replace toggle, as it has always been.
    } else if (k === 'tab' && props.scope === 'file' && props.onReplaceAll) {
      key.preventDefault()
      const next = !replacing()
      setReplacing(next)
      setField(next ? 'replace' : 'query')
      // Replacing across the project, Tab moves between the two fields — the only
      // way to edit the query when both are up, so folding gives it up here.
    } else if (k === 'tab' && props.scope === 'project' && replacing()) {
      key.preventDefault()
      setField(f => (f === 'query' ? 'replace' : 'query'))
      // Plain project search spends Tab on folding, as it always has.
    } else if (k === 'tab' && props.scope === 'project') {
      key.preventDefault()
      toggleFold()
    } else if (key.ctrl && k === 'a' && replacing() && props.onReplaceAll) {
      key.preventDefault()
      props.onReplaceAll(query(), replacement(), options())
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      // A heading is only ever selected while folded, where Enter is the way back in.
      if (cursor()?.kind === 'file') return toggleFold()
      const match = current()
      if (!match) return
      // Replacing one match at a time is the point of the mode; the whole file goes
      // through Ctrl+A, which is the harder move to make by accident.
      if (replacing() && props.onReplaceOne) {
        props.onReplaceOne(match, replacement())
        if (props.scope === 'project') setGeneration(g => g + 1)
      } else props.onPick(match)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  /** The active toggles, said the way the footer names them. */
  const flags = () => {
    const on = options()
    const parts = [on.caseSensitive && 'case', on.wholeWord && 'word', on.regex && 'regex']
    const active = parts.filter(Boolean)
    return active.length > 0 ? ` · ${active.join(' ')}` : ''
  }

  const summary = () => {
    if (query().length < MIN_QUERY) return `Type at least 2 characters${flags()}`
    // Say so rather than showing the previous query's count as if it were current.
    if (pending()) return `Searching…${flags()}`
    if (options().regex && !buildQuery(scanned(), options())) return `Invalid regex${flags()}`
    const all = matches()
    if (all.length === 0) return `No matches${flags()}`
    const files = new Set(all.map(m => m.path)).size
    const capped = all.length >= 200 ? '+' : ''
    const where = props.scope === 'project' ? ` in ${files} file${files === 1 ? '' : 's'}` : ''
    return `${(cursor()?.at ?? 0) + 1} of ${all.length}${capped}${where}${flags()}`
  }

  const label = (path: string) => relative(props.rootDir, path) || basename(path)

  /**
   * The line, cut to `room` around the match rather than from column 0. A hit 200
   * columns into a minified line was simply not in the old fixed 38-column slice, so
   * the row showed the query's own result without the query in it.
   */
  const sliceAround = (text: string, col: number, room: number) => {
    if (text.length <= room) return { text, col, cut: false }
    const start = Math.max(0, Math.min(col - 12, text.length - room))
    return { text: text.slice(start, start + room), col: col - start, cut: start > 0 }
  }

  /**
   * Preview line `at` as coloured pieces: the parsed document's segments, with the
   * gaps between them left in `plain`. A segment carrying only a background — the
   * indent guides — is passed over, or the preview would come out striped with a
   * fill nothing here asked for.
   */
  const painted = (line: string, at: number, plain: string): Span[] => {
    // Read so the pieces are rebuilt when the theme changes: the style ids a
    // segment carries are the previous theme's until the table behind them is.
    paintedTheme()
    const doc = parsed()
    const out: Span[] = []
    let col = 0
    for (const segment of doc ? segmentsIn(doc, at, at) : []) {
      const style = styleForId(segment.styleId)
      const fg = typeof style?.fg === 'string' ? style.fg : undefined
      if (!style || !fg || segment.start < col) continue
      if (segment.start > col) out.push({ text: line.slice(col, segment.start), fg: plain })
      out.push({
        text: line.slice(segment.start, segment.end),
        fg,
        attributes:
          (style.bold ? TextAttributes.BOLD : 0) | (style.italic ? TextAttributes.ITALIC : 0),
      })
      col = segment.end
    }
    if (col < line.length) out.push({ text: line.slice(col), fg: plain })
    return out
  }

  /** Columns of a preview line left for text, after its line number. */
  const previewRoom = () => contentWidth() - 6

  /**
   * Columns scrolled off the left of the hit's own line, so a match 200 columns
   * into a minified line is in the preview at all. Only that line moves: shifting
   * its neighbours by the same amount empties them, and a preview of blank rows
   * says less about the hit than an unaligned one does.
   */
  const previewShift = () => {
    const match = current()
    if (!match || match.col + match.length <= previewRoom()) return 0
    return Math.max(0, match.col - 12)
  }

  /**
   * A preview line, ready to paint: syntax colours, and on the selected match's own
   * line the hit picked out — struck through beside its replacement once there is
   * one, so the preview and the row above it agree about what the file will say.
   */
  const previewLine = (line: string, at: number): Span[] => {
    const match = current()
    const hit = match && at === match.line
    const spans = painted(line, at, hit ? ui.text : ui.dim)
    if (!hit) return sliceSpans(spans, 0, previewRoom())
    const shift = previewShift()
    const room = previewRoom() - (shift > 0 ? 1 : 0)
    const cut: Span[] = shift > 0 ? [{ text: '…', fg: ui.dim }] : []
    const text = line.slice(match.col, match.col + match.length)
    return [
      ...cut,
      ...sliceSpans(
        [
          ...sliceSpans(spans, shift, match.col),
          swap()
            ? { text, fg: ui.gitDeleted, attributes: TextAttributes.STRIKETHROUGH }
            : { text, fg: ui.accent, attributes: TextAttributes.BOLD },
          ...(swap() ? [{ text: swap(), fg: ui.gitAdded, attributes: TextAttributes.BOLD }] : []),
          ...sliceSpans(spans, match.col + match.length, line.length),
        ],
        0,
        room,
      ),
    ]
  }

  return (
    <ModalPanel
      zIndex={150}
      align="top"
      width={width()}
      title={props.scope === 'project' ? ' Search in project ' : ' Search in file '}
    >
      <TextInput
        value={query()}
        placeholder="Search…"
        focused={!props.suspended && (!replacing() || field() === 'query')}
        onInput={type}
      />
      <Show when={replacing()}>
        <TextInput
          value={replacement()}
          placeholder="Replace with…"
          focused={!props.suspended && field() === 'replace'}
          onInput={setReplacement}
        />
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content={summary()} />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />

      <For each={windowed().rows}>
        {(row, i) => {
          const at = () => windowed().start + i()
          const active = () => at() === selected()

          if (row.kind === 'file') {
            const bg = () => (active() ? ui.treeSelectedBg : ui.solidBarBg)
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text
                  fg={ui.folder}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.folded ? '▸' : '▾'} ${label(row.path)} `}
                  attributes={TextAttributes.BOLD}
                />
                {/* Spacer first, so the count lands on the right edge. */}
                <box flexGrow={1} backgroundColor={bg()} />
                <text
                  fg={active() ? ui.accent : ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.count} match${row.count === 1 ? '' : 'es'} `}
                />
              </box>
            )
          }

          const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
          const gutter = () => `${row.match.line + 1}`.padStart(5)
          // Room left after the marker (1), the line number and its gap (7) and the
          // cut marker (1). One column over and the row wraps onto a second line —
          // and the replacement shown beside the hit takes its share of it too.
          const cut = () =>
            sliceAround(row.match.text, row.match.col, contentWidth() - 9 - swap().length)
          const head = () => cut().text.slice(0, cut().col)
          const hit = () => cut().text.slice(cut().col, cut().col + row.match.length)
          const tail = () => cut().text.slice(cut().col + row.match.length)

          return (
            <box flexDirection="row" backgroundColor={bg()}>
              <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌' : ' '} />
              <text
                fg={active() ? ui.accent : ui.faint}
                bg={bg()}
                flexShrink={0}
                content={`${gutter()}  `}
              />
              <text fg={ui.dim} bg={bg()} flexShrink={0} content={cut().cut ? '…' : ''} />
              <text fg={active() ? ui.text : ui.dim} bg={bg()} flexShrink={0} content={head()} />
              {/* The hit itself, so the eye lands on why the row is here — struck
                    through once there is a replacement to put in its place. */}
              <text
                fg={swap() ? ui.gitDeleted : ui.accent}
                bg={bg()}
                flexShrink={0}
                content={hit()}
                attributes={swap() ? TextAttributes.STRIKETHROUGH : TextAttributes.BOLD}
              />
              <Show when={swap()}>
                <text
                  fg={ui.gitAdded}
                  bg={bg()}
                  flexShrink={0}
                  content={swap()}
                  attributes={TextAttributes.BOLD}
                />
              </Show>
              <box flexGrow={1} backgroundColor={bg()}>
                <text fg={active() ? ui.text : ui.dim} bg={bg()} content={tail()} />
              </box>
            </box>
          )
        }}
      </For>

      <Show when={preview()}>
        {(around: () => Context) => (
          <box flexDirection="column" marginTop={1}>
            {/* The list and the preview are both source lines on near-identical
                  backgrounds; without a rule between them the eye reads one column of
                  code where there are two unrelated ones. */}
            <text
              fg={ui.border}
              bg={ui.panelBg}
              content={'─'.repeat(Math.max(0, contentWidth()))}
            />
            <box flexDirection="column" backgroundColor={ui.solidBg}>
              {/* Index, not For: the rows are a fixed column whose *values* change as
                  the selection moves, and keying by value tears every line down and
                  rebuilds it on each step. */}
              <Index each={around().lines}>
                {(line, i) => {
                  const at = () => around().start + i
                  const isMatch = () => at() === current()?.line
                  const bg = () => (isMatch() ? ui.currentLine : ui.solidBg)
                  return (
                    <box flexDirection="row" backgroundColor={bg()}>
                      <text
                        fg={ui.gutter}
                        bg={bg()}
                        flexShrink={0}
                        content={`${`${at() + 1}`.padStart(5)} `}
                      />
                      <Index each={previewLine(line(), at())}>
                        {span => (
                          <text
                            fg={span().fg}
                            bg={bg()}
                            flexShrink={0}
                            content={span().text}
                            attributes={span().attributes}
                          />
                        )}
                      </Index>
                      {/* Spacer, so the line's background reaches the panel's edge. */}
                      <box flexGrow={1} backgroundColor={bg()} />
                    </box>
                  )
                }}
              </Index>
            </box>
          </box>
        )}
      </Show>

      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          props.onReplaceAll
            ? replacing()
              ? '↑↓ move · Enter replace · Ctrl+A replace all · Tab back · Esc close'
              : '↑↓ move · Enter jump · Tab replace · Ctrl+C/W/R case/word/regex · Esc close'
            : '↑↓ move · Enter jump · Tab fold · Shift+Tab all · Ctrl+C/W/R case/word/regex · Esc close'
        }
      />
    </ModalPanel>
  )
}
