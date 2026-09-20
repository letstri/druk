import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'

export const SEVERITY_GLYPH: Record<ProblemSeverity, string> = {
  error: '●',
  warning: '▲',
  info: '○',
  hint: '○',
}

// Read at paint time: `ui` is a store, so a table built at module scope freezes.
export const SEVERITY_COLOR: Record<ProblemSeverity, () => string> = {
  error: () => ui.error,
  warning: () => ui.dirty,
  info: () => ui.dim,
  hint: () => ui.dim,
}
