export interface UnifiedDiff {
  patch: string
  adds: number
  dels: number
  lines: number
  truncated: boolean
}

function splitText(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

const MAX_EDIT_DISTANCE = 2000

interface Edit {
  kind: 'same' | 'del' | 'add'
  oldIndex: number
  newIndex: number
}

interface Rewrite {
  start: number
  oldEnd: number
  newEnd: number
}

function lineEdits(oldLines: string[], newLines: string[]): Edit[] | Rewrite {
  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++
  }
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  const middle = myers(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd), start, start)
  if (middle === null) return { start, oldEnd, newEnd }

  const edits: Edit[] = []
  for (let i = 0; i < start; i++) edits.push({ kind: 'same', oldIndex: i, newIndex: i })
  edits.push(...middle)
  for (let i = oldEnd; i < oldLines.length; i++) {
    edits.push({ kind: 'same', oldIndex: i, newIndex: i - oldEnd + newEnd })
  }
  return edits
}

function myers(a: string[], b: string[], oldBase: number, newBase: number): Edit[] | null {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []

  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max
  // v[k + offset] = furthest x on diagonal k after d steps; trace keeps a copy per d.
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []

  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
          ? v[k + 1 + offset]!
          : v[k - 1 + offset]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }

  if (found < 0) return null

  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!
    const k = x - y
    const fromK =
      k === -d || (k !== d && prev[k - 1 + offset]! < prev[k + 1 + offset]!) ? k + 1 : k - 1
    const prevX = prev[fromK + offset]!
    const prevY = prevX - fromK
    while (x > prevX && y > prevY) {
      x--
      y--
      edits.push({ kind: 'same', oldIndex: oldBase + x, newIndex: newBase + y })
    }
    if (x === prevX) {
      y--
      edits.push({ kind: 'add', oldIndex: -1, newIndex: newBase + y })
    } else {
      x--
      edits.push({ kind: 'del', oldIndex: oldBase + x, newIndex: -1 })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    edits.push({ kind: 'same', oldIndex: oldBase + x, newIndex: newBase + y })
  }
  return edits.toReversed()
}

const CONTEXT = 3

function rewritePatch(
  rel: string,
  oldLines: string[],
  newLines: string[],
  { start, oldEnd, newEnd }: Rewrite,
  maxLines: number,
): UnifiedDiff {
  const dels = oldEnd - start
  const adds = newEnd - start
  const ctxBefore = Math.min(CONTEXT, start)
  const ctxAfter = Math.min(CONTEXT, oldLines.length - oldEnd)
  const out = [
    `--- ${oldLines.length === 0 ? '/dev/null' : `a/${rel}`}`,
    `+++ ${newLines.length === 0 ? '/dev/null' : `b/${rel}`}`,
  ]
  let lines = 0
  let emittedDels = 0
  let emittedAdds = 0
  let emittedAfter = 0
  const body: string[] = []
  for (let i = start - ctxBefore; i < start && lines < maxLines; i++, lines++) {
    body.push(` ${oldLines[i]!}`)
  }
  for (let i = start; i < oldEnd && lines < maxLines; i++, lines++) {
    body.push(`-${oldLines[i]!}`)
    emittedDels++
  }
  for (let i = start; i < newEnd && lines < maxLines; i++, lines++) {
    body.push(`+${newLines[i]!}`)
    emittedAdds++
  }
  for (let i = oldEnd; i < oldEnd + ctxAfter && lines < maxLines; i++, lines++) {
    body.push(` ${oldLines[i]!}`)
    emittedAfter++
  }
  const hunkStart = start - ctxBefore
  const oldCount = ctxBefore + emittedDels + emittedAfter
  const newCount = ctxBefore + emittedAdds + emittedAfter
  const oldHeader = oldCount === 0 ? hunkStart : hunkStart + 1
  const newHeader = newCount === 0 ? hunkStart : hunkStart + 1
  out.push(`@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`, ...body)
  return {
    patch: `${out.join('\n')}\n`,
    adds,
    dels,
    lines,
    truncated: emittedDels < dels || emittedAdds < adds,
  }
}

export function unifiedDiff(
  rel: string,
  oldText: string,
  newText: string,
  maxLines = Number.POSITIVE_INFINITY,
): UnifiedDiff {
  const oldLines = splitText(oldText)
  const newLines = splitText(newText)
  const edits = lineEdits(oldLines, newLines)
  if (!Array.isArray(edits)) return rewritePatch(rel, oldLines, newLines, edits, maxLines)

  // Hunks as index ranges into `edits`: a gap of more than twice the context splits them.
  const hunks: { from: number; to: number }[] = []
  for (let i = 0; i < edits.length; i++) {
    if (edits[i]!.kind === 'same') continue
    const last = hunks.at(-1)
    if (last && i - last.to <= CONTEXT * 2) last.to = i
    else hunks.push({ from: i, to: i })
  }
  if (hunks.length === 0) return { patch: '', adds: 0, dels: 0, lines: 0, truncated: false }

  let adds = 0
  let dels = 0
  let lines = 0
  const out = [
    `--- ${oldLines.length === 0 ? '/dev/null' : `a/${rel}`}`,
    `+++ ${newLines.length === 0 ? '/dev/null' : `b/${rel}`}`,
  ]
  let oldPos = 0
  let newPos = 0
  let at = 0
  const advance = (edit: Edit) => {
    if (edit.kind !== 'add') oldPos++
    if (edit.kind !== 'del') newPos++
  }
  for (const hunk of hunks) {
    if (lines >= maxLines) break
    const from = Math.max(0, hunk.from - CONTEXT)
    const to = Math.min(edits.length - 1, hunk.to + CONTEXT)
    while (at < from) advance(edits[at++]!)
    const oldStart = oldPos
    const newStart = newPos
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    while (at <= to && lines < maxLines) {
      const edit = edits[at++]!
      if (edit.kind === 'same') {
        body.push(` ${oldLines[edit.oldIndex]!}`)
        oldCount++
        newCount++
      } else if (edit.kind === 'del') {
        body.push(`-${oldLines[edit.oldIndex]!}`)
        oldCount++
        dels++
      } else {
        body.push(`+${newLines[edit.newIndex]!}`)
        newCount++
        adds++
      }
      lines++
      advance(edit)
    }
    // An empty side names the line *before* the hunk, unshifted: `-0,0` is a new file's.
    const oldHeader = oldCount === 0 ? oldStart : oldStart + 1
    const newHeader = newCount === 0 ? newStart : newStart + 1
    out.push(`@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`, ...body)
  }
  // Whatever the cap left unemitted still counts: adds/dels describe the whole change.
  let truncated = false
  while (at < edits.length) {
    const kind = edits[at++]!.kind
    if (kind === 'del') {
      dels++
      truncated = true
    } else if (kind === 'add') {
      adds++
      truncated = true
    }
  }
  return { patch: `${out.join('\n')}\n`, adds, dels, lines, truncated }
}
