// Rows are 0-based and ranges inclusive, matching the editor's logical cursor.

import { outdentWidth } from './typing'

const indentOf = (line: string) => line.length - line.trimStart().length

export function toggleComment(
  text: string,
  from: number,
  to: number,
  prefix: string
): string {
  const lines = text.split('\n')
  const picked = () => lines.slice(from, to + 1)
  const active = picked().filter((line) => line.trim().length > 0)
  if (active.length === 0) {
    return text
  }

  const commented = active.every((line) => line.trimStart().startsWith(prefix))
  if (commented) {
    for (let row = from; row <= to; row += 1) {
      const line = lines[row]!
      const at = indentOf(line)
      if (!line.slice(at).startsWith(prefix)) {
        continue
      }
      const after = line.slice(at + prefix.length)
      lines[row] =
        line.slice(0, at) + (after.startsWith(' ') ? after.slice(1) : after)
    }
  } else {
    const indent = Math.min(...active.map(indentOf))
    for (let row = from; row <= to; row += 1) {
      if (lines[row]!.trim().length === 0) {
        continue
      }
      lines[row] =
        `${lines[row]!.slice(0, indent)}${prefix} ${lines[row]!.slice(indent)}`
    }
  }
  return lines.join('\n')
}

export function moveLines(
  text: string,
  from: number,
  to: number,
  delta: -1 | 1
): string | null {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a movable line.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  if (from + delta < 0 || to + delta > last) {
    return null
  }
  const block = lines.splice(from, to - from + 1)
  lines.splice(from + delta, 0, ...block)
  return lines.join('\n')
}

export function removeLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a line: deleting it takes the newline.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  const start = Math.max(0, from)
  const end = Math.min(to, last)
  if (end < start) {
    return text
  }
  lines.splice(start, end - start + 1)
  return lines.join('\n')
}

export function duplicateLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  lines.splice(to + 1, 0, ...lines.slice(from, to + 1))
  return lines.join('\n')
}

export function trimTrailing(text: string): string {
  const trimmed = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
}

export function indentLines(
  text: string,
  from: number,
  to: number,
  tabSize: number,
  outdent: boolean
): string {
  const lines = text.split('\n')
  for (let row = from; row <= to; row += 1) {
    const line = lines[row]
    if (line === undefined) {
      continue
    }
    if (outdent) {
      lines[row] = line.slice(outdentWidth(line, tabSize))
    } else if (line.trim().length > 0) {
      lines[row] = ' '.repeat(tabSize) + line
    }
  }
  return lines.join('\n')
}
