const TAB_CELLS = 2

// OpenTUI addresses highlights in cells but stores the char column verbatim; tabs only, since a
// wide character would need OpenTUI's own width table.
function cellColumn(line: string, col: number): number {
  const stop = Math.min(col, line.length)
  let cells = col - stop // a column past the end of the line counts as itself
  for (let at = 0; at < stop; at++) cells += line.charCodeAt(at) === 9 ? TAB_CELLS : 1
  return cells
}

export function inCells<T extends { start: number; end: number }>(span: T, line: string): T {
  if (!line.includes('\t')) return span
  return { ...span, start: cellColumn(line, span.start), end: cellColumn(line, span.end) }
}
