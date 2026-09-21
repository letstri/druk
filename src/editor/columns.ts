import { resolveRenderLib } from '@opentui/core'
import type { WidthMethod } from '@opentui/core'

const TAB_CELLS = 2

// Anything outside printable ASCII needs measuring; a tab is 0x09, below the range, so one test
// covers both cases and every other line takes the identity path.
const MEASURED = /[^ -~]/u

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Lines repaint far more often than they change, and each holds one highlight span per token.
const CACHE_LIMIT = 500
const cache = new Map<string, Uint32Array>()

// The Zig core's own table, one width per grapheme cluster: a ZWJ emoji or a VS16 arrow is
// measured the way the renderer will draw it rather than the way a vendored wcwidth would guess.
function coreWidths(line: string, method: WidthMethod): number[] | null {
  try {
    const lib = resolveRenderLib()
    const encoded = lib.encodeUnicode(line, method)
    if (!encoded) {
      return null
    }
    const widths = encoded.data.map((cell) => cell.width)
    lib.freeUnicode(encoded)
    return widths
  } catch {
    // No native library (a unit test without a renderer): one cell per cluster is the old count.
    return null
  }
}

// Cell column of every character index in the line, plus one for the position after its end.
function prefixCells(line: string, method: WidthMethod): Uint32Array {
  const key = `${method}\u0000${line}`
  const known = cache.get(key)
  if (known) {
    return known
  }
  const clusters = [...graphemes.segment(line)]
  const measured = coreWidths(line, method)
  // A count the core does not share is a mapping wrong from that cluster on, so it is not used.
  const widths = measured?.length === clusters.length ? measured : null
  const cells = new Uint32Array(line.length + 1)
  let at = 0
  for (const [index, cluster] of clusters.entries()) {
    for (let i = 0; i < cluster.segment.length; i += 1) {
      // A column inside a cluster belongs to the cell the cluster starts in.
      cells[cluster.index + i] = at
    }
    at += widths?.[index] ?? (cluster.segment === '\t' ? TAB_CELLS : 1)
  }
  cells[line.length] = at
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(key, cells)
  return cells
}

function cellColumn(line: string, col: number, method: WidthMethod): number {
  const stop = Math.min(col, line.length)
  // a column past the end of the line counts as itself
  return (prefixCells(line, method)[stop] ?? stop) + (col - stop)
}

// OpenTUI addresses highlights in cells; the highlighter counts characters.
export function inCells<T extends { start: number; end: number }>(
  span: T,
  line: string,
  method: WidthMethod = 'unicode'
): T {
  if (!MEASURED.test(line)) {
    return span
  }
  return {
    ...span,
    end: cellColumn(line, span.end, method),
    start: cellColumn(line, span.start, method),
  }
}
