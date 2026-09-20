import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'

const TRACKED = new Set<ProblemSeverity>(['error', 'warning'])

export function problemRows(
  problems: Map<number, { severity: ProblemSeverity }>,
  total: number,
  rows: number,
): Array<ProblemSeverity | undefined> {
  const marks: Array<ProblemSeverity | undefined> = Array.from({ length: Math.max(0, rows) })
  if (rows <= 0 || total <= 0 || problems.size === 0) return marks

  for (const [line, problem] of problems) {
    if (line < 0 || line >= total) continue
    if (!TRACKED.has(problem.severity)) continue
    const row = Math.min(rows - 1, Math.floor((line / total) * rows))
    const current = marks[row]
    if (!current || SEVERITY_RANK[problem.severity] < SEVERITY_RANK[current]) {
      marks[row] = problem.severity
    }
  }
  return marks
}
