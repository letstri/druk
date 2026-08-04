/**
 * Fitting text to a column budget.
 *
 * A `<text>` wraps by word unless it is told not to, so anything the user's own
 * data reaches — a branch name, a path, a commit subject, a diagnostic — has to
 * be cut to the room it has. Left alone it does not overflow quietly: the row
 * grows to two, five, ninety lines and takes the panel's layout with it.
 */

/** At most `room` columns, the ellipsis counted inside the budget. */
export function cut(text: string, room: number): string {
  if (room <= 0) return ''
  return text.length > room ? `${text.slice(0, room - 1)}…` : text
}

/**
 * Break `text` onto lines of at most `width`, for the modals that show a whole
 * message rather than a row of one.
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    // A single word longer than the width has to be cut; there is nowhere to break it.
    if (word.length > width) {
      if (line) lines.push(line)
      for (let at = 0; at < word.length; at += width) lines.push(word.slice(at, at + width))
      line = ''
      continue
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}
