import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'

/**
 * The one spelling of "what does a severity look like" — the tab strip, the
 * status bar, the problems list and the editor gutter all read these, so a
 * changed glyph or colour role cannot leave the surfaces disagreeing.
 */
export const SEVERITY_GLYPH: Record<ProblemSeverity, string> = {
  error: '●',
  warning: '▲',
  info: '○',
  hint: '○',
}

/** Read at paint time: `ui` is a store, so a table built at module scope freezes. */
export const SEVERITY_COLOR: Record<ProblemSeverity, () => string> = {
  error: () => ui.error,
  warning: () => ui.dirty,
  info: () => ui.dim,
  hint: () => ui.dim,
}
