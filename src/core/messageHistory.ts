/**
 * Walking a list of past entries with ↑/↓ — the shell's history in a one-line
 * field. Position `-1` is the draft: what was typed before the walk started, put
 * back when ↓ reaches the end of it.
 */
export interface HistoryStep {
  /** Where the walk now stands; `-1` is the draft. */
  at: number
  /** What the field should now hold. */
  value: string
  /** The draft to restore, carried so the caller can hold it as one value. */
  draft: string
}

/**
 * One press of ↑ (`delta` 1, older) or ↓ (`delta` -1, newer). Returns null when
 * the key does nothing — an empty history, or an end already reached — so the
 * caller can leave the field alone rather than rewriting it with itself.
 */
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
  // Stepping off the draft is the only moment it can be captured: the field is
  // about to be overwritten with a past entry.
  const kept = at === -1 ? current : draft
  return { at: next, value: next === -1 ? kept : (list[next] ?? ''), draft: kept }
}
