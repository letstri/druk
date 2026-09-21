import type {
  CompletionItem,
  CompletionList,
  MarkupContent,
  Position,
} from './protocol'

export interface CompletionReply {
  items: CompletionItem[]
  isIncomplete: boolean
}

export function normalizeCompletion(result: unknown): CompletionReply | null {
  if (result === null || result === undefined) {
    return null
  }
  if (Array.isArray(result)) {
    return { isIncomplete: false, items: result as CompletionItem[] }
  }
  const list = result as CompletionList
  if (!Array.isArray(list.items)) {
    return null
  }
  return { isIncomplete: list.isIncomplete === true, items: list.items }
}

const WORD_CHAR = /[A-Za-z0-9_$]/u

// A fixed set, not the server's `triggerCharacters`: quote/space triggers fire in prose.
export const TRIGGER_CHARS = new Set(['.', ':', '/', '@'])

export function isWordChar(char: string): boolean {
  return WORD_CHAR.test(char)
}

export function wordStart(lineText: string, col: number): number {
  let at = col
  while (at > 0 && WORD_CHAR.test(lineText[at - 1]!)) {
    at -= 1
  }
  return at
}

// A `.` or `(` typed during the round trip fails this: the reply was computed for the old scope.
export function extendsWord(
  lineText: string,
  from: number,
  to: number
): boolean {
  if (to < from) {
    return false
  }
  for (let at = from; at < to; at += 1) {
    if (!WORD_CHAR.test(lineText[at] ?? ' ')) {
      return false
    }
  }
  return true
}

export interface Match {
  item: CompletionItem
  score: number
  positions: number[]
}

const SEPARATORS = new Set(['_', '-', '.', '/', '\\', ':', ' '])

// Length is not scored: equal prefix matches keep the server's order.
export function fuzzyMatch(
  query: string,
  text: string
): { score: number; positions: number[] } | null {
  if (query.length === 0) {
    return { positions: [], score: 0 }
  }
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const positions: number[] = []
  let score = 0
  let at = 0
  for (let q = 0; q < lowerQuery.length; q += 1) {
    const found = lowerText.indexOf(lowerQuery[q]!, at)
    if (found === -1) {
      return null
    }
    const char = text[found]!
    const prev = text[found - 1]
    const hump = char >= 'A' && char <= 'Z' && !(prev! >= 'A' && prev! <= 'Z')
    const strong =
      found === q || hump || (prev !== undefined && SEPARATORS.has(prev))
    let step = strong ? (char === query[q] ? 7 : 5) : 1
    if (positions.length > 0 && found === positions.at(-1)! + 1) {
      step += 2
    }
    score += step - (found - at)
    positions.push(found)
    at = found + 1
  }
  return { positions, score }
}

// By code unit, not `localeCompare`: `sortText` is an opaque sort key.
function serverOrder(a: CompletionItem, b: CompletionItem): number {
  const aSort = (a.sortText ?? a.label).toLowerCase()
  const bSort = (b.sortText ?? b.label).toLowerCase()
  if (aSort !== bSort) {
    return aSort < bSort ? -1 : 1
  }
  if (a.label !== b.label) {
    return a.label < b.label ? -1 : 1
  }
  return (a.kind ?? 0) - (b.kind ?? 0)
}

// Positions are label indexes: when `filterText` differs, the highlight is dropped.
export function filterCompletions(
  items: CompletionItem[],
  prefix: string
): Match[] {
  const matches: Match[] = []
  for (const item of items) {
    const target = item.filterText ?? item.label
    const match = fuzzyMatch(prefix, target)
    if (!match) {
      continue
    }
    matches.push({
      item,
      positions: target === item.label ? match.positions : [],
      score: match.score,
    })
  }
  return matches.toSorted(
    (a, b) => b.score - a.score || serverOrder(a.item, b.item)
  )
}

// `caret` is where the first tab stop sat; null when there was none or it was at the end.
export function stripSnippet(text: string): {
  text: string
  caret: number | null
} {
  let caret: number | null = null
  let out = ''
  let at = 0
  const snippet =
    /\$(?:(\d+)|\{(\d+)(?::((?:[^{}]|\{[^}]*\})*))?(?:\|([^,|]*)[^}]*)?\})/gu
  for (let hit = snippet.exec(text); hit; hit = snippet.exec(text)) {
    out += text.slice(at, hit.index)
    if (caret === null) {
      caret = out.length
    }
    out += hit[3] ?? hit[4] ?? ''
    at = hit.index + hit[0].length
  }
  out += text.slice(at)
  return { caret: caret === out.length ? null : caret, text: out }
}

function offsetOf(content: string, position: Position): number {
  let at = 0
  for (let line = 0; line < position.line; line += 1) {
    const next = content.indexOf('\n', at)
    if (next === -1) {
      return content.length
    }
    at = next + 1
  }
  const lineEnd = content.indexOf('\n', at)
  return Math.min(
    at + position.character,
    lineEnd === -1 ? content.length : lineEnd
  )
}

function positionOf(content: string, offset: number): Position {
  let line = 0
  let lineStart = 0
  for (
    let at = content.indexOf('\n');
    at >= 0 && at < offset;
    at = content.indexOf('\n', at + 1)
  ) {
    line += 1
    lineStart = at + 1
  }
  return { character: offset - lineStart, line }
}

// Servers author multi-line snippets at column 0; the first line sits after the line's own indent.
function reindentContinuationLines(text: string, indent: string): string {
  const lines = text.split('\n')
  for (let at = 1; at < lines.length; at += 1) {
    if (lines[at]!.length > 0) {
      lines[at] = indent + lines[at]
    }
  }
  return lines.join('\n')
}

function indentOf(content: string, line: number): string {
  const start = offsetOf(content, { character: 0, line })
  const end = content.indexOf('\n', start)
  return /^\s*/u.exec(content.slice(start, end === -1 ? undefined : end))![0]
}

// Every range addresses the document before any edit (the spec), hence back-to-front.
export function applyCompletion(
  content: string,
  cursor: Position,
  anchorCol: number,
  item: CompletionItem
): { content: string; cursor: Position } {
  const raw = item.textEdit?.newText ?? item.insertText ?? item.label

  let primaryRange =
    item.textEdit && 'range' in item.textEdit
      ? item.textEdit.range
      : item.textEdit
        ? item.textEdit.replace
        : {
            end: cursor,
            start: { character: anchorCol, line: cursor.line },
          }
  // Characters typed during the round trip sit past the server's range end ("consolele").
  if (
    primaryRange.start.line === cursor.line &&
    primaryRange.end.line === cursor.line &&
    primaryRange.end.character < cursor.character
  ) {
    primaryRange = { end: cursor, start: primaryRange.start }
  }

  const isSnippet = item.insertTextFormat === 2 || raw.includes('$')
  // Re-indented before the stops are stripped, so the caret offset stays correct.
  const adjusted =
    isSnippet && raw.includes('\n')
      ? reindentContinuationLines(
          raw,
          indentOf(content, primaryRange.start.line)
        )
      : raw
  const { text: inserted, caret } = isSnippet
    ? stripSnippet(adjusted)
    : { caret: null, text: adjusted }

  const edits: {
    start: number
    end: number
    text: string
    primary: boolean
  }[] = [
    {
      end: offsetOf(content, primaryRange.end),
      primary: true,
      start: offsetOf(content, primaryRange.start),
      text: inserted,
    },
  ]
  for (const edit of item.additionalTextEdits ?? []) {
    edits.push({
      end: offsetOf(content, edit.range.end),
      primary: false,
      start: offsetOf(content, edit.range.start),
      text: edit.newText,
    })
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end)

  let next = content
  for (const edit of edits) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  }

  const primary = edits.find((edit) => edit.primary)!
  let delta = 0
  for (const edit of edits) {
    if (!edit.primary && edit.end <= primary.start) {
      delta += edit.text.length - (edit.end - edit.start)
    }
  }
  const cursorOffset = primary.start + delta + (caret ?? inserted.length)
  return { content: next, cursor: positionOf(next, cursorOffset) }
}

export type KindGroup = 'fn' | 'var' | 'type' | 'module' | 'keyword' | 'text'

const KIND_GROUPS: Record<number, { glyph: string; group: KindGroup }> = {
  // Text
  1: { glyph: '·', group: 'text' },
  // Property
  10: { glyph: '◦', group: 'var' },
  // Unit
  11: { glyph: '#', group: 'var' },
  // Value
  12: { glyph: 'π', group: 'var' },
  // Enum
  13: { glyph: 'Σ', group: 'type' },
  // Keyword
  14: { glyph: 'κ', group: 'keyword' },
  // Snippet
  15: { glyph: '⌗', group: 'text' },
  // Color
  16: { glyph: '□', group: 'var' },
  // File
  17: { glyph: '⧉', group: 'module' },
  // Reference
  18: { glyph: '→', group: 'module' },
  // Folder
  19: { glyph: '⧉', group: 'module' },
  // Method
  2: { glyph: 'ƒ', group: 'fn' },
  // EnumMember
  20: { glyph: 'Σ', group: 'var' },
  // Constant
  21: { glyph: 'π', group: 'var' },
  // Struct
  22: { glyph: '◆', group: 'type' },
  // Event
  23: { glyph: '⚡︎', group: 'fn' },
  // Operator
  24: { glyph: '±', group: 'fn' },
  // TypeParameter
  25: { glyph: 'τ', group: 'type' },
  // Function
  3: { glyph: 'ƒ', group: 'fn' },
  // Constructor
  4: { glyph: 'ƒ', group: 'fn' },
  // Field
  5: { glyph: '◦', group: 'var' },
  // Variable
  6: { glyph: 'ν', group: 'var' },
  // Class
  7: { glyph: '◆', group: 'type' },
  // Interface
  8: { glyph: '◇', group: 'type' },
  // Module
  9: { glyph: '⧉', group: 'module' },
}

export function kindInfo(kind: number | undefined): {
  glyph: string
  group: KindGroup
} {
  return KIND_GROUPS[kind ?? 1] ?? { glyph: '·', group: 'text' }
}

const KIND_NAMES: Record<number, string> = {
  1: 'text',
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
  2: 'method',
  20: 'enum member',
  21: 'constant',
  22: 'struct',
  23: 'event',
  24: 'operator',
  25: 'type parameter',
  3: 'function',
  4: 'constructor',
  5: 'field',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'module',
}

export function kindName(kind: number | undefined): string {
  return KIND_NAMES[kind ?? 0] ?? 'text'
}

export function isDeprecated(item: CompletionItem): boolean {
  return item.deprecated === true || item.tags?.includes(1) === true
}

export function plainMarkup(doc?: string | MarkupContent): string {
  const raw = typeof doc === 'string' ? doc : doc?.value
  if (!raw) {
    return ''
  }
  return (
    raw
      // `[ \t]` rather than `\s`, which matches newlines and would eat the blank line above a list.
      .replaceAll(/^[ \t]*```[^\n]*$/gmu, '')
      .replaceAll(/^[ \t]{0,3}#{1,6}[ \t]*/gmu, '')
      .replaceAll(/^[ \t]*[-*+][ \t]+/gmu, '• ')
      .replaceAll(/`([^`]+)`/gu, '$1')
      .replaceAll(/\*\*([^*]+)\*\*/gu, '$1')
      .replaceAll(/(?<![*\w])\*([^*\n]+)\*/gu, '$1')
      .replaceAll(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      // A fence stripped from between two paragraphs leaves three newlines behind.
      .replaceAll(/\n{3,}/gu, '\n\n')
      .trim()
  )
}

export interface ItemInfo {
  detail: string
  documentation: string
  source: string
  deprecated: boolean
}

export function itemInfo(item: CompletionItem): ItemInfo {
  const detail = item.detail ?? item.labelDetails?.detail ?? ''
  return {
    deprecated: isDeprecated(item),
    // Single spaces are load-bearing: the panel's row offsets hold only if a break costs one char.
    detail: detail.replaceAll(/\s+/gu, ' ').trim(),
    documentation: plainMarkup(item.documentation),
    source: item.labelDetails?.description ?? '',
  }
}

export function hasInfo(info: ItemInfo | null): info is ItemInfo {
  return (
    info !== null && (info.detail.length > 0 || info.documentation.length > 0)
  )
}

export function matchRuns(
  label: string,
  positions: number[]
): { text: string; hit: boolean }[] {
  if (positions.length === 0) {
    return [{ hit: false, text: label }]
  }
  const runs: { text: string; hit: boolean }[] = []
  const hits = new Set(positions)
  let start = 0
  for (let at = 1; at <= label.length; at += 1) {
    if (at === label.length || hits.has(at) !== hits.has(start)) {
      runs.push({ hit: hits.has(start), text: label.slice(start, at) })
      start = at
    }
  }
  return runs
}
