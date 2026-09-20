export interface HistoryStep {
  at: number
  value: string
  draft: string
}

export function stepHistory(
  list: readonly string[],
  at: number,
  delta: number,
  current: string,
  draft: string,
): HistoryStep | null {
  if (list.length === 0) return null
  const next = Math.max(-1, Math.min(at + delta, list.length - 1))
  if (next === at) return null
  // The only moment the draft can be captured: the field is about to be overwritten.
  const kept = at === -1 ? current : draft
  return { at: next, value: next === -1 ? kept : (list[next] ?? ''), draft: kept }
}
