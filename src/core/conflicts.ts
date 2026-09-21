// Exactly seven: eight is not a marker, and a `\r` is tolerated so a CRLF file parses.
const OURS = /^<{7}(?: (.*))?\r?$/u
const BASE = /^\|{7}(?: (.*))?\r?$/u
const SEPARATOR = /^={7}\r?$/u
const THEIRS = /^>{7}(?: (.*))?\r?$/u

// Every field is a 0-based line number into the text.
export interface MergeConflict {
  start: number
  base: number | null
  separator: number
  end: number
  ours: string
  theirs: string
}

export type ConflictSide = 'ours' | 'theirs' | 'both'

export function parseConflicts(text: string): MergeConflict[] {
  // Reparsed on every keystroke: the substring scan keeps a big file's split off the typing path.
  if (!text.startsWith('<<<<<<<') && !text.includes('\n<<<<<<<')) {
    return []
  }
  const lines = text.split('\n')
  const found: MergeConflict[] = []
  let open: {
    start: number
    ours: string
    base: number | null
    separator: number | null
  } | null = null

  for (const [at, line] of lines.entries()) {
    const ours = OURS.exec(line)
    if (ours) {
      // A second `<<<<<<<` before the first closed: the newer marker wins, not both lost.
      open = { base: null, ours: ours[1] ?? '', separator: null, start: at }
      continue
    }
    if (!open) {
      continue
    }
    if (BASE.test(line)) {
      open.base ??= at
      continue
    }
    if (SEPARATOR.test(line)) {
      open.separator ??= at
      continue
    }
    const theirs = THEIRS.exec(line)
    if (!theirs) {
      continue
    }
    if (open.separator !== null) {
      found.push({
        base: open.base,
        end: at,
        ours: open.ours,
        separator: open.separator,
        start: open.start,
        theirs: theirs[1] ?? '',
      })
    }
    open = null
  }

  return found
}

export const covers = (conflict: MergeConflict, line: number): boolean =>
  line >= conflict.start && line <= conflict.end

export const conflictAt = (
  conflicts: readonly MergeConflict[],
  line: number
): MergeConflict | null =>
  conflicts.find((conflict) => covers(conflict, line)) ?? null

export function conflictFrom(
  conflicts: readonly MergeConflict[],
  line: number,
  direction: 1 | -1
): MergeConflict | null {
  if (conflicts.length === 0) {
    return null
  }
  if (direction === 1) {
    return conflicts.find((conflict) => conflict.start > line) ?? conflicts[0]!
  }
  return (
    conflicts.findLast((conflict) => conflict.start < line) ?? conflicts.at(-1)!
  )
}

function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    offsets.push(at + 1)
  }
  offsets.push(text.length + 1)
  return offsets
}

// Sliced out of the original, never rebuilt from split lines: line endings survive byte for byte.
export function resolveConflict(
  text: string,
  conflict: MergeConflict,
  side: ConflictSide
): string {
  const offsets = lineOffsets(text)
  // Clamped: a file with no trailing newline has no offset after its last line.
  const at = (line: number) =>
    offsets[Math.min(line, offsets.length - 1)] ?? text.length
  // diff3 puts the base section between ours and the separator, so ours ends at whichever is first.
  const ours = text.slice(
    at(conflict.start + 1),
    at(conflict.base ?? conflict.separator)
  )
  const theirs = text.slice(at(conflict.separator + 1), at(conflict.end))
  const kept =
    side === 'ours' ? ours : side === 'theirs' ? theirs : ours + theirs
  return (
    text.slice(0, at(conflict.start)) + kept + text.slice(at(conflict.end + 1))
  )
}
