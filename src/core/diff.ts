export interface UnifiedDiff {
  patch: string
  adds: number
  dels: number
  lines: number
  truncated: boolean
}

function splitText(text: string): string[] {
  if (text.length === 0) {
    return []
  }
  const lines = text.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

const NO_NEWLINE = '\\ No newline at end of file'

interface Open {
  new: number
  old: number
}

// The index of a last line no newline follows, which git marks; -1 when there is none.
function openLine(lines: string[], text: string): number {
  return lines.length > 0 && !text.endsWith('\n') ? lines.length - 1 : -1
}

// A line never holds `\n`, so this keeps an unterminated last line from matching a terminated one.
function comparable(lines: string[], open: number): string[] {
  if (open < 0) {
    return lines
  }
  const keys = [...lines]
  keys[open] = `${keys[open]!}\n`
  return keys
}

// The marker is not counted in `lines`: the `<diff>` renderable draws no row for it.
function pushRow(body: string[], row: string, open: boolean) {
  body.push(row)
  if (open) {
    body.push(NO_NEWLINE)
  }
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
    start += 1
  }
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd -= 1
    newEnd -= 1
  }

  const middle = myers(
    oldLines.slice(start, oldEnd),
    newLines.slice(start, newEnd),
    start,
    start
  )
  if (middle === null) {
    return { newEnd, oldEnd, start }
  }

  const edits: Edit[] = []
  for (let i = 0; i < start; i += 1) {
    edits.push({ kind: 'same', newIndex: i, oldIndex: i })
  }
  edits.push(...middle)
  for (let i = oldEnd; i < oldLines.length; i += 1) {
    edits.push({ kind: 'same', newIndex: i - oldEnd + newEnd, oldIndex: i })
  }
  return edits
}

function myers(
  a: string[],
  b: string[],
  oldBase: number,
  newBase: number
): Edit[] | null {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) {
    return []
  }

  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max
  // v[k + offset] = furthest x on diagonal k after d steps; trace keeps a copy per d.
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []

  let found = -1
  for (let d = 0; d <= max && found < 0; d += 1) {
    // oxlint-disable-next-line unicorn/prefer-spread -- a spread copy is a number[], not an Int32Array.
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
          ? v[k + 1 + offset]!
          : v[k - 1 + offset]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }

  if (found < 0) {
    return null
  }

  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d]!
    const k = x - y
    const fromK =
      k === -d || (k !== d && prev[k - 1 + offset]! < prev[k + 1 + offset]!)
        ? k + 1
        : k - 1
    const prevX = prev[fromK + offset]!
    const prevY = prevX - fromK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      edits.push({ kind: 'same', newIndex: newBase + y, oldIndex: oldBase + x })
    }
    if (x === prevX) {
      y -= 1
      edits.push({ kind: 'add', newIndex: newBase + y, oldIndex: -1 })
    } else {
      x -= 1
      edits.push({ kind: 'del', newIndex: -1, oldIndex: oldBase + x })
    }
  }
  while (x > 0 && y > 0) {
    x -= 1
    y -= 1
    edits.push({ kind: 'same', newIndex: newBase + y, oldIndex: oldBase + x })
  }
  return edits.toReversed()
}

const CONTEXT = 3

function rewritePatch(
  rel: string,
  oldLines: string[],
  newLines: string[],
  { start, oldEnd, newEnd }: Rewrite,
  open: Open,
  maxLines: number
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
  for (
    let i = start - ctxBefore;
    i < start && lines < maxLines;
    i += 1, lines += 1
  ) {
    pushRow(body, ` ${oldLines[i]!}`, i === open.old)
  }
  // Half the budget each: deletions alone would fill it and the new side would never be drawn.
  const share =
    dels > 0 && adds > 0 ? Math.floor((maxLines - lines) / 2) : maxLines
  const delCap = Math.min(maxLines, lines + share)
  for (let i = start; i < oldEnd && lines < delCap; i += 1, lines += 1) {
    pushRow(body, `-${oldLines[i]!}`, i === open.old)
    emittedDels += 1
  }
  for (let i = start; i < newEnd && lines < maxLines; i += 1, lines += 1) {
    pushRow(body, `+${newLines[i]!}`, i === open.new)
    emittedAdds += 1
  }
  for (
    let i = oldEnd;
    i < oldEnd + ctxAfter && lines < maxLines;
    i += 1, lines += 1
  ) {
    pushRow(body, ` ${oldLines[i]!}`, i === open.old)
    emittedAfter += 1
  }
  const hunkStart = start - ctxBefore
  const oldCount = ctxBefore + emittedDels + emittedAfter
  const newCount = ctxBefore + emittedAdds + emittedAfter
  const oldHeader = oldCount === 0 ? hunkStart : hunkStart + 1
  const newHeader = newCount === 0 ? hunkStart : hunkStart + 1
  out.push(`@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`, ...body)
  return {
    adds,
    dels,
    lines,
    patch: `${out.join('\n')}\n`,
    truncated: emittedDels < dels || emittedAdds < adds,
  }
}

export function unifiedDiff(
  rel: string,
  oldText: string,
  newText: string,
  maxLines = Number.POSITIVE_INFINITY
): UnifiedDiff {
  const oldLines = splitText(oldText)
  const newLines = splitText(newText)
  const open = {
    new: openLine(newLines, newText),
    old: openLine(oldLines, oldText),
  }
  const edits = lineEdits(
    comparable(oldLines, open.old),
    comparable(newLines, open.new)
  )
  if (!Array.isArray(edits)) {
    return rewritePatch(rel, oldLines, newLines, edits, open, maxLines)
  }

  // Hunks as index ranges into `edits`: a gap of more than twice the context splits them.
  const hunks: { from: number; to: number }[] = []
  for (let i = 0; i < edits.length; i += 1) {
    if (edits[i]!.kind === 'same') {
      continue
    }
    const last = hunks.at(-1)
    if (last && i - last.to <= CONTEXT * 2) {
      last.to = i
    } else {
      hunks.push({ from: i, to: i })
    }
  }
  if (hunks.length === 0) {
    return { adds: 0, dels: 0, lines: 0, patch: '', truncated: false }
  }

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
    if (edit.kind !== 'add') {
      oldPos += 1
    }
    if (edit.kind !== 'del') {
      newPos += 1
    }
  }
  for (const hunk of hunks) {
    if (lines >= maxLines) {
      break
    }
    const from = Math.max(0, hunk.from - CONTEXT)
    const to = Math.min(edits.length - 1, hunk.to + CONTEXT)
    while (at < from) {
      advance(edits[at]!)
      at += 1
    }
    const oldStart = oldPos
    const newStart = newPos
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    while (at <= to && lines < maxLines) {
      const edit = edits[at]!
      at += 1
      if (edit.kind === 'same') {
        pushRow(
          body,
          ` ${oldLines[edit.oldIndex]!}`,
          edit.oldIndex === open.old
        )
        oldCount += 1
        newCount += 1
      } else if (edit.kind === 'del') {
        pushRow(
          body,
          `-${oldLines[edit.oldIndex]!}`,
          edit.oldIndex === open.old
        )
        oldCount += 1
        dels += 1
      } else {
        pushRow(
          body,
          `+${newLines[edit.newIndex]!}`,
          edit.newIndex === open.new
        )
        newCount += 1
        adds += 1
      }
      lines += 1
      advance(edit)
    }
    // An empty side names the line *before* the hunk, unshifted: `-0,0` is a new file's.
    const oldHeader = oldCount === 0 ? oldStart : oldStart + 1
    const newHeader = newCount === 0 ? newStart : newStart + 1
    out.push(
      `@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`,
      ...body
    )
  }
  // Whatever the cap left unemitted still counts: adds/dels describe the whole change.
  let truncated = false
  while (at < edits.length) {
    const { kind } = edits[at]!
    at += 1
    if (kind === 'del') {
      dels += 1
      truncated = true
    } else if (kind === 'add') {
      adds += 1
      truncated = true
    }
  }
  return { adds, dels, lines, patch: `${out.join('\n')}\n`, truncated }
}
