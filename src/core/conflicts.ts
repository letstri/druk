/**
 * Merge conflict markers in a file's text — the `<<<<<<<` / `=======` /
 * `>>>>>>>` blocks git leaves behind when it cannot merge two sides itself.
 *
 * Everything here is line numbers into the text it was given, so the editor's
 * highlighting, its conflict navigation and the accept-one-side commands all
 * read the same parse rather than each recognising markers their own way.
 *
 * The buffer is the source, not the file on disk: a conflict is resolved by
 * editing text that may already be dirty, and `git checkout --ours` would throw
 * those edits away.
 */

/** Exactly seven, then end of line or a space and a label — git's own spelling.
 * Eight of them is not a marker, and a `\r` is tolerated so a CRLF file parses. */
const OURS = /^<{7}(?: (.*))?\r?$/
const BASE = /^\|{7}(?: (.*))?\r?$/
const SEPARATOR = /^={7}\r?$/
const THEIRS = /^>{7}(?: (.*))?\r?$/

/** One conflict block. Every field is a 0-based line number into the text. */
export interface MergeConflict {
  /** The `<<<<<<<` line. */
  start: number
  /** The `|||||||` line — diff3 style only, null in the default two-way one. */
  base: number | null
  /** The `=======` line. */
  separator: number
  /** The `>>>>>>>` line. */
  end: number
  /** What the markers call the two sides: `HEAD`, `feature/x`, a commit's oid. */
  ours: string
  theirs: string
}

/** Which side of a conflict to keep. `both` keeps ours then theirs, in that order. */
export type ConflictSide = 'ours' | 'theirs' | 'both'

/**
 * Every complete conflict in `text`, in order.
 *
 * A block missing its `=======` or `>>>>>>>` is left out rather than guessed at:
 * an unterminated marker is as likely to be prose about conflicts as a real one,
 * and offering to "resolve" it would eat the rest of the file.
 */
export function parseConflicts(text: string): MergeConflict[] {
  // The active buffer is reparsed on every keystroke, and all but a handful of
  // files in a lifetime hold no marker at all: one substring scan is what keeps
  // this off the typing path, where splitting a big file would not be.
  if (!text.startsWith('<<<<<<<') && !text.includes('\n<<<<<<<')) return []
  const lines = text.split('\n')
  const found: MergeConflict[] = []
  let open: { start: number; ours: string; base: number | null; separator: number | null } | null =
    null

  for (const [at, line] of lines.entries()) {
    const ours = OURS.exec(line)
    if (ours) {
      // A second `<<<<<<<` before the first closed: the earlier one was never a
      // conflict git wrote, so the newer marker wins rather than both being lost.
      open = { start: at, ours: ours[1] ?? '', base: null, separator: null }
      continue
    }
    if (!open) continue
    if (BASE.test(line)) {
      open.base ??= at
      continue
    }
    if (SEPARATOR.test(line)) {
      open.separator ??= at
      continue
    }
    const theirs = THEIRS.exec(line)
    if (!theirs) continue
    if (open.separator !== null) {
      found.push({
        start: open.start,
        base: open.base,
        separator: open.separator,
        end: at,
        ours: open.ours,
        theirs: theirs[1] ?? '',
      })
    }
    open = null
  }

  return found
}

/** Whether `line` is inside `conflict`, markers included. */
export const covers = (conflict: MergeConflict, line: number): boolean =>
  line >= conflict.start && line <= conflict.end

/** The conflict `line` sits in, or null when the cursor is outside every one. */
export const conflictAt = (
  conflicts: readonly MergeConflict[],
  line: number,
): MergeConflict | null => conflicts.find(conflict => covers(conflict, line)) ?? null

/**
 * The next conflict in `direction` from `line`, wrapping at the ends — the same
 * walk `problemFrom` does, since a file with two conflicts left is one the reader
 * wants to cycle rather than fall off. Null only when there are none at all.
 */
export function conflictFrom(
  conflicts: readonly MergeConflict[],
  line: number,
  direction: 1 | -1,
): MergeConflict | null {
  if (conflicts.length === 0) return null
  if (direction === 1) return conflicts.find(conflict => conflict.start > line) ?? conflicts[0]!
  return conflicts.findLast(conflict => conflict.start < line) ?? conflicts.at(-1)!
}

/** Offset of the first character of each line, plus one past the end of the text. */
function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) offsets.push(at + 1)
  offsets.push(text.length + 1)
  return offsets
}

/**
 * `text` with `conflict` replaced by the side chosen, markers and all.
 *
 * Sliced out of the original rather than rebuilt from split lines: everything
 * outside the block — including line endings the file may not spell the way this
 * one does — comes back byte for byte.
 */
export function resolveConflict(text: string, conflict: MergeConflict, side: ConflictSide): string {
  const offsets = lineOffsets(text)
  // Clamped: the last line of a file with no trailing newline has no offset after
  // it, and a conflict ending there would otherwise slice past the array.
  const at = (line: number) => offsets[Math.min(line, offsets.length - 1)] ?? text.length
  // In diff3 the base section sits between ours and the separator, so ours ends
  // at whichever of the two comes first.
  const ours = text.slice(at(conflict.start + 1), at(conflict.base ?? conflict.separator))
  const theirs = text.slice(at(conflict.separator + 1), at(conflict.end))
  const kept = side === 'ours' ? ours : side === 'theirs' ? theirs : ours + theirs
  return text.slice(0, at(conflict.start)) + kept + text.slice(at(conflict.end + 1))
}
