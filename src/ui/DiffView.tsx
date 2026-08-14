import type { DiffRenderable, KeyEvent, TreeSitterClient } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'

import { unifiedDiff } from '../core/diff'
import type { UnifiedDiff } from '../core/diff'
import type { ComparisonFileStatus, FileStatus } from '../core/git'
import {
  computeHighlights,
  DIFF_FILLER,
  filetypeForPath,
  getSyntaxStyle,
  highlightClient,
  STALE,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { useKeys } from './useKeys'

export type DiffMode = 'inline' | 'split'
export type DiffFileStatus = FileStatus | ComparisonFileStatus

export interface DiffFile {
  path: string
  /** Shown to the user; `path` keys the workspace. */
  rel: string
  oldPath?: string | null
  status: DiffFileStatus
  oldText: string
  newText: string
}

export interface DiffViewProps {
  /** The one change on screen. Which one is the source-control panel's cursor to
   * say: this pane scrolls and toggles layout, it does not page. */
  file: DiffFile
  mode: DiffMode
  /**
   * `page` fills the editor slot and owns keys. `section` is one file in the
   * all-changes scroll: as tall as its patch, no header (the parent draws those
   * so they can stick and fold), silent on the keyboard — the parent scrolls,
   * toggles the layout and closes.
   */
  variant?: 'page' | 'section'
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** The page shares the editor's focus slot; unfocused, its keys stay dead. */
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onToggleMode?: () => void
  /** Esc: closes the page, or hands the focus back to whatever opened it. */
  onClose?: () => void
  /** Commit detail pages through its files with ←/→; ordinary diffs leave them dead. */
  onMoveFile?: (delta: number) => void
  /** What Esc does now, for the hint line — the caller owns the behaviour. */
  escLabel?: string
}

/**
 * Past this many bytes across the two sides, syntax color is off for the page:
 * the renderable applies highlights as one native span edit per capture, and a
 * package-lock-sized document feeds it millions — the main thread stalls for
 * minutes, which reads as a crash (issue #66). GitHub draws the same line at
 * 512 KB per file. Bytes, not lines, because a minified bundle is one line.
 */
export const DIFF_HIGHLIGHT_LIMIT = 1024 * 1024

/**
 * Syntax is also off past this many patch rows, whatever the sides weigh: the
 * renderable's span application costs ~0.4ms per dense row on the main thread
 * (measured — 1,500 lock-file rows block for half a second, 2,500 for a full
 * one), so this is the row count that keeps the one-time cost of color under
 * a few hundred milliseconds.
 */
export const DIFF_HIGHLIGHT_MAX_LINES = 1000

/**
 * Rows the page will show of a monster patch. A lock-file rewrite is a hundred
 * thousand rows nobody scrolls, and the pane's native buffer, per-line maps and
 * hatch pass all pay per row — the cap is what keeps the panel's arrows moving.
 * The header carries the true `+N −M` and says the patch was cut.
 */
export const DIFF_MAX_LINES = 10_000

/** The panel and the page mark a comparison row the same way. */
export function diffMark(status: DiffFileStatus): string {
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  if (status === 'typeChanged') return 'T'
  return MARKS[status]
}

/** Right-edge word on a stacked file header — modified has the mark and no word. */
export function diffStatusLabel(status: DiffFileStatus): string | undefined {
  if (status === 'added' || status === 'untracked') return 'new'
  if (status === 'deleted') return 'deleted'
  if (status === 'renamed') return 'renamed'
  if (status === 'copied') return 'copied'
  if (status === 'typeChanged') return 'type'
  return undefined
}

export function diffStatusColor(status: DiffFileStatus): string {
  if (
    status === 'added' ||
    status === 'untracked' ||
    status === 'deleted' ||
    status === 'modified'
  ) {
    return statusColor(status)
  }
  return statusColor('modified')
}

/**
 * Mix `color` toward `base`. The diff backgrounds cannot come from the theme —
 * no palette ships "faint green fill" — so they are blended from the git colors
 * every theme already has, which keeps them legible on light and dark alike.
 */
function blend(color: string, base: string, amount: number): string {
  const rgb = (hex: string): number[] | null =>
    /^#[0-9a-f]{6}$/i.test(hex)
      ? [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))
      : null
  const from = rgb(color)
  const to = rgb(base)
  if (!from || !to) return base
  const mix = (i: number) =>
    Math.round(from[i]! * amount + to[i]! * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

/**
 * What a split pane's padded rows are hatched with. A row that shows no line is
 * marked the way every diff viewer marks it — slanted strokes, not a painted
 * block — and a terminal has no fill patterns, so the hatch is text written into
 * the pane's own content.
 */
export const HATCH = '╱'

/** A row that holds a hatch bar and nothing else — a padded row, repaintable. */
const onlyHatch = new RegExp(`^${HATCH}+$`)

/** `[startOffset, endOffset, captureGroup]` in the pane document's coordinates. */
type PaneHighlight = [number, number, string]

/**
 * What plain mode answers a highlight pass with. Assigned rather than left off:
 * paging from a highlighted change reuses the panes, and the renderable only
 * forwards a *defined* filetype to them — a pass started under the stale one
 * must land as "no spans" (the cheap setText path), not as the parse's raw
 * captures, which are the very span flood the plain gate exists to avoid.
 */
const NO_HIGHLIGHTS: OnHighlight = () => Promise.resolve([])

type OnHighlight = (
  given: PaneHighlight[],
  context: { content: string },
) => Promise<PaneHighlight[] | undefined>

interface CodePane {
  scrollY: number
  maxScrollY: number
  /** Every accessor below throws once this is true (see `livePane`). */
  isDestroyed: boolean
  /** Columns the code itself owns — the side minus its gutter. */
  width: number
  content: string
  filetype: string | undefined
  onHighlight?: OnHighlight
}

/** The panes inside the `<diff>` renderable — private upstream, but assigning
 * `scrollY`/`content`/`onHighlight` is how its own internals drive them. */
interface DiffSides {
  leftCodeRenderable?: CodePane | null
  rightCodeRenderable?: CodePane | null
}

/** Which source document a pane line shows, and which of its lines. */
interface LineRef {
  side: 'old' | 'new'
  line: number
}

/**
 * What each pane line displays, replayed from the patch exactly the way the
 * `<diff>` renderable assembles its panes: unified interleaves the hunk lines
 * into one document; split pairs a change block's removals and additions row
 * for row, padding the shorter side with blank lines (the nulls here).
 */
function paneLines(patch: string, view: 'unified' | 'split') {
  const left: (LineRef | null)[] = []
  const right: (LineRef | null)[] = []
  const lines = patch.split('\n')
  let at = 0
  let oldLine = 0
  let newLine = 0
  while (at < lines.length) {
    const header = lines[at]!.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/)
    at++
    if (!header) continue
    oldLine = Math.max(0, Number(header[1]) - 1)
    newLine = Math.max(0, Number(header[2]) - 1)
    while (at < lines.length && !lines[at]!.startsWith('@@')) {
      const mark = lines[at]![0]
      if (mark === ' ') {
        if (view === 'split') {
          left.push({ side: 'old', line: oldLine })
          right.push({ side: 'new', line: newLine })
        } else {
          left.push({ side: 'new', line: newLine })
        }
        oldLine++
        newLine++
        at++
      } else if (mark === '-' || mark === '+') {
        const dels: LineRef[] = []
        const adds: LineRef[] = []
        while (at < lines.length && (lines[at]![0] === '-' || lines[at]![0] === '+')) {
          if (lines[at]![0] === '-') dels.push({ side: 'old', line: oldLine++ })
          else adds.push({ side: 'new', line: newLine++ })
          at++
        }
        if (view === 'split') {
          for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
            left.push(dels[i] ?? null)
            right.push(adds[i] ?? null)
          }
        } else {
          left.push(...dels, ...adds)
        }
      } else {
        at++
      }
    }
  }
  return { left, right }
}

/**
 * The diff pane: takes the editor's place while open and shows the one change
 * the source-control panel's cursor is on. Rendering is OpenTUI's `<diff>`
 * renderable — unified or split view, tree-sitter syntax highlighting, native
 * scrolling — this component only feeds it a patch and colors and owns the
 * keyboard.
 */
export function DiffView(props: DiffViewProps) {
  const dimensions = useTerminalDimensions()

  /**
   * `<diff>` takes its tree-sitter client at construction only, so the pane
   * waits for the shared one — letting the renderable default would spin up a
   * second, uninitialized client without the vendored grammars.
   */
  const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined)
  onMount(() => void highlightClient().then(c => setClient(c)))

  let pane: DiffRenderable | undefined

  /** Nothing may fire the deferred attach after the page is gone (issue #70). */
  let attachTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(attachTimer))

  /**
   * The `<diff>` on screen, or nothing.
   *
   * The ref is never called back when the element goes away, and the reconciler
   * destroys a removed renderable a tick later — so a page that falls back to
   * "No changes in this file" leaves `pane` pointing at a corpse whose every
   * accessor throws "TextBufferView is destroyed". Paging from one such change
   * to another is what reaches it: nothing has replaced the ref in between.
   */
  const livePane = () => {
    if (pane?.isDestroyed) pane = undefined
    return pane
  }

  const sides = () => {
    const host = livePane() as unknown as DiffSides | undefined
    return [host?.leftCodeRenderable, host?.rightCodeRenderable].filter(
      (side): side is CodePane => side != null && !side.isDestroyed,
    )
  }

  /**
   * Everything derived from one change: its patch, and the highlight pass each
   * pane runs.
   *
   * Cached per path, texts and all, because the page is fed the same changes
   * over and over with nothing new in them: `refreshDiff` hands it a fresh
   * object on every git revision, and the panel's arrows land on a file the
   * cursor already visited. A big lock file's patch costs real milliseconds,
   * and returning the *same value* is also what lets the effect below and the
   * renderable's own `diff` setter skip their work entirely. The texts are
   * compared by content — the cheap identity check first, since `diffFileFor`
   * hands back its own cached object for an unchanged file.
   *
   * The panes hold fragments — hunk lines glued together — and tree-sitter's
   * error recovery on such a fragment drops or misreads captures (JSX attribute
   * names went unstyled on the removed side). So each pane's highlight pass is
   * replaced: highlight the *full* old and new documents once, then remap those
   * captures onto the fragment's lines. The callbacks are cached per pane/view
   * because reassigning `onHighlight` re-runs the pass.
   */
  interface Derived {
    diff: UnifiedDiff
    highlighter: (which: 'left' | 'right', view: 'unified' | 'split') => OnHighlight
  }
  const derivedCache = new Map<string, { file: DiffFile; value: Derived }>()
  const DERIVED_CACHE_LIMIT = 4

  const current = createMemo((): Derived => {
    const f = props.file
    const hit = derivedCache.get(f.path)
    if (
      hit &&
      (hit.file === f || (hit.file.oldText === f.oldText && hit.file.newText === f.newText))
    ) {
      return hit.value
    }
    const diff = unifiedDiff(f.rel, f.oldText, f.newText, DIFF_MAX_LINES)

    const docs = new Map<string, Promise<Highlighted | null>>()
    const fullDoc = (side: 'old' | 'new') => {
      let doc = docs.get(side)
      if (!doc) {
        doc = computeHighlights(
          side === 'old' ? f.oldText : f.newText,
          filetypeForPath(f.path),
        ).then(result => (result === STALE ? null : result))
        docs.set(side, doc)
      }
      return doc
    }

    const cbCache = new Map<string, OnHighlight>()
    const highlighter = (which: 'left' | 'right', view: 'unified' | 'split'): OnHighlight => {
      const key = `${view}:${which}`
      const cached = cbCache.get(key)
      if (cached) return cached
      const cb: OnHighlight = async (_given, context) => {
        const refs = paneLines(diff.patch, view)[which]
        const [oldDoc, newDoc] = await Promise.all([fullDoc('old'), fullDoc('new')])

        const paneStarts = [0]
        for (let i = 0; i < context.content.length; i++) {
          if (context.content.charCodeAt(i) === 10) paneStarts.push(i + 1)
        }
        // Source line -> pane lines that show it.
        const bySource = { old: new Map<number, number[]>(), new: new Map<number, number[]>() }
        refs.forEach((ref, paneLine) => {
          if (!ref) return
          const rows = bySource[ref.side].get(ref.line)
          if (rows) rows.push(paneLine)
          else bySource[ref.side].set(ref.line, [paneLine])
        })

        const out: PaneHighlight[] = []
        // The padding rows carry the hatch rather than code, so their color is
        // one span over the whole row instead of anything tree-sitter said.
        refs.forEach((ref, paneLine) => {
          if (ref) return
          const from = paneStarts[paneLine]!
          const to =
            paneLine + 1 < paneStarts.length
              ? paneStarts[paneLine + 1]! - 1
              : context.content.length
          if (to > from) out.push([from, to, DIFF_FILLER])
        })
        // Walk the pane's own lines and pull each one's captures from the
        // per-line buckets, rather than scanning the document's whole capture
        // list: a small change in a big file has a handful of rows against
        // hundreds of thousands of captures. Buckets are in paint order, and
        // spans from different source lines can never overlap on the pane, so
        // per-line order is the only order the painter needs. The `wide`
        // captures live outside the buckets and are merged back by `ord`.
        const emit = (doc: Highlighted | null, side: 'old' | 'new') => {
          if (!doc || bySource[side].size === 0) return
          const paint = (
            capture: { start: number; end: number; group: string },
            lineStart: number,
            lineEnd: number,
            rows: number[],
          ) => {
            // Guides carry a background fill that would stamp over the diff's.
            if (capture.group === 'indent.guide') return
            const from = Math.max(capture.start, lineStart)
            const to = Math.min(capture.end, lineEnd)
            if (to <= from) return
            for (const paneLine of rows) {
              const base = paneStarts[paneLine]!
              out.push([base + (from - lineStart), base + (to - lineStart), capture.group])
            }
          }
          for (const [line, rows] of bySource[side]) {
            if (line >= doc.starts.length) continue
            const lineStart = doc.starts[line]!
            const lineEnd =
              line + 1 < doc.starts.length ? doc.starts[line + 1]! - 1 : doc.content.length
            const bucket = doc.byLine[line] ?? []
            const wides = doc.wide.filter(w => w.start < lineEnd && w.end > lineStart)
            if (wides.length === 0) {
              for (const capture of bucket) paint(capture, lineStart, lineEnd, rows)
              continue
            }
            let b = 0
            let w = 0
            while (b < bucket.length || w < wides.length) {
              const takeWide =
                b >= bucket.length || (w < wides.length && wides[w]!.ord < bucket[b]!.ord)
              paint(takeWide ? wides[w++]! : bucket[b++]!, lineStart, lineEnd, rows)
            }
          }
        }
        emit(oldDoc, 'old')
        emit(newDoc, 'new')
        return out
      }
      cbCache.set(key, cb)
      return cb
    }

    const value: Derived = { diff, highlighter }
    derivedCache.delete(f.path)
    derivedCache.set(f.path, { file: f, value })
    // Oldest out first: each entry pins its texts and patch, so the cap is what
    // bounds a walk across many huge changes.
    while (derivedCache.size > DERIVED_CACHE_LIMIT) {
      derivedCache.delete(derivedCache.keys().next().value!)
    }
    return value
  })

  const diff = () => current().diff

  /** See DIFF_HIGHLIGHT_LIMIT and DIFF_HIGHLIGHT_MAX_LINES: past either the
   * page renders plain — the add/remove row backgrounds, signs and numbers are
   * per-line and stay. */
  const plain = createMemo(() => {
    const f = props.file
    return (
      f.oldText.length + f.newText.length > DIFF_HIGHLIGHT_LIMIT ||
      current().diff.lines > DIFF_HIGHLIGHT_MAX_LINES
    )
  })

  /**
   * An added or deleted file has one side and nothing to put beside it: split
   * would draw the whole change against an empty pane. So the layout is inline
   * here whatever the setting says, and Tab has nothing to toggle — flipping the
   * persisted setting from a page that cannot show the difference is worse than
   * a dead key.
   */
  const oneSided = () => props.file.oldText === '' || props.file.newText === ''
  const section = () => props.variant === 'section'
  const mode = (): DiffMode => (oneSided() ? 'inline' : props.mode)

  /**
   * Rows a stacked section is drawn at. Split pairs each change block row for
   * row and pads the shorter side, so it is taller than the unified patch it was
   * measured from — a section given the patch's row count would have its tail
   * cut off, the parent's scroll being the only one there is.
   */
  const sectionRows = () =>
    mode() === 'split'
      ? Math.max(1, paneLines(diff().patch, 'split').left.length)
      : Math.max(1, diff().lines)

  /**
   * The rows split view pads a side with where the other side has more lines.
   * The renderable leaves them blank, so a block of additions reads as a hole in
   * the left pane rather than as "nothing stood here" — every diff viewer hatches
   * them instead, and in a terminal the only way to a hatch is glyphs, so the
   * strokes are written into the pane's content. (`setLineColor` can tint a row
   * but cannot put anything in it.)
   *
   * The padded rows are `paneLines`' nulls, and replaying them is exact only
   * because `wrapMode` is `none`: with wrapping on, the renderable inserts
   * further padding rows to keep two wrapped lines level, and those are not in
   * the patch.
   */
  const paintHatch = (host: DiffSides, view: 'unified' | 'split') => {
    if (view !== 'split') return
    const refs = paneLines(diff().patch, 'split')
    for (const [which, code] of [
      ['left', host.leftCodeRenderable],
      ['right', host.rightCodeRenderable],
    ] as const) {
      if (!code || code.isDestroyed) continue
      // `code.width` is a layout behind — zero before the first pass, and the old
      // size after a resize — and a bar cut to it keeps that length for the rest
      // of the page's life, a row carrying one no longer being blank. So the bar
      // is cut to the whole diff, which neither pane can exceed, and
      // `wrapMode="none"` clips the overshoot away.
      const bar = HATCH.repeat(Math.max(1, props.width))
      const lines = code.content.split('\n')
      let hatched = false
      refs[which].forEach((ref, row) => {
        const line = lines[row]
        // A bar left by a narrower pane is repainted; anything else is content.
        if (ref || line === undefined || line === bar) return
        if (line !== '' && !onlyHatch.test(line)) return
        lines[row] = bar
        hatched = true
      })
      if (hatched) code.content = lines.join('\n')
    }
  }

  // Attach after the renderable's own (microtask-queued) rebuild has created
  // the panes for this diff and view; assigning marks highlights dirty, so an
  // already-finished pass simply runs again with the callback in place. The
  // hatch goes the same way round and *after* the callback: a rebuild replaces
  // the pane content, so writing it earlier would write into a document about
  // to be thrown away, and the content write is what re-runs the pass that
  // colors it. Reading the theme colors and the width here is what puts the
  // hatch back after a theme switch (which rebuilds the panes through the
  // `syntaxStyle` prop) and after a resize (which rebuilds them itself).
  createEffect(
    on([current, mode, client, () => props.width, () => ui.dim, () => ui.solidBg], () => {
      const highlighter = current().highlighter
      const view = mode() === 'split' ? 'split' : 'unified'
      // Only the last of a burst has the state worth applying, and an earlier
      // one would run against panes the rebuild has already replaced.
      clearTimeout(attachTimer)
      attachTimer = setTimeout(() => {
        attachTimer = undefined
        // A tick later, so the page may have fallen back to "No changes" and
        // taken its panes with it (see `livePane`).
        const host = livePane() as unknown as DiffSides | undefined
        if (!host) return
        for (const [which, code] of [
          ['left', host.leftCodeRenderable],
          ['right', host.rightCodeRenderable],
        ] as const) {
          if (!code || code.isDestroyed) continue
          if (plain()) {
            // The prop already keeps the filetype off the renderable, but a pane
            // reused from the previous change keeps the one it had (see
            // NO_HIGHLIGHTS) — clearing it here is what stops the parse itself.
            code.filetype = undefined
            code.onHighlight = NO_HIGHLIGHTS
          } else {
            code.onHighlight = highlighter(which, view)
          }
        }
        paintHatch(host, view)
      }, 0)
    }),
  )
  const scroll = (delta: number) => {
    for (const side of sides()) {
      side.scrollY = Math.max(0, Math.min(side.maxScrollY, side.scrollY + delta))
    }
  }
  const scrollTo = (row: number) => {
    for (const side of sides()) side.scrollY = Math.max(0, Math.min(side.maxScrollY, row))
  }

  // Keyed on the path, not the file: a refresh rebuilds the same change on every
  // save, and resetting the scroll then would throw the reader back to the top.
  createEffect(on([() => props.file.path, mode], () => scrollTo(0), { defer: true }))

  /** Rows a page spans — the pane is the editor slot: tabs, header, status bar off. */
  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse. A section
    // in the all-changes scroll does not own the keyboard at all.
    if (section() || props.blocked || !props.focused || key.defaultPrevented) return
    const k = key.name
    // The arrows scroll here and page through the changes in the source-control
    // panel — one pane owns each meaning, so neither has to be a chord.
    if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    // Commit detail is the only caller with more than one file to show, and ←/→
    // are the only keys here that scrolling does not already own.
    else if (k === 'left' && props.onMoveFile) props.onMoveFile(-1)
    else if (k === 'right' && props.onMoveFile) props.onMoveFile(1)
    // Ctrl+U / Ctrl+D as well as the page keys, which MacBook keyboards lack —
    // the editor takes the same pair (see EditorPane's page move).
    else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page())
    else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'tab' || k === 's' || k === 'd') {
      if (!oneSided()) props.onToggleMode?.()
    } else if (k === 'escape' || k === 'q') props.onClose?.()
    else return
    key.preventDefault()
  })

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    if (section()) return ''
    const layout = mode() === 'inline' ? 'inline' : 'side-by-side'
    if (oneSided()) {
      const full = ` ${layout} · Esc ${props.escLabel ?? 'close'} `
      return full.length + 28 <= props.width ? full : ` ${layout} · Esc `
    }
    const full = ` ${layout} · Tab layout · Esc ${props.escLabel ?? 'close'} `
    if (full.length + 28 <= props.width) return full
    return ` ${layout} · Tab · Esc `
  }

  /**
   * Path cut from the left to what the row can spare: neither header span may
   * shrink, so a long path used to push the hints (and its own start) off the
   * screen entirely. The tail of a path is the part that identifies the file.
   */
  const header = () => {
    const d = diff()
    const note = d.truncated
      ? ` · first ${DIFF_MAX_LINES} lines`
      : plain()
        ? ' · plain (large file)'
        : ''
    const tail = ` · +${d.adds} −${d.dels}${note}`
    const room = Math.max(8, props.width - hints().length - tail.length - 3)
    let rel =
      props.file.oldPath && props.file.oldPath !== props.file.rel
        ? `${props.file.oldPath} → ${props.file.rel}`
        : props.file.rel
    if (rel.length > room) rel = `…${rel.slice(rel.length - room + 1)}`
    return ` ${diffMark(props.file.status)} ${rel}${tail}`
  }

  return (
    <box
      width="100%"
      height={section() ? undefined : '100%'}
      flexShrink={section() ? 0 : undefined}
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      {/* The stacked page draws its own file header (sticky, foldable). Pinned
          here for the one-file page: the pane below measures as tall as the
          whole patch, and yoga would otherwise shrink this row to nothing —
          the spans inside are already flexShrink={0}, which only stops them
          being cut, not their row being crushed. */}
      <Show when={!section()}>
        <box flexDirection="row" flexShrink={0} backgroundColor={ui.solidBarBg}>
          <text
            wrapMode="none"
            fg={diffStatusColor(props.file.status)}
            bg={ui.solidBarBg}
            flexShrink={0}
            content={header()}
          />
          <box flexGrow={1} backgroundColor={ui.solidBarBg} />
          <text wrapMode="none" fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
        </box>
      </Show>

      <Show
        when={diff().patch !== '' && client() !== undefined}
        fallback={
          <text
            fg={ui.dim}
            bg={ui.solidBg}
            content={diff().patch === '' ? '  No changes in this file' : ''}
          />
        }
      >
        <diff
          ref={(el: DiffRenderable) => (pane = el)}
          diff={diff().patch}
          view={mode() === 'split' ? 'split' : 'unified'}
          filetype={plain() ? undefined : filetypeForPath(props.file.path)}
          syntaxStyle={getSyntaxStyle()}
          treeSitterClient={client() ?? undefined}
          syncScroll
          wrapMode="none"
          flexGrow={section() ? 0 : 1}
          flexShrink={section() ? 0 : undefined}
          height={section() ? sectionRows() : undefined}
          width="100%"
          fg={ui.text}
          lineNumberFg={ui.gutter}
          lineNumberBg={ui.solidBg}
          contextBg={ui.solidBg}
          addedBg={blend(ui.gitAdded, ui.solidBg, 0.14)}
          removedBg={blend(ui.gitDeleted, ui.solidBg, 0.14)}
          addedLineNumberBg={blend(ui.gitAdded, ui.solidBg, 0.28)}
          removedLineNumberBg={blend(ui.gitDeleted, ui.solidBg, 0.28)}
          addedSignColor={ui.gitAdded}
          removedSignColor={ui.gitDeleted}
          selectionBg={ui.treeSelectedBg}
        />
      </Show>
    </box>
  )
}
