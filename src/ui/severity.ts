import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'

export const SEVERITY_GLYPH: Record<ProblemSeverity, string> = {
  error: '●',
  hint: '○',
  info: '○',
  warning: '▲',
}

// Read at paint time: `ui` is a store, so a table built at module scope freezes.
export const SEVERITY_COLOR: Record<ProblemSeverity, () => string> = {
  error: () => ui.error,
  hint: () => ui.dim,
  info: () => ui.dim,
  warning: () => ui.dirty,
}
