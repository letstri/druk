/** Identifier characters — same set the completion prefix uses. */
const WORD_CHAR = /[A-Za-z0-9_$]/

type CharClass = 'word' | 'space' | 'other'

function classOf(ch: string): CharClass {
  if (WORD_CHAR.test(ch)) return 'word'
  // Newlines are not part of a space run: a double-click on indent must not
  // swallow the previous line's trailing spaces.
  if (ch === ' ' || ch === '\t') return 'space'
  return 'other'
}

/**
 * Exclusive `[start, end)` of the token under `offset` — an identifier, a run of
 * spaces/tabs, or a run of the same other character class (punctuation). The
 * same rule applies inside quoted strings: a double-click on `hello` in
 * `"hello world"` selects `hello`, not the whole literal.
 */
export function wordRangeAt(text: string, offset: number): { start: number; end: number } {
  if (text.length === 0) return { start: 0, end: 0 }
  const at = Math.min(Math.max(0, offset), text.length)
  const ch = at < text.length ? text[at]! : text[at - 1]!
  const kind = classOf(ch)
  // When the caret sits past the last character, grow from that character.
  let start = at < text.length ? at : at - 1
  let end = start + 1
  while (start > 0 && classOf(text[start - 1]!) === kind) start--
  while (end < text.length && classOf(text[end]!) === kind) end++
  return { start, end }
}

/** Exclusive `[start, end)` of the line containing `offset`, including its `\n`. */
export function lineRangeAt(text: string, offset: number): { start: number; end: number } {
  if (text.length === 0) return { start: 0, end: 0 }
  const at = Math.min(Math.max(0, offset), text.length)
  const start = text.lastIndexOf('\n', at - 1) + 1
  const nl = text.indexOf('\n', at)
  const end = nl >= 0 ? nl + 1 : text.length
  return { start, end }
}
