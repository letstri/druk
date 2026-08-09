/**
 * Everything about completion that is pure computation: normalizing the server's
 * reply, fuzzy-filtering it against what the user typed, and turning the chosen
 * item into a new document. No Solid, no OpenTUI — `test/completion.test.ts`
 * exercises this file directly.
 */
import type { CompletionItem, CompletionList, MarkupContent, Position } from './protocol'

export interface CompletionReply {
  items: CompletionItem[]
  /** The server wants to be asked again as the prefix grows. */
  isIncomplete: boolean
}

/** The wire result is `CompletionItem[] | CompletionList | null`; make it one shape. */
export function normalizeCompletion(result: unknown): CompletionReply | null {
  if (result == null) return null
  if (Array.isArray(result)) return { items: result as CompletionItem[], isIncomplete: false }
  const list = result as CompletionList
  if (!Array.isArray(list.items)) return null
  return { items: list.items, isIncomplete: list.isIncomplete === true }
}

/** Characters that make up the word being completed — the prefix the menu filters on. */
const WORD_CHAR = /[A-Za-z0-9_$]/

/**
 * Typing one of these asks the server for members/paths right away, prefix or
 * not. A fixed set rather than the server's advertised `triggerCharacters`:
 * the useful ones are common to every language, and quote/space triggers fire
 * in prose far too often for a popup that sits over the text.
 */
export const TRIGGER_CHARS = new Set(['.', ':', '/', '@'])

export function isWordChar(char: string): boolean {
  return WORD_CHAR.test(char)
}

/** Start column of the word ending at `col`, so `col - wordStart` is the prefix. */
export function wordStart(lineText: string, col: number): number {
  let at = col
  while (at > 0 && WORD_CHAR.test(lineText[at - 1]!)) at--
  return at
}

/**
 * True when everything between `from` and `to` is word characters — a reply
 * asked at `from` still describes the word the cursor sits in at `to`. A `.` or
 * `(` typed during the round trip fails this: the reply was computed for the
 * scope before it, and showing it puts globals in a member list.
 */
export function extendsWord(lineText: string, from: number, to: number): boolean {
  if (to < from) return false
  for (let at = from; at < to; at++) if (!WORD_CHAR.test(lineText[at] ?? ' ')) return false
  return true
}

export interface Match {
  item: CompletionItem
  score: number
  /** Indexes into the label that matched, for highlighting. */
  positions: number[]
}

/** Characters a match may sit behind and still count as starting a word. */
const SEPARATORS = new Set(['_', '-', '.', '/', '\\', ':', ' '])

/**
 * Subsequence match of `query` in `text`, scored as VS Code's `fuzzyScore` does:
 * a character that lands where a prefix match would put it, on a camelCase hump,
 * or straight after a separator is worth 7 when the case agrees and 5 when it
 * does not; anything else is worth 1. A hit that continues the previous one earns
 * a little more, and skipped characters cost, so `map` beats `meltAtPressure`.
 *
 * Length is deliberately not part of the score. VS Code leaves items that match
 * the prefix equally well to the server's own order, and that is what keeps a
 * type's own members above the hundreds of auto-import candidates that spell the
 * same letters — scoring them apart here would overrule the server for good.
 *
 * Returns null when `query` is not a subsequence at all.
 */
export function fuzzyMatch(
  query: string,
  text: string,
): { score: number; positions: number[] } | null {
  if (query.length === 0) return { score: 0, positions: [] }
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const positions: number[] = []
  let score = 0
  let at = 0
  for (let q = 0; q < lowerQuery.length; q++) {
    const found = lowerText.indexOf(lowerQuery[q]!, at)
    if (found < 0) return null
    const char = text[found]!
    const prev = text[found - 1]
    const hump = char >= 'A' && char <= 'Z' && !(prev! >= 'A' && prev! <= 'Z')
    const strong = found === q || hump || (prev !== undefined && SEPARATORS.has(prev))
    let step = strong ? (char === query[q] ? 7 : 5) : 1
    if (positions.length > 0 && found === positions.at(-1)! + 1) step += 2
    score += step - (found - at) // skipped characters push the item down
    positions.push(found)
    at = found + 1
  }
  return { score, positions }
}

/**
 * The server's own ranking, and the whole order when nothing has been typed:
 * `sortText` (the label when the server sent none, per the spec), then the label,
 * then the kind — VS Code's `defaultComparator`. Comparison is by code unit, not
 * locale: `sortText` is an opaque sort key, so `localeCompare`'s ideas about
 * digits and punctuation only corrupt it.
 */
function serverOrder(a: CompletionItem, b: CompletionItem): number {
  const aSort = (a.sortText ?? a.label).toLowerCase()
  const bSort = (b.sortText ?? b.label).toLowerCase()
  if (aSort !== bSort) return aSort < bSort ? -1 : 1
  if (a.label !== b.label) return a.label < b.label ? -1 : 1
  return (a.kind ?? 0) - (b.kind ?? 0)
}

/**
 * Filter and rank the server's items against the typed prefix, in VS Code's two
 * stages: the fuzzy score, and `serverOrder` under it — so items the prefix matches
 * equally well stay in the order the server asked for, which is the point of the
 * arrangement and why a prefix that fits a member and an auto-import alike still
 * shows the member. Sorting the survivors rather than the items first is the same
 * order for far less work: a global completion is thousands of items and this runs
 * on every keystroke.
 *
 * The text matched is `filterText ?? label` (the spec's rule), but the positions
 * returned are label indexes — when the two differ the highlight is dropped
 * rather than lied about.
 */
export function filterCompletions(items: CompletionItem[], prefix: string): Match[] {
  const matches: Match[] = []
  for (const item of items) {
    const target = item.filterText ?? item.label
    const match = fuzzyMatch(prefix, target)
    if (!match) continue
    matches.push({
      item,
      score: match.score,
      positions: target === item.label ? match.positions : [],
    })
  }
  return matches.toSorted((a, b) => b.score - a.score || serverOrder(a.item, b.item))
}

/**
 * Flatten snippet syntax to plain text: `${1:name}` keeps its placeholder text,
 * `$1`/`${1}` vanish, `${1|a,b|}` keeps the first choice. `caret` is where the
 * first tab stop sat, so accepting `foo(${1})` can land the cursor inside the
 * parentheses; null when the snippet named no stop.
 */
export function stripSnippet(text: string): { text: string; caret: number | null } {
  let caret: number | null = null
  let out = ''
  let at = 0
  const snippet = /\$(?:(\d+)|\{(\d+)(?::((?:[^{}]|\{[^}]*\})*))?(?:\|([^,|]*)[^}]*)?\})/g
  for (let hit = snippet.exec(text); hit; hit = snippet.exec(text)) {
    out += text.slice(at, hit.index)
    if (caret === null) caret = out.length
    out += hit[3] ?? hit[4] ?? ''
    at = hit.index + hit[0].length
  }
  out += text.slice(at)
  return { text: out, caret: caret === out.length ? null : caret }
}

/** Absolute offset of a `Position`, clamped to the document. */
function offsetOf(content: string, position: Position): number {
  let at = 0
  for (let line = 0; line < position.line; line++) {
    const next = content.indexOf('\n', at)
    if (next < 0) return content.length
    at = next + 1
  }
  const lineEnd = content.indexOf('\n', at)
  return Math.min(at + position.character, lineEnd < 0 ? content.length : lineEnd)
}

function positionOf(content: string, offset: number): Position {
  let line = 0
  let lineStart = 0
  for (let at = content.indexOf('\n'); at >= 0 && at < offset; at = content.indexOf('\n', at + 1)) {
    line++
    lineStart = at + 1
  }
  return { line, character: offset - lineStart }
}

/**
 * Prepends `indent` to every line after the first. Servers author multi-line
 * snippets at column 0 — expert's do/end block is `do\n  $0\nend` — so
 * accepted under an indented `def` the body and `end` would land at their
 * absolute columns without this. The first line is left alone: the range
 * starts after the indent that is already on the line, so its own leading
 * whitespace is relative to that point. Empty lines stay empty — trailing
 * whitespace is never wanted.
 */
function reindentContinuationLines(text: string, indent: string): string {
  const lines = text.split('\n')
  for (let at = 1; at < lines.length; at++) {
    if (lines[at]!.length > 0) lines[at] = indent + lines[at]
  }
  return lines.join('\n')
}

/** The leading whitespace of `line`, which `^\s*` always matches. */
function indentOf(content: string, line: number): string {
  const start = offsetOf(content, { line, character: 0 })
  const end = content.indexOf('\n', start)
  return /^\s*/.exec(content.slice(start, end < 0 ? undefined : end))![0]
}

/**
 * Apply `item` to the document: the primary edit replaces the server's range —
 * or, without one, the word from `anchorCol` to the cursor — and every
 * `additionalTextEdit` (auto-imports) lands too. All ranges address the
 * document as it was before any of them, per the spec, so the edits are applied
 * back-to-front. Returns the new text and where the cursor belongs.
 */
export function applyCompletion(
  content: string,
  cursor: Position,
  anchorCol: number,
  item: CompletionItem,
): { content: string; cursor: Position } {
  const raw = item.textEdit?.newText ?? item.insertText ?? item.label

  let primaryRange =
    item.textEdit && 'range' in item.textEdit
      ? item.textEdit.range
      : item.textEdit
        ? item.textEdit.replace
        : {
            start: { line: cursor.line, character: anchorCol },
            end: cursor,
          }
  // The server measured its range when the request went out; characters typed
  // during the round trip sit past its end and would survive the replacement
  // ("consolele"). The menu only stays open while the cursor extends the same
  // word, so pulling the end forward to the cursor is always the right repair.
  if (
    primaryRange.start.line === cursor.line &&
    primaryRange.end.line === cursor.line &&
    primaryRange.end.character < cursor.character
  ) {
    primaryRange = { start: primaryRange.start, end: cursor }
  }

  const isSnippet = item.insertTextFormat === 2 || raw.includes('$')
  // Multi-line snippets are re-indented to the line they land on before the
  // stops are stripped, so the caret offset stays correct. Plain text is
  // inserted verbatim — newlines a server sends outside a snippet are the text
  // it means, and VS Code adjusts whitespace only for snippet insertion.
  const adjusted =
    isSnippet && raw.includes('\n')
      ? reindentContinuationLines(raw, indentOf(content, primaryRange.start.line))
      : raw
  const { text: inserted, caret } = isSnippet
    ? stripSnippet(adjusted)
    : { text: adjusted, caret: null }

  const edits: { start: number; end: number; text: string; primary: boolean }[] = [
    {
      start: offsetOf(content, primaryRange.start),
      end: offsetOf(content, primaryRange.end),
      text: inserted,
      primary: true,
    },
  ]
  for (const edit of item.additionalTextEdits ?? []) {
    edits.push({
      start: offsetOf(content, edit.range.start),
      end: offsetOf(content, edit.range.end),
      text: edit.newText,
      primary: false,
    })
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end)

  let next = content
  for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)

  const primary = edits.find(edit => edit.primary)!
  let delta = 0
  for (const edit of edits) {
    if (!edit.primary && edit.end <= primary.start)
      delta += edit.text.length - (edit.end - edit.start)
  }
  const cursorOffset = primary.start + delta + (caret ?? inserted.length)
  return { content: next, cursor: positionOf(next, cursorOffset) }
}

/** How the menu draws a kind: one glyph, and a palette group the UI maps to a color. */
export type KindGroup = 'fn' | 'var' | 'type' | 'module' | 'keyword' | 'text'

const KIND_GROUPS: Record<number, { glyph: string; group: KindGroup }> = {
  1: { glyph: '·', group: 'text' }, // Text
  2: { glyph: 'ƒ', group: 'fn' }, // Method
  3: { glyph: 'ƒ', group: 'fn' }, // Function
  4: { glyph: 'ƒ', group: 'fn' }, // Constructor
  5: { glyph: '◦', group: 'var' }, // Field
  6: { glyph: 'ν', group: 'var' }, // Variable
  7: { glyph: '◆', group: 'type' }, // Class
  8: { glyph: '◇', group: 'type' }, // Interface
  9: { glyph: '⧉', group: 'module' }, // Module
  10: { glyph: '◦', group: 'var' }, // Property
  11: { glyph: '#', group: 'var' }, // Unit
  12: { glyph: 'π', group: 'var' }, // Value
  13: { glyph: 'Σ', group: 'type' }, // Enum
  14: { glyph: 'κ', group: 'keyword' }, // Keyword
  15: { glyph: '⌗', group: 'text' }, // Snippet
  16: { glyph: '□', group: 'var' }, // Color
  17: { glyph: '⧉', group: 'module' }, // File
  18: { glyph: '→', group: 'module' }, // Reference
  19: { glyph: '⧉', group: 'module' }, // Folder
  20: { glyph: 'Σ', group: 'var' }, // EnumMember
  21: { glyph: 'π', group: 'var' }, // Constant
  22: { glyph: '◆', group: 'type' }, // Struct
  23: { glyph: '⚡︎', group: 'fn' }, // Event
  24: { glyph: '±', group: 'fn' }, // Operator
  25: { glyph: 'τ', group: 'type' }, // TypeParameter
}

export function kindInfo(kind: number | undefined): { glyph: string; group: KindGroup } {
  return KIND_GROUPS[kind ?? 1] ?? { glyph: '·', group: 'text' }
}

const KIND_NAMES: Record<number, string> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'constructor',
  5: 'field',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'module',
  10: 'property',
  11: 'unit',
  12: 'value',
  13: 'enum',
  14: 'keyword',
  15: 'snippet',
  16: 'color',
  17: 'file',
  18: 'reference',
  19: 'folder',
  20: 'enum member',
  21: 'constant',
  22: 'struct',
  23: 'event',
  24: 'operator',
  25: 'type parameter',
}

/** What the footer calls the selected item's kind. */
export function kindName(kind: number | undefined): string {
  return KIND_NAMES[kind ?? 0] ?? 'text'
}

export function isDeprecated(item: CompletionItem): boolean {
  return item.deprecated === true || item.tags?.includes(1) === true
}

/**
 * Markdown flattened for a terminal panel. Only the inline marks a doc comment
 * actually carries are undone — fences, code spans, emphasis, headings, list
 * bullets — because the panel draws one colour and anything left is read as
 * literal text by the user. Line structure survives: the wrapper needs the
 * paragraph breaks the server wrote.
 */
export function plainMarkup(doc: string | MarkupContent | undefined): string {
  const raw = typeof doc === 'string' ? doc : doc?.value
  if (!raw) return ''
  return (
    raw
      // Anchored on spaces and tabs rather than `\s`: that class matches
      // newlines too, and a bullet pattern allowed to eat them takes the blank
      // line above the list with the marker.
      .replaceAll(/^[ \t]*```[^\n]*$/gm, '')
      .replaceAll(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
      .replaceAll(/^[ \t]*[-*+][ \t]+/gm, '• ')
      .replaceAll(/`([^`]+)`/g, '$1')
      .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
      .replaceAll(/(?<![*\w])\*([^*\n]+)\*/g, '$1')
      .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // A fence stripped from between two paragraphs leaves three newlines behind.
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** The signature and documentation the menu's detail panel shows for one item. */
export interface ItemInfo {
  detail: string
  documentation: string
  deprecated: boolean
}

export function itemInfo(item: CompletionItem): ItemInfo {
  const detail = item.detail ?? item.labelDetails?.detail ?? ''
  return {
    // Servers send the signature with the newlines they format it over; the
    // panel wraps it itself, so they are only extra blank rows here.
    detail: detail.replaceAll(/\s+/g, ' ').trim(),
    documentation: plainMarkup(item.documentation),
    deprecated: isDeprecated(item),
  }
}

/** Nothing to show yet — the panel stays out of the way rather than drawing empty. */
export function hasInfo(info: ItemInfo | null): info is ItemInfo {
  return info !== null && (info.detail.length > 0 || info.documentation.length > 0)
}

/** `label` cut into runs for the menu: matched runs draw in the accent color. */
export function matchRuns(label: string, positions: number[]): { text: string; hit: boolean }[] {
  if (positions.length === 0) return [{ text: label, hit: false }]
  const runs: { text: string; hit: boolean }[] = []
  const hits = new Set(positions)
  let start = 0
  for (let at = 1; at <= label.length; at++) {
    if (at === label.length || hits.has(at) !== hits.has(start)) {
      runs.push({ text: label.slice(start, at), hit: hits.has(start) })
      start = at
    }
  }
  return runs
}
