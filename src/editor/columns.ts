/**
 * Character columns to the columns the renderer draws them at.
 *
 * OpenTUI addresses a line's highlights in rendered *cells*, not characters, and
 * draws a tab as `TAB_CELLS` of them. Handed a character column, every capture on
 * a tab-indented line therefore lands one cell short per tab — a whole file of
 * tab indentation renders with its colours sliding left as the nesting deepens.
 * Nothing exposes the width or takes character columns instead: the edit buffer's
 * own `addHighlightByCharRange` stores the character column verbatim and drifts
 * the same way.
 *
 * Only tabs are compensated. A wide character (CJK, an emoji) is two cells too and
 * drifts alike, but matching OpenTUI's width table character for character is the
 * part that cannot be guessed — a disagreement would move colours on lines that
 * are right today.
 */

/** OpenTUI draws a tab as the indicator glyph plus one blank, with no setting for it. */
const TAB_CELLS = 2

/** The cell character column `col` of `line` is drawn at. */
export function cellColumn(line: string, col: number): number {
  const stop = Math.min(col, line.length)
  let cells = col - stop // a column past the end of the line counts as itself
  for (let at = 0; at < stop; at++) cells += line.charCodeAt(at) === 9 ? TAB_CELLS : 1
  return cells
}

/** `span` in the renderer's columns, or as it stands when the line holds no tab. */
export function inCells<T extends { start: number; end: number }>(span: T, line: string): T {
  if (!line.includes('\t')) return span
  return { ...span, start: cellColumn(line, span.start), end: cellColumn(line, span.end) }
}
