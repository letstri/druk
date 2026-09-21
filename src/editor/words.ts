const WORD_CHAR = /[A-Za-z0-9_$]/u

type CharClass = 'word' | 'space' | 'newline' | 'other'

function classOf(ch: string): CharClass {
  if (WORD_CHAR.test(ch)) {
    return 'word'
  }
  // Its own class: a newline in a run makes a double-click select `();\n` and eat the next line.
  if (ch === '\n' || ch === '\r') {
    return 'newline'
  }
  if (ch === ' ' || ch === '\t') {
    return 'space'
  }
  return 'other'
}

// Exclusive `[start, end)`; a caret on a line terminator selects nothing.
export function wordRangeAt(
  text: string,
  offset: number
): { start: number; end: number } {
  if (text.length === 0) {
    return { end: 0, start: 0 }
  }
  const at = Math.min(Math.max(0, offset), text.length)
  const ch = at < text.length ? text[at]! : text[at - 1]!
  const kind = classOf(ch)
  if (kind === 'newline') {
    return { end: at, start: at }
  }
  let start = at < text.length ? at : at - 1
  let end = start + 1
  while (start > 0 && classOf(text[start - 1]!) === kind) {
    start -= 1
  }
  while (end < text.length && classOf(text[end]!) === kind) {
    end += 1
  }
  return { end, start }
}

// Exclusive `[start, end)` of the line containing `offset`, including its `\n`.
export function lineRangeAt(
  text: string,
  offset: number
): { start: number; end: number } {
  if (text.length === 0) {
    return { end: 0, start: 0 }
  }
  const at = Math.min(Math.max(0, offset), text.length)
  const start = text.lastIndexOf('\n', at - 1) + 1
  const nl = text.indexOf('\n', at)
  const end = nl === -1 ? text.length : nl + 1
  return { end, start }
}
