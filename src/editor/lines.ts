/**
 * Whole-line edits, pure text-in text-out so they unit-test without a buffer.
 * Rows are 0-based and ranges inclusive, matching the editor's logical cursor.
 */

const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * Comment the lines `from`..`to` with `prefix`, or uncomment when every
 * non-blank line already carries it. The prefix lands at the shallowest indent
 * of the block, so a commented block stays visually aligned.
 */
export function toggleComment(text: string, from: number, to: number, prefix: string): string {
  const lines = text.split('\n')
  const picked = () => lines.slice(from, to + 1)
  const active = picked().filter(line => line.trim().length > 0)
  if (active.length === 0) return text

  const commented = active.every(line => line.trimStart().startsWith(prefix))
  if (commented) {
    for (let row = from; row <= to; row++) {
      const line = lines[row]!
      const at = indentOf(line)
      if (!line.slice(at).startsWith(prefix)) continue
      const after = line.slice(at + prefix.length)
      lines[row] = line.slice(0, at) + (after.startsWith(' ') ? after.slice(1) : after)
    }
  } else {
    const indent = Math.min(...active.map(indentOf))
    for (let row = from; row <= to; row++) {
      if (lines[row]!.trim().length === 0) continue
      lines[row] = `${lines[row]!.slice(0, indent)}${prefix} ${lines[row]!.slice(indent)}`
    }
  }
  return lines.join('\n')
}

/** Move lines `from`..`to` one step up or down, or null at the buffer's edge. */
export function moveLines(text: string, from: number, to: number, delta: -1 | 1): string | null {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a movable line.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  if (from + delta < 0 || to + delta > last) return null
  const block = lines.splice(from, to - from + 1)
  lines.splice(from + delta, 0, ...block)
  return lines.join('\n')
}

/**
 * Drop lines `from`..`to`, the newline that ends each of them included, so what
 * follows keeps its own indentation instead of being pulled onto the line above.
 */
export function removeLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a line to delete —
  // taking it would leave the file without its final newline.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  const start = Math.max(0, from)
  const end = Math.min(to, last)
  if (end < start) return text
  lines.splice(start, end - start + 1)
  return lines.join('\n')
}

/** Insert a copy of lines `from`..`to` directly below them. */
export function duplicateLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  lines.splice(to + 1, 0, ...lines.slice(from, to + 1))
  return lines.join('\n')
}

/** Strip trailing spaces and tabs from every line and end with one newline. */
export function trimTrailing(text: string): string {
  const trimmed = text
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
}
