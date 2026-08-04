import '../core/assets'
import { getTreeSitterClient, pathToFiletype, SyntaxStyle } from '@opentui/core'
import type { StyleDefinitionInput, TreeSitterClient } from '@opentui/core'

import { paintedTheme, syntaxTheme, ui } from '../themes'
import type { ThemeName } from '../themes'
import { filetypeForName, languageFor, languageGeneration, vendoredLanguages } from './index'
import type { Language } from './index'

/** Two dots so it outranks any syntax capture on the same whitespace. */
const INDENT_GUIDE = 'indent.guide'

/** The stroke color of a split diff's hatched padding rows (see `DiffView`). */
export const DIFF_FILLER = 'druk.diff.filler'

let clientDead = false
let initPromise: Promise<TreeSitterClient | null> | null = null
let syntaxStyle: SyntaxStyle | null = null
/** Theme the cached `syntaxStyle` was built for — style ids are per instance. */
let styleFor: ThemeName | null = null

/** The registry generation the client was last told about; -1 is "never". */
let registeredGeneration = -1

/**
 * Teach the worker every grammar the registered languages carry.
 *
 * Run again whenever the language registry changes, not once at startup:
 * languages arrive with extensions, and an extension installed or reloaded mid-session
 * would otherwise stay unhighlighted until the next launch. Registering the same
 * filetype twice is what the worker already does for a reloaded extension, and it
 * takes the later one.
 */
function registerParsers(client: TreeSitterClient): void {
  registeredGeneration = languageGeneration()
  for (const lang of vendoredLanguages()) {
    try {
      client.addFiletypeParser({
        filetype: lang.id,
        wasm: lang.wasm!,
        queries: { highlights: [lang.query!] },
      })
    } catch {
      // best-effort: the language just stays unhighlighted
    }
  }
}

/** Cleared with the style table: the ids are only valid for the theme they came from. */
const styleIdByGroup = new Map<string, number | null>()

/** Built lazily from `syntaxTheme`, and dropped with the style table it indexes. */
let styleById: Map<number, StyleDefinitionInput> | null = null

/** `#rrggbb` blend, `t` of the way from `base` toward `tint`. */
export function mixColors(base: string, tint: string, t: number): string {
  const channel = (at: number) => {
    const a = Number.parseInt(base.slice(at, at + 2), 16)
    const b = Number.parseInt(tint.slice(at, at + 2), 16)
    return Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

/** Shared style table used by every editor buffer (built from the active theme). */
export function getSyntaxStyle(): SyntaxStyle {
  // Keyed on the painted theme: every theme's `keyword` (etc.) reuses the same
  // numeric id, so handing the editor a stale SyntaxStyle instance after a
  // preview cancel leaves the preview's colors on screen.
  const theme = paintedTheme()
  if (!syntaxStyle || styleFor !== theme) {
    styleFor = theme
    styleIdByGroup.clear()
    styleById = null
    syntaxStyle = SyntaxStyle.fromStyles({
      ...syntaxTheme,
      [INDENT_GUIDE]: { bg: ui.indentGuide },
      // Layered over the syntax highlights. No fg and no underline on purpose:
      // the token keeps its syntax color and its letterforms, and the severity
      // is carried by a faint tinted background alone — OpenTUI's underline
      // takes the *text's* color, so it read as a second, louder highlight on
      // top of an already marked span. The names are druk's, not tree-sitter's.
      'druk.problem.error': { bg: mixColors(ui.solidBg, ui.error, 0.16) },
      'druk.problem.warning': { bg: mixColors(ui.solidBg, ui.dirty, 0.13) },
      'druk.problem.info': { bg: mixColors(ui.solidBg, ui.dim, 0.1) },
      'druk.problem.hint': { bg: mixColors(ui.solidBg, ui.dim, 0.1) },
      // Unused code (LSP's Unnecessary tag) reads as absence, not as a fault:
      // it fades toward the background instead of gaining a tint, whatever
      // severity the server gave it.
      'druk.problem.unnecessary': { fg: mixColors(ui.solidBg, ui.text, 0.4) },
      // The hatch a split diff pads a side with is glyphs, not a line color, so
      // its stroke is a capture group like any other painted span.
      [DIFF_FILLER]: { fg: mixColors(ui.solidBg, ui.dim, 0.55) },
    })
  }
  return syntaxStyle
}

export function invalidateSyntaxStyle(): void {
  syntaxStyle = null
  styleFor = null
  styleIdByGroup.clear()
  styleById = null
}

/**
 * The style behind a `Segment`'s id, for the callers that paint spans of text
 * themselves instead of handing a buffer to OpenTUI — the search preview. Ids
 * belong to the SyntaxStyle instance, so this is rebuilt whenever it is.
 */
export function styleForId(id: number): StyleDefinitionInput | undefined {
  const ss = getSyntaxStyle() // rebuilds — and so clears this table — on a theme switch
  if (!styleById) {
    styleById = new Map()
    for (const [group, style] of Object.entries(syntaxTheme)) {
      const at = ss.getStyleId(group)
      if (at != null) styleById.set(at, style)
    }
  }
  return styleById.get(id)
}

/**
 * Map a file path to a tree-sitter filetype ("foo.ts" -> "typescript"), if known.
 *
 * The registry is asked first, and OpenTUI second: a language declares the names
 * and extensions OpenTUI resolves none of (`.tf`, `.tsrx`, `.env.local`,
 * `bun.lock`), and an extension claiming one has to win — that claim is the only
 * thing making its patterns run at all.
 */
export function filetypeForPath(path: string): string | undefined {
  // Both separators: druk ships for Windows, where nothing after the last `/`
  // is the file name.
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return filetypeForName(name) ?? pathToFiletype(path) ?? undefined
}

/**
 * The initialized worker client with the vendored parsers registered, or null
 * when highlighting is unavailable. The diff view passes this to OpenTUI's
 * `<diff>` renderable — constructed without a client it would spin up its own,
 * uninitialized and without the vendored grammars.
 */
export function highlightClient(): Promise<TreeSitterClient | null> {
  return ensureClient()
}

async function ensureClient(): Promise<TreeSitterClient | null> {
  if (clientDead) return null
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const c = getTreeSitterClient()
        await c.initialize()
        registerParsers(c)
        return c
      } catch {
        clientDead = true // highlighting is best-effort; editor still works
        return null
      }
    })()
  }
  const client = await initPromise
  // An extension registered a language after the worker was initialized — the check
  // is here rather than in `registerLanguage` because the client may not exist
  // yet when extensions load, and this is the one path every highlight goes through.
  if (client && registeredGeneration !== languageGeneration()) registerParsers(client)
  return client
}

/**
 * Resolve a capture group to a style id, walking from the most specific scope
 * ("type.builtin") to the least ("type"). Memoized per group: segmentation asks
 * for the same handful of groups once per capture in every window it paints.
 */
export function styleIdForGroup(group: string): number | null {
  const hit = styleIdByGroup.get(group)
  if (hit !== undefined) return hit
  const ss = getSyntaxStyle()
  let resolved: number | null = null
  let g = group
  while (g.length > 0) {
    const id = ss.getStyleId(g)
    if (id != null) {
      resolved = id
      break
    }
    const dot = g.lastIndexOf('.')
    if (dot < 0) break
    g = g.slice(0, dot)
  }
  styleIdByGroup.set(group, resolved)
  return resolved
}

export interface Segment {
  /** Column within the line, not an offset into the document. */
  start: number
  end: number
  styleId: number
  /** 0-based line. Highlights are stored per line so scrolling can be incremental. */
  line: number
}

/** More dots = more specific scope: "type.builtin" (2) beats "type" (1). */
function specificity(group: string): number {
  return group.split('.').length
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

type RawHighlight = readonly [number, number, string]

/** One tinted column at every indent stop inside a line's leading whitespace. */
function indentGuides(content: string, tabSize: number): RawHighlight[] {
  const guides: RawHighlight[] = []
  let offset = 0
  for (const line of content.split('\n')) {
    const indent = line.length - line.trimStart().length
    let spaces = 0
    for (let column = 0; column < indent; column++) {
      // A tab is an indent level by itself and OpenTUI tints its first cell as it
      // renders (see `tabIndicator`). Marking it here too would widen the guide to
      // the whole tab and make tab files look unlike space files.
      if (line[column] === '\t') {
        spaces = 0
        continue
      }
      if (spaces % tabSize === 0) guides.push([offset + column, offset + column + 1, INDENT_GUIDE])
      spaces++
    }
    offset += line.length + 1
  }
  return guides
}

function highlightWithPatterns(content: string, patterns: NonNullable<Language['patterns']>) {
  const out: RawHighlight[] = []
  for (const { group, re } of patterns) {
    for (const match of content.matchAll(re)) {
      if (match.index !== undefined) out.push([match.index, match.index + match[0].length, group])
    }
  }
  return out
}

/**
 * Overlay matches that a comment or string capture already covers. A regex has no
 * context, so the literal `@for` in prose is indistinguishable from the directive.
 *
 * Only those two, and deliberately: everywhere else the overlay must win, because
 * the grammar mis-attributes these tokens rather than missing them — tsx reads
 * `@catch` as a call and captures `catch` as `function`.
 *
 * The mask is what keeps this linear. Testing each match against every capture is
 * O(matches x captures), and cost 100ms on a 6 000-line file — on every reparse,
 * so on every keystroke.
 */
function outsideProse(
  content: string,
  overlay: RawHighlight[],
  claimed: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): RawHighlight[] {
  if (overlay.length === 0) return overlay
  const prose = new Uint8Array(content.length)
  for (const [start, end, group] of claimed) {
    if (group.startsWith('comment') || group.startsWith('string')) prose.fill(1, start, end)
  }
  return overlay.filter(([start, end]) => prose.subarray(start, end).every(c => c === 0))
}

/** A capture group naming the filetype the span it covers is really written in. */
const INJECTION = 'injection.'

type RawCapture = readonly [number, number, string, ...unknown[]]

/**
 * Reparse the spans a grammar marked `injection.<filetype>` with that filetype's
 * grammar, and drop the markers themselves.
 *
 * A single-file component is why this exists: the vue grammar reads everything
 * between `<script>` and `</script>` as one `raw_text` token, so without a
 * second parse the whole body of every Vue file renders unpainted.
 *
 * One level deep, deliberately — an injected parse's own injection captures are
 * discarded rather than followed, which is what stops a grammar that injects
 * itself from recursing.
 */
async function resolveInjections(
  client: TreeSitterClient,
  content: string,
  captures: ReadonlyArray<RawCapture>,
): Promise<RawCapture[]> {
  const kept: RawCapture[] = []
  const spans: { start: number; end: number; filetype: string }[] = []
  for (const capture of captures) {
    const [start, end, group] = capture
    if (!group.startsWith(INJECTION)) {
      kept.push(capture)
      continue
    }
    const filetype = group.slice(INJECTION.length)
    // Only a language with a grammar registered: asking the worker for one it
    // has never been told about is what `computeHighlights` already refuses to
    // do, and the plugin contributing the injected language may not be installed.
    const lang = languageFor(filetype)
    if (lang && (lang.bundled || (lang.wasm && lang.query))) spans.push({ start, end, filetype })
  }
  if (spans.length === 0) return kept
  const injected = await Promise.all(
    spans.map(async span => {
      try {
        const res = await client.highlightOnce(content.slice(span.start, span.end), span.filetype)
        return (res.highlights ?? [])
          .filter(h => !h[2].startsWith(INJECTION))
          .map(h => [h[0] + span.start, h[1] + span.start, h[2]] as RawCapture)
      } catch {
        return [] // best-effort: that block just stays unhighlighted
      }
    }),
  )
  // After the outer captures, so an injected capture of equal specificity wins
  // the characters they share — `(interpolation) @embedded` spans the whole of
  // `{{ msg }}`, and the expression inside it is the more useful colour.
  return [...kept, ...injected.flat()]
}

/** Answered instead of segments when `isStale` says the text moved on. */
export const STALE = Symbol('stale')

interface Capture {
  start: number
  end: number
  group: string
  /** Position in `ordered` — the paint order the buckets would otherwise lose. */
  ord: number
}

/**
 * A capture spanning at least this many lines skips the per-line buckets: a huge
 * block comment would otherwise be pushed into thousands of them. There are only
 * ever a handful of such captures, so windows scan them linearly instead.
 */
const WIDE_LINES = 256

/**
 * A parsed document, prepared for windowed segmentation. Nothing here is derived
 * per window: `lineStarts` (O(characters)), the specificity sort (O(captures
 * log n)) and the per-line buckets all used to be recomputed or scanned on every
 * call, which put a floor proportional to the *whole file* under segmenting a
 * single line — more than painting the viewport costs.
 */
export interface Highlighted {
  content: string
  /** Offset each line starts at, so a line range maps to a slice of the text. */
  starts: number[]
  /**
   * Captures least-specific-first, so the most specific one wins each character.
   * `toSorted` is stable, which is what leaves equal-specificity captures in the
   * order tree-sitter reported them — the tie-break the painter relies on.
   */
  ordered: Capture[]
  /** Captures touching each line, so a window never walks the whole file's list. */
  byLine: (Capture[] | undefined)[]
  /** The few captures wider than `WIDE_LINES`, checked against every window. */
  wide: Capture[]
}

/** Index of the line containing `offset`: last start at or before it. */
export function lineOfOffset(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

function prepare(
  content: string,
  raw: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): Highlighted {
  const ordered = raw
    .map(([start, end, group]) => ({ start, end, group, ord: 0 }))
    .filter(h => h.end > h.start)
    .toSorted((a, b) => specificity(a.group) - specificity(b.group))
  const starts = lineStarts(content)
  const byLine: (Capture[] | undefined)[] = Array.from({ length: starts.length })
  const wide: Capture[] = []
  for (let i = 0; i < ordered.length; i++) {
    const h = ordered[i]!
    h.ord = i
    const first = lineOfOffset(starts, h.start)
    const last = lineOfOffset(starts, h.end - 1)
    if (last - first >= WIDE_LINES) {
      wide.push(h)
      continue
    }
    for (let line = first; line <= last; line++) (byLine[line] ??= []).push(h)
  }
  return { content, starts, ordered, byLine, wide }
}

/**
 * Parsed documents by content, so switching back to a tab never repeats the
 * parse — the worker round-trip is the whole cost of first colour (~350ms at
 * 5 000 lines), and tab switches otherwise pay it every time. Entries are keyed
 * on the exact text and checked against filetype and tab size; a `Highlighted`
 * is theme-independent, so theme switches keep the cache.
 */
const PARSE_CACHE_LIMIT = 8
interface ParseEntry {
  filetype: string | undefined
  tabSize: number
  parsed: Highlighted
}
const parseCache = new Map<string, ParseEntry>()

function cachedParse(content: string, filetype: string | undefined, tabSize: number) {
  const hit = parseCache.get(content)
  if (!hit || hit.filetype !== filetype || hit.tabSize !== tabSize) return null
  return hit.parsed
}

function storeParse(
  content: string,
  filetype: string | undefined,
  tabSize: number,
  parsed: Highlighted,
) {
  parseCache.set(content, { filetype, tabSize, parsed })
  // Oldest out first. Recency would be the better rule and is not worth tracking:
  // at eight entries the tabs anyone switches between are all still in here.
  while (parseCache.size > PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value!)
  }
}

export async function computeHighlights(
  content: string,
  filetype: string | undefined,
  tabSize = 2,
  isStale?: () => boolean,
): Promise<Highlighted | typeof STALE> {
  // The probe outranks the cache: a caller that already knows the text moved on
  // was promised STALE, not a correct-but-unwanted result.
  if (isStale?.()) return STALE
  const cached = cachedParse(content, filetype, tabSize)
  if (cached) return cached

  const guides = indentGuides(content, tabSize)
  const lang = filetype ? languageFor(filetype) : undefined
  const overlay = lang?.patterns ? highlightWithPatterns(content, lang.patterns) : []
  // Patterns without a grammar mean no usable grammar exists, and asking for one
  // anyway can hang the query engine (tree-sitter-yaml). Only a language that
  // declares both wants its patterns layered over a parse.
  if (lang?.patterns && !lang.wasm && !lang.bundled) {
    const parsed = prepare(content, [...overlay, ...guides])
    storeParse(content, filetype, tabSize, parsed)
    return parsed
  }

  const client = filetype ? await ensureClient() : null
  if (!client) return prepare(content, [...overlay, ...guides])
  try {
    const res = await client.highlightOnce(content, filetype!)
    if (isStale?.()) return STALE
    const hl = await resolveInjections(client, content, res.highlights ?? [])
    if (isStale?.()) return STALE
    const parsed = prepare(content, [...hl, ...outsideProse(content, overlay, hl), ...guides])
    storeParse(content, filetype, tabSize, parsed)
    return parsed
  } catch {
    return prepare(content, [...overlay, ...guides])
  }
}

/**
 * Non-overlapping segments for lines `from`..`to` (inclusive) of a parsed document.
 *
 * Three steps:
 *   1. Collect the captures touching the range from the per-line buckets (plus
 *      the wide list) and restore paint order by `ord`. This is what keeps a
 *      window from scanning every capture in the file.
 *   2. Paint each capture's style onto a per-character array. The captures run
 *      least specific first, so the most specific one wins each character — the
 *      same rule OpenTUI's own renderer uses.
 *   3. Merge runs of equal style into segments.
 *
 * Coordinates are per line: the buffer stores highlights against a line index,
 * which lets the editor add and drop them a line at a time while scrolling. The
 * work is O(characters and captures in the range), which is why only the
 * viewport is done.
 */
export function segmentsIn(parsed: Highlighted, from: number, to: number): Segment[] {
  const { content, starts, byLine, wide } = parsed
  const first = Math.max(0, Math.min(from, starts.length - 1))
  const last = Math.max(first, Math.min(to, starts.length - 1))
  const sliceStart = starts[first]!
  const sliceEnd = last + 1 < starts.length ? starts[last + 1]! - 1 : content.length

  const picked: Capture[] = []
  for (const h of wide) {
    if (h.end > sliceStart && h.start < sliceEnd) picked.push(h)
  }
  // A capture sits in every bucket it touches, so one spanning several window
  // lines arrives once per line; the set keeps it from painting twice.
  const seen = new Set<Capture>()
  for (let line = first; line <= last; line++) {
    const bucket = byLine[line]
    if (!bucket) continue
    for (const h of bucket) {
      if (!seen.has(h)) {
        seen.add(h)
        picked.push(h)
      }
    }
  }
  picked.sort((a, b) => a.ord - b.ord)

  const styleAt = new Int32Array(Math.max(0, sliceEnd - sliceStart)).fill(-1)
  for (const h of picked) {
    const styleId = styleIdForGroup(h.group)
    if (styleId == null) continue
    const start = Math.max(h.start, sliceStart)
    const end = Math.min(h.end, sliceEnd)
    for (let i = start; i < end; i++) styleAt[i - sliceStart] = styleId
  }

  const segments: Segment[] = []
  let column = 0
  let line = first
  let run: Segment | null = null
  for (let i = sliceStart; i < sliceEnd; i++) {
    if (content.charCodeAt(i) === 10) {
      run = null // a segment never spans a line break
      line++
      column = 0
      continue
    }
    const styleId = styleAt[i - sliceStart]!
    if (styleId < 0) {
      run = null
    } else if (run && run.styleId === styleId) {
      run.end = column + 1
    } else {
      run = { start: column, end: column + 1, styleId, line }
      segments.push(run)
    }
    column++
  }
  return segments
}
