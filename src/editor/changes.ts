import type { LineChange } from '../core/git'

const RANK: Record<LineChange, number> = { added: 1, deleted: 3, modified: 2 }

export function changeRows(
  gitLines: Map<number, LineChange>,
  total: number,
  rows: number
): (LineChange | undefined)[] {
  const marks: (LineChange | undefined)[] = Array.from({
    length: Math.max(0, rows),
  })
  if (rows <= 0 || total <= 0 || gitLines.size === 0) {
    return marks
  }

  for (const [line, change] of gitLines) {
    if (line < 0 || line >= total) {
      continue
    }
    const row = Math.min(rows - 1, Math.floor((line / total) * rows))
    const current = marks[row]
    if (!current || RANK[change] > RANK[current]) {
      marks[row] = change
    }
  }
  return marks
}
