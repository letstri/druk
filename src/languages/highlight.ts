import '../core/assets'
import {
  getTreeSitterClient,
  pathToFiletype,
  resolveRenderLib,
  SyntaxStyle,
  TextAttributes,
} from '@opentui/core'
import type {
  RGBA,
  StyleDefinition,
  StyleDefinitionInput,
  TreeSitterClient,
} from '@opentui/core'

import { mixColors, paintedTheme, syntaxTheme, ui } from '../themes'
import type { ThemeName } from '../themes'
import {
  filetypeForName,
  languageFor,
  languageGeneration,
  vendoredLanguages,
} from './index'
import type { Language } from './index'

export { mixColors } from '../themes'

const INDENT_GUIDE = 'indent.guide'

export const DIFF_FILLER = 'druk.diff.filler'

let clientDead = false
let initPromise: Promise<TreeSitterClient | null> | null = null

const PARSE_TIMEOUT_MS = 15_000
const PARSE_STRIKE_LIMIT = 3
let parseStrikes = 0
let parseTimeoutMs = PARSE_TIMEOUT_MS

export function setParseTimeoutForTests(ms: number): void {
  parseTimeoutMs = ms
  parseStrikes = 0
  clientDead = false
}

type HighlightResult = Awaited<ReturnType<TreeSitterClient['highlightOnce']>>

// The worker can pend forever: a stuck parser posts nothing, a dispatcher throw has no id (#82).
async function highlightOnceGuarded(
  client: TreeSitterClient,
  content: string,
  filetype: string
): Promise<HighlightResult | null> {
  const { promise: timedOut, resolve: giveUp } = Promise.withResolvers<null>()
  const timer = setTimeout(() => giveUp(null), parseTimeoutMs)
  timer.unref?.()
  try {
    const result = await Promise.race([
      client.highlightOnce(content, filetype),
      timedOut,
    ])
    if (result === null) {
      parseStrikes += 1
      if (parseStrikes >= PARSE_STRIKE_LIMIT) {
        clientDead = true
      }
      return null
    }
    parseStrikes = 0
    return result
  } finally {
    clearTimeout(timer)
  }
}
let syntaxStyle: SyntaxStyle | null = null
let styleFor: ThemeName | null = null

let registeredGeneration = -1

function registerParsers(client: TreeSitterClient): void {
  registeredGeneration = languageGeneration()
  for (const lang of vendoredLanguages()) {
    try {
      client.addFiletypeParser({
        filetype: lang.id,
        queries: { highlights: [lang.query!] },
        wasm: lang.wasm!,
      })
    } catch {
      // the language stays unhighlighted
    }
  }
}

// Cleared with the style table: ids are only valid for the instance they came from.
const styleIdByGroup = new Map<string, number | null>()
let styleById: Map<number, StyleDefinitionInput> | null = null
let definitionById: Map<number, StyleDefinition> | null = null
const overlaidIds = new Map<string, number | null>()

export const DEPRECATED_GROUP = 'druk.problem.deprecated'

export const CONFLICT_GROUPS = {
  marker: 'druk.conflict.marker',
  ours: 'druk.conflict.ours',
  theirs: 'druk.conflict.theirs',
} as const

export const FLASH_GROUP = 'druk.jump.flash'

export const SEARCH_GROUPS = {
  current: 'druk.search.current',
  match: 'druk.search.match',
} as const

export const DIFF_GROUPS = {
  added: 'druk.diff.added',
  hunk: 'druk.diff.hunk',
  meta: 'druk.diff.meta',
  removed: 'druk.diff.removed',
} as const

// The markdown renderable and its grammar ask for groups no theme lists: the native style table
// does no dotted fallback, so an unregistered `markup.heading.1` paints as plain text, and a table
// cell with no `default` takes TextTable's own white.
function markdownGroups(): Record<string, StyleDefinitionInput> {
  const heading = syntaxTheme['markup.heading'] ?? { bold: true, fg: ui.accent }
  const list = syntaxTheme['markup.list'] ?? { fg: ui.accent }
  return {
    conceal: { fg: ui.faint },
    default: { fg: ui.text },
    'markup.heading.1': heading,
    'markup.heading.2': heading,
    'markup.heading.3': heading,
    'markup.heading.4': heading,
    'markup.heading.5': heading,
    'markup.heading.6': heading,
    'markup.list.checked': list,
    'markup.list.unchecked': list,
    'markup.raw.block': syntaxTheme['markup.raw'] ?? { fg: ui.text },
  }
}

export function getSyntaxStyle(): SyntaxStyle {
  const theme = paintedTheme()
  if (!syntaxStyle || styleFor !== theme) {
    styleFor = theme
    styleIdByGroup.clear()
    styleById = null
    definitionById = null
    overlaidIds.clear()
    syntaxStyle = SyntaxStyle.fromStyles({
      ...markdownGroups(),
      ...syntaxTheme,
      [INDENT_GUIDE]: { bg: ui.indentGuide },
      // Background only, no underline: OpenTUI's underline takes the text's own colour.
      'druk.problem.error': { bg: mixColors(ui.solidBg, ui.error, 0.16) },
      'druk.problem.hint': { bg: mixColors(ui.solidBg, ui.dim, 0.1) },
      'druk.problem.info': { bg: mixColors(ui.solidBg, ui.dim, 0.1) },
      'druk.problem.unnecessary': { fg: mixColors(ui.solidBg, ui.text, 0.4) },
      'druk.problem.warning': { bg: mixColors(ui.solidBg, ui.dirty, 0.13) },
      [DIFF_FILLER]: { fg: mixColors(ui.solidBg, ui.dim, 0.55) },
      [CONFLICT_GROUPS.ours]: {
        bg: mixColors(ui.solidBg, ui.gitDeleted, 0.14),
      },
      [CONFLICT_GROUPS.theirs]: {
        bg: mixColors(ui.solidBg, ui.gitAdded, 0.14),
      },
      [CONFLICT_GROUPS.marker]: {
        bg: mixColors(ui.solidBg, ui.dirty, 0.18),
        bold: true,
        fg: ui.dirty,
      },
      [FLASH_GROUP]: { bg: mixColors(ui.solidBg, ui.accent, 0.22) },
      [SEARCH_GROUPS.match]: { bg: mixColors(ui.solidBg, ui.dirty, 0.22) },
      [SEARCH_GROUPS.current]: { bg: mixColors(ui.solidBg, ui.dirty, 0.5) },
      [DIFF_GROUPS.added]: {
        bg: mixColors(ui.solidBg, ui.gitAdded, 0.14),
        fg: ui.gitAdded,
      },
      [DIFF_GROUPS.removed]: {
        bg: mixColors(ui.solidBg, ui.gitDeleted, 0.14),
        fg: ui.gitDeleted,
      },
      [DIFF_GROUPS.hunk]: {
        bg: mixColors(ui.solidBg, ui.accent, 0.12),
        fg: ui.accent,
      },
      [DIFF_GROUPS.meta]: { bold: true, fg: ui.dim },
    })
    registerStruckThrough(syntaxStyle, DEPRECATED_GROUP)
  }
  return syntaxStyle
}

// `SyntaxStyle.registerStyle` drops STRIKETHROUGH; `getStyle` cannot see a direct registration.
function registerStruckThrough(style: SyntaxStyle, group: string): void {
  const id = struckThroughId(style, group, null)
  if (id !== null && id !== undefined) {
    styleIdByGroup.set(group, id)
  }
}

function struckThroughId(
  style: SyntaxStyle,
  name: string,
  fg: RGBA | null
): number | null {
  try {
    return resolveRenderLib().syntaxStyleRegister(
      style.ptr,
      name,
      fg,
      null,
      TextAttributes.STRIKETHROUGH
    )
  } catch {
    return null
  }
}

export function invalidateSyntaxStyle(): void {
  syntaxStyle = null
  styleFor = null
  styleIdByGroup.clear()
  styleById = null
  definitionById = null
  overlaidIds.clear()
}

// A style name may hold anything but this separator; a raw NUL here makes grep and ripgrep
// skip the whole file as binary.
const overlayName = (group: string, base: number) => `${group}\u0000${base}`

// The native buffer replaces a cell's style rather than merging, so the pair is combined up front.
export function styleIdOver(group: string, base: number | null): number | null {
  const plain = styleIdForGroup(group)
  if (
    base === null ||
    base === undefined ||
    plain === null ||
    plain === undefined
  ) {
    return plain
  }
  const key = overlayName(group, base)
  const hit = overlaidIds.get(key)
  if (hit !== undefined) {
    return hit
  }
  const id = registerOverlaid(group, base) ?? plain
  overlaidIds.set(key, id)
  return id
}

function registerOverlaid(group: string, base: number): number | null {
  const ss = getSyntaxStyle()
  const under = definitionForId(base)
  if (!under?.fg) {
    return null
  }
  const name = overlayName(group, base)
  if (group === DEPRECATED_GROUP) {
    return struckThroughId(ss, name, under.fg)
  }
  const over = ss.getStyle(group)
  if (!over || over.fg || !over.bg) {
    return null
  }
  return ss.registerStyle(name, { ...under, bg: over.bg })
}

function definitionForId(id: number): StyleDefinition | undefined {
  const ss = getSyntaxStyle()
  if (!definitionById) {
    definitionById = new Map()
    for (const name of ss.getRegisteredNames()) {
      const at = ss.getStyleId(name)
      const def = ss.getStyle(name)
      if (at !== null && at !== undefined && def) {
        definitionById.set(at, def)
      }
    }
  }
  return definitionById.get(id)
}

export function styleForId(id: number): StyleDefinitionInput | undefined {
  // clears `styleById` on a theme switch
  const ss = getSyntaxStyle()
  if (!styleById) {
    styleById = new Map()
    for (const [group, style] of Object.entries(syntaxTheme)) {
      const at = ss.getStyleId(group)
      if (at !== null && at !== undefined) {
        styleById.set(at, style)
      }
    }
  }
  return styleById.get(id)
}

// Registry before OpenTUI: an extension's claim on a shared name is what runs its patterns.
export function filetypeForPath(path: string): string | undefined {
  // Both separators: druk ships for Windows.
  const name = path.slice(
    Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  )
  return filetypeForName(name) ?? pathToFiletype(path) ?? undefined
}

export async function highlightClient(): Promise<TreeSitterClient | null> {
  if (clientDead) {
    return null
  }
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const c = getTreeSitterClient()
        await c.initialize()
        registerParsers(c)
        return c
      } catch {
        clientDead = true
        return null
      }
    })()
  }
  const client = await initPromise
  // Here rather than in `registerLanguage`: the client may not exist yet when extensions load.
  if (client && registeredGeneration !== languageGeneration()) {
    registerParsers(client)
  }
  return client
}

const FALLBACK_GROUP: Record<string, string> = {
  attribute: 'property',
  constructor: 'function',
  namespace: 'type',
}

// `getStyle`, not `getStyleId`: the native table invents an id for any name it is asked about.
export function styleIdForGroup(group: string): number | null {
  // Before the memo: the table is what drops the memo on a theme switch.
  const ss = getSyntaxStyle()
  const hit = styleIdByGroup.get(group)
  if (hit !== undefined) {
    return hit
  }
  let resolved: number | null = null
  let g = group
  while (g.length > 0) {
    if (ss.getStyle(g)) {
      resolved = ss.getStyleId(g)
      break
    }
    const dot = g.lastIndexOf('.')
    if (dot === -1) {
      const alias = FALLBACK_GROUP[g]
      if (alias && ss.getStyle(alias)) {
        resolved = ss.getStyleId(alias)
      }
      break
    }
    g = g.slice(0, dot)
  }
  styleIdByGroup.set(group, resolved)
  return resolved
}

export interface Segment {
  // Column within the line, not an offset into the document.
  start: number
  end: number
  styleId: number
  // 0-based.
  line: number
}

const specCache = new Map<string, number>()

function specificity(group: string): number {
  let spec = specCache.get(group)
  if (spec === undefined) {
    spec = group.split('.').length
    specCache.set(group, spec)
  }
  return spec
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content.codePointAt(i) === 10) {
      starts.push(i + 1)
    }
  }
  return starts
}

type RawHighlight = readonly [number, number, string]

function indentGuides(content: string, tabSize: number): RawHighlight[] {
  const guides: RawHighlight[] = []
  let offset = 0
  for (const line of content.split('\n')) {
    const indent = line.length - line.trimStart().length
    let spaces = 0
    for (let column = 0; column < indent; column += 1) {
      // OpenTUI already tints a tab's first cell (`tabIndicator`); marking it widens the guide.
      if (line[column] === '\t') {
        spaces = 0
        continue
      }
      if (spaces % tabSize === 0) {
        guides.push([offset + column, offset + column + 1, INDENT_GUIDE])
      }
      spaces += 1
    }
    offset += line.length + 1
  }
  return guides
}

function highlightWithPatterns(
  content: string,
  patterns: NonNullable<Language['patterns']>
) {
  const out: RawHighlight[] = []
  for (const { group, re } of patterns) {
    for (const match of content.matchAll(re)) {
      if (match.index !== undefined) {
        out.push([match.index, match.index + match[0].length, group])
      }
    }
  }
  return out
}

// Comment/string captures alone mask the overlay; a per-match scan costs 100ms a keystroke.
function outsideProse(
  content: string,
  overlay: RawHighlight[],
  claimed: readonly (readonly [number, number, string, ...unknown[]])[]
): RawHighlight[] {
  if (overlay.length === 0) {
    return overlay
  }
  const prose = new Uint8Array(content.length)
  for (const [start, end, group] of claimed) {
    if (group.startsWith('comment') || group.startsWith('string')) {
      prose.fill(1, start, end)
    }
  }
  return overlay.filter(([start, end]) =>
    prose.subarray(start, end).every((c) => c === 0)
  )
}

const INJECTION = 'injection.'

type RawCapture = readonly [number, number, string, ...unknown[]]

// One level deep: injected parses drop their own injections, or a self-injecting grammar recurses.
async function resolveInjections(
  client: TreeSitterClient,
  content: string,
  captures: readonly RawCapture[]
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
    // The worker must never be asked for a grammar it was not told about.
    const lang = languageFor(filetype)
    if (lang && (lang.bundled || (lang.wasm && lang.query))) {
      spans.push({ end, filetype, start })
    }
  }
  if (spans.length === 0) {
    return kept
  }
  const injected = await Promise.all(
    spans.map(async (span) => {
      try {
        const res = await highlightOnceGuarded(
          client,
          content.slice(span.start, span.end),
          span.filetype
        )
        return (res?.highlights ?? [])
          .filter((h) => !h[2].startsWith(INJECTION))
          .map(
            (h) => [h[0] + span.start, h[1] + span.start, h[2]] as RawCapture
          )
      } catch {
        return []
      }
    })
  )
  // After outer captures: an injected capture of equal specificity must win the shared characters.
  return [...kept, ...injected.flat()]
}

export const STALE = Symbol('stale')

interface Capture {
  start: number
  end: number
  group: string
  // Index into `ordered` — the paint order the per-line buckets would otherwise lose.
  ord: number
}

const WIDE_LINES = 256

// Nothing here may be derived per window: that puts a whole-file floor under painting one line.
export interface Highlighted {
  content: string
  starts: number[]
  // Least-specific first; stable, so tree-sitter's order is the painter's tie-break.
  ordered: Capture[]
  byLine: (Capture[] | undefined)[]
  wide: Capture[]
}

function lineOfOffset(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (starts[mid]! <= offset) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

function prepare(
  content: string,
  raw: readonly (readonly [number, number, string, ...unknown[]])[]
): Highlighted {
  // Counting sort: stable, without a string split per comparison.
  const levels: Capture[][] = []
  for (const [start, end, group] of raw) {
    if (end <= start) {
      continue
    }
    const spec = specificity(group)
    ;(levels[spec] ??= []).push({ end, group, ord: 0, start })
  }
  const ordered: Capture[] = []
  for (const level of levels) {
    if (!level) {
      continue
    }
    for (const capture of level) {
      ordered.push(capture)
    }
  }
  const starts = lineStarts(content)
  const byLine: (Capture[] | undefined)[] = Array.from({
    length: starts.length,
  })
  const wide: Capture[] = []
  for (let i = 0; i < ordered.length; i += 1) {
    const h = ordered[i]!
    h.ord = i
    const first = lineOfOffset(starts, h.start)
    const last = lineOfOffset(starts, h.end - 1)
    if (last - first >= WIDE_LINES) {
      wide.push(h)
      continue
    }
    for (let line = first; line <= last; line += 1) {
      ;(byLine[line] ??= []).push(h)
    }
  }
  return { byLine, content, ordered, starts, wide }
}

const PARSE_CACHE_LIMIT = 8
interface ParseEntry {
  filetype: string | undefined
  tabSize: number
  parsed: Highlighted
}
const parseCache = new Map<string, ParseEntry>()

function cachedParse(
  content: string,
  filetype: string | undefined,
  tabSize: number
) {
  const hit = parseCache.get(content)
  if (!hit || hit.filetype !== filetype || hit.tabSize !== tabSize) {
    return null
  }
  return hit.parsed
}

function storeParse(
  content: string,
  filetype: string | undefined,
  tabSize: number,
  parsed: Highlighted
) {
  parseCache.set(content, { filetype, parsed, tabSize })
  while (parseCache.size > PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value!)
  }
}

export async function computeHighlights(
  content: string,
  filetype: string | undefined,
  tabSize = 2,
  isStale?: () => boolean
): Promise<Highlighted | typeof STALE> {
  // The probe outranks the cache: a caller that knows the text moved on was promised STALE.
  if (isStale?.()) {
    return STALE
  }
  const cached = cachedParse(content, filetype, tabSize)
  if (cached) {
    return cached
  }

  const guides = indentGuides(content, tabSize)
  const lang = filetype ? languageFor(filetype) : undefined
  const overlay = lang?.patterns
    ? highlightWithPatterns(content, lang.patterns)
    : []
  // Patterns and no grammar: asking the worker anyway hangs its query engine (tree-sitter-yaml).
  if (lang?.patterns && !lang.wasm && !lang.bundled) {
    const parsed = prepare(content, [...overlay, ...guides])
    storeParse(content, filetype, tabSize, parsed)
    return parsed
  }

  const client = filetype ? await highlightClient() : null
  if (!client) {
    return prepare(content, [...overlay, ...guides])
  }
  try {
    const res = await highlightOnceGuarded(client, content, filetype!)
    if (res === null) {
      return prepare(content, [...overlay, ...guides])
    }
    if (isStale?.()) {
      return STALE
    }
    const hl = await resolveInjections(client, content, res.highlights ?? [])
    if (isStale?.()) {
      return STALE
    }
    const parsed = prepare(content, [
      ...hl,
      ...outsideProse(content, overlay, hl),
      ...guides,
    ])
    storeParse(content, filetype, tabSize, parsed)
    return parsed
  } catch {
    return prepare(content, [...overlay, ...guides])
  }
}

// Inclusive range; segments are in per-line coordinates.
export function segmentsIn(
  parsed: Highlighted,
  from: number,
  to: number
): Segment[] {
  const { content, starts, byLine, wide } = parsed
  const first = Math.max(0, Math.min(from, starts.length - 1))
  const last = Math.max(first, Math.min(to, starts.length - 1))
  const sliceStart = starts[first]!
  const sliceEnd =
    last + 1 < starts.length ? starts[last + 1]! - 1 : content.length

  const picked: Capture[] = []
  for (const h of wide) {
    if (h.end > sliceStart && h.start < sliceEnd) {
      picked.push(h)
    }
  }
  // A capture sits in every bucket it touches.
  const seen = new Set<Capture>()
  for (let line = first; line <= last; line += 1) {
    const bucket = byLine[line]
    if (!bucket) {
      continue
    }
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
    if (styleId === null || styleId === undefined) {
      continue
    }
    const start = Math.max(h.start, sliceStart)
    const end = Math.min(h.end, sliceEnd)
    for (let i = start; i < end; i += 1) {
      styleAt[i - sliceStart] = styleId
    }
  }

  const segments: Segment[] = []
  let column = 0
  let line = first
  let run: Segment | null = null
  for (let i = sliceStart; i < sliceEnd; i += 1) {
    if (content.codePointAt(i) === 10) {
      run = null
      line += 1
      column = 0
      continue
    }
    const styleId = styleAt[i - sliceStart]!
    if (styleId < 0) {
      run = null
    } else if (run && run.styleId === styleId) {
      run.end = column + 1
    } else {
      run = { end: column + 1, line, start: column, styleId }
      segments.push(run)
    }
    column += 1
  }
  return segments
}
