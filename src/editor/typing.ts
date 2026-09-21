import type { KeyEvent, TextareaRenderable } from '@opentui/core'

const PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '(': ')',
  '[': ']',
  '`': '`',
  '{': '}',
}
const CLOSERS = new Set(Object.values(PAIRS))

const lineAt = (editor: TextareaRenderable, row: number) =>
  editor.plainText.split('\n')[row] ?? ''

const indentOf = (line: string) =>
  line.slice(0, line.length - line.trimStart().length)

// A tab is a stop, not a character: `col` counts characters and the stop is counted in cells.
const cellColumn = (line: string, col: number, tabSize: number) => {
  let cells = 0
  for (const char of line.slice(0, col)) {
    cells += char === '\t' ? tabSize - (cells % tabSize) : 1
  }
  return cells + Math.max(0, col - line.length)
}

// One indent stop off the front: a tab, else up to `tabSize` spaces. Counting characters
// instead takes both tabs off a `\t\tfoo` line whenever `tabSize` is 2.
export function outdentWidth(line: string, tabSize: number): number {
  const lead = indentOf(line)
  if (lead.startsWith('\t')) {
    return 1
  }
  return Math.min(lead.length, tabSize)
}

// The textarea binds no Tab and has no indent action: without this the key does nothing.
export function handleTyping(
  editor: TextareaRenderable,
  key: KeyEvent,
  tabSize: number
): boolean {
  const { row, col } = editor.logicalCursor
  const line = lineAt(editor, row)
  const next = line[col] ?? ''

  if (key.name === 'tab') {
    if (key.shift) {
      const drop = outdentWidth(line, tabSize)
      if (drop === 0) {
        return true
      }
      editor.setCursor(row, drop)
      for (let i = 0; i < drop; i += 1) {
        editor.deleteCharBackward()
      }
      editor.setCursor(row, Math.max(0, col - drop))
      return true
    }
    editor.insertText(
      ' '.repeat(tabSize - (cellColumn(line, col, tabSize) % tabSize))
    )
    return true
  }

  if (key.name === 'return' || key.name === 'enter') {
    const indent = indentOf(line)
    const opensBlock = /[([{]$/u.test(line.slice(0, col).trimEnd())
    editor.insertText(`\n${indent}${opensBlock ? ' '.repeat(tabSize) : ''}`)
    if (opensBlock && /^[)\]}]/u.test(next)) {
      const at = editor.logicalCursor
      editor.insertText(`\n${indent}`)
      editor.setCursor(at.row, at.col)
    }
    return true
  }

  const typed = key.sequence
  if (!typed || typed.length !== 1 || key.ctrl || key.meta) {
    return false
  }

  if (CLOSERS.has(typed) && next === typed) {
    editor.setCursor(row, col + 1)
    return true
  }

  const closer = PAIRS[typed]
  if (!closer) {
    return false
  }
  if (next && !/[\s)\]}>,;]/u.test(next)) {
    return false
  }
  // A quote after a word character is an apostrophe, not an opener.
  if (closer === typed && /[\w'"`]$/u.test(line.slice(0, col))) {
    return false
  }

  editor.insertText(typed + closer)
  editor.setCursor(row, col + 1)
  return true
}
