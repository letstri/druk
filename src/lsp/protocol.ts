/**
 * The slice of the Language Server Protocol druk speaks, hand-written rather than
 * imported: the `vscode-languageserver-*` packages carry the whole protocol, and
 * druk uses a dozen shapes of it. Field names and numeric codes follow the spec —
 * https://microsoft.github.io/language-server-protocol/ — do not "fix" them.
 */

export interface RpcMessage {
  jsonrpc?: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * Both fields 0-based. `character` counts UTF-16 code units — the same thing a JS
 * string index counts, which is why these convert 1:1 to buffer columns. A future
 * `positionEncoding` negotiation could change that; nothing here negotiates one.
 */
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
  /** 1 error, 2 warning, 3 info, 4 hint. Absent means error, as VS Code reads it. */
  severity?: number
  /** 1 unnecessary (unused code), 2 deprecated. */
  tags?: number[]
  message: string
  source?: string
  /** The server's own identifier for the rule that fired: `2345`, `import/no-cycle`. */
  code?: string | number
}

const TAG_UNNECESSARY = 1

export function isUnnecessary(diagnostic: Diagnostic): boolean {
  return diagnostic.tags?.includes(TAG_UNNECESSARY) ?? false
}

export interface PublishDiagnosticsParams {
  uri: string
  diagnostics: Diagnostic[]
}

/**
 * The answer to `textDocument/diagnostic` — the pull model (LSP 3.17), which a
 * server may implement *instead of* publishing. `unchanged` means "what you
 * already have still holds", so only a `full` report replaces anything.
 */
export interface DiagnosticReport {
  kind: 'full' | 'unchanged'
  items?: Diagnostic[]
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface Location {
  uri: string
  range: Range
}

/**
 * The other shape a definition may come back as, when the client declared
 * `linkSupport`. `targetRange` covers the whole declaration; `targetSelectionRange`
 * is just its name, which is where a jump should land.
 */
export interface LocationLink {
  targetUri: string
  targetRange: Range
  targetSelectionRange?: Range
  originSelectionRange?: Range
}

/** Documentation as a server sends it: plain string, or markdown in a wrapper. */
export interface MarkupContent {
  kind: 'markdown' | 'plaintext'
  value: string
}

export interface CompletionItem {
  label: string
  /** CompletionItemKind, 1–25. Absent renders as plain text. */
  kind?: number
  detail?: string
  /** The signature and origin a server wants drawn beside the label. */
  labelDetails?: { detail?: string; description?: string }
  /** Usually withheld from the list and only filled in by `completionItem/resolve`. */
  documentation?: string | MarkupContent
  /** CompletionItemTag; 1 is Deprecated. `deprecated` is the older spelling. */
  tags?: number[]
  deprecated?: boolean
  /** 1 plain text, 2 snippet (`${1:x}` placeholders — stripped before insert). */
  insertTextFormat?: number
  insertText?: string
  filterText?: string
  sortText?: string
  /** Either a plain edit or the newer insert/replace pair; both carry newText. */
  textEdit?: TextEdit | { newText: string; insert: Range; replace: Range }
  /** Extra edits elsewhere in the file — auto-imports, mostly. */
  additionalTextEdits?: TextEdit[]
}

export interface CompletionList {
  isIncomplete: boolean
  items: CompletionItem[]
}

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

/** A diagnostic as the editor carries it — every position 0-based. */
export interface Problem {
  path: string
  /** 0-based, like every position the editor bridge speaks. */
  line: number
  col: number
  /** Range end, for the underline; equal to the start when the server sent none. */
  endLine: number
  endCol: number
  severity: ProblemSeverity
  /** LSP's Unnecessary tag: unused code, dimmed instead of underlined. */
  unnecessary: boolean
  message: string
  source?: string
  /** The rule that fired, as the server spells it: `2345`, `import/no-cycle`. */
  code?: string
}

const SEVERITIES: ProblemSeverity[] = ['error', 'warning', 'info', 'hint']

export function severityOf(diagnostic: Diagnostic): ProblemSeverity {
  return SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? 'error'
}

/**
 * The half of a diagnostic worth a row beside the code: what is wrong, without
 * the advice. Servers append the fix to the same string — oxlint and eslint with
 * `help:`, rustc with `note:`, most of them with a second paragraph — and that
 * half is routinely longer than the half that says what broke, so an inline note
 * cut to the terminal's width is all advice and no diagnosis.
 *
 * `more` says something was dropped, which is what earns the trailing ellipsis:
 * the rest is a keystroke away rather than gone.
 */
export function headline(message: string): { text: string; more: boolean } {
  const [first = '', ...rest] = message.split('\n')
  const flat = first.replaceAll(/\s+/g, ' ').trim()
  const advice = flat.search(/\s(?:help|note|hint):\s/i)
  const dropped = rest.some(line => line.trim().length > 0)
  if (advice < 0) return { text: flat, more: dropped }
  return { text: flat.slice(0, advice), more: true }
}

/** Lower ranks matter more; used when one line holds several problems. */
export const SEVERITY_RANK: Record<ProblemSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
}
