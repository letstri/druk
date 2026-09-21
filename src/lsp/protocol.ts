// Field names and numeric codes follow the LSP spec — do not "fix" them.

export interface RpcMessage {
  jsonrpc?: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

// 0-based; `character` is UTF-16 code units — 1:1 with columns unless `positionEncoding` changes.
export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Diagnostic {
  range: Range
  // 1 error, 2 warning, 3 info, 4 hint; absent means error.
  severity?: number
  // 1 unnecessary (unused code), 2 deprecated.
  tags?: number[]
  message: string
  source?: string
  code?: string | number
}

const TAG_UNNECESSARY = 1
const TAG_DEPRECATED = 2

export function isUnnecessary(diagnostic: Diagnostic): boolean {
  return diagnostic.tags?.includes(TAG_UNNECESSARY) ?? false
}

export function isDeprecated(diagnostic: Diagnostic): boolean {
  return diagnostic.tags?.includes(TAG_DEPRECATED) ?? false
}

export interface PublishDiagnosticsParams {
  uri: string
  diagnostics: Diagnostic[]
  version?: number
}

export interface DiagnosticReport {
  kind: 'full' | 'unchanged'
  items?: Diagnostic[]
}

interface TextEdit {
  range: Range
  newText: string
}

export interface Location {
  uri: string
  range: Range
}

export interface LocationLink {
  targetUri: string
  targetRange: Range
  targetSelectionRange?: Range
  originSelectionRange?: Range
}

export interface MarkupContent {
  kind: 'markdown' | 'plaintext'
  value: string
}

export interface CompletionItem {
  label: string
  // CompletionItemKind, 1–25.
  kind?: number
  detail?: string
  labelDetails?: { detail?: string; description?: string }
  documentation?: string | MarkupContent
  // CompletionItemTag; 1 is Deprecated. `deprecated` is the older spelling.
  tags?: number[]
  deprecated?: boolean
  // 1 plain text, 2 snippet.
  insertTextFormat?: number
  insertText?: string
  filterText?: string
  sortText?: string
  textEdit?: TextEdit | { newText: string; insert: Range; replace: Range }
  additionalTextEdits?: TextEdit[]
}

export interface CompletionList {
  isIncomplete: boolean
  items: CompletionItem[]
}

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

// Every position 0-based.
export interface Problem {
  path: string
  line: number
  col: number
  endLine: number
  endCol: number
  severity: ProblemSeverity
  unnecessary: boolean
  deprecated: boolean
  message: string
  source?: string
  code?: string
}

const SEVERITIES: ProblemSeverity[] = ['error', 'warning', 'info', 'hint']

export function severityOf(diagnostic: Diagnostic): ProblemSeverity {
  return SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? 'error'
}

// What broke, without the advice servers append to the same string (`help:`, `note:`).
export function headline(message: string): { text: string; more: boolean } {
  const [first = '', ...rest] = message.split('\n')
  const flat = first.replaceAll(/\s+/gu, ' ').trim()
  const advice = flat.search(/\s(?:help|note|hint):\s/iu)
  const dropped = rest.some((line) => line.trim().length > 0)
  if (advice < 0) {
    return { more: dropped, text: flat }
  }
  return { more: true, text: flat.slice(0, advice) }
}

export const SEVERITY_RANK: Record<ProblemSeverity, number> = {
  error: 0,
  hint: 3,
  info: 2,
  warning: 1,
}
