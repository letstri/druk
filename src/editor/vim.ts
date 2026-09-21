import type { KeyEvent, TextareaRenderable } from '@opentui/core'

import { latinKey } from '../core/keylayout'

export type VimMode = 'normal' | 'insert' | 'visual'

type VisualKind = 'char' | 'line'

type FindKind = 'f' | 'F' | 't' | 'T'

export const MODE_LABELS: Record<VimMode, string> = {
  insert: 'INSERT',
  normal: 'NORMAL',
  visual: 'VISUAL',
}

export interface VimState {
  mode: VimMode
  // partial operator, e.g. "d" waiting for a motion, or "g"
  pending: string
  // numeric prefix, e.g. "12" in 12j
  count: string
  // last yanked/deleted text
  register: string
  registerLinewise: boolean
  anchor: number
  visualKind: VisualKind
  // text object prefix (i = inner, a = a/an)
  pendingTobj: 'i' | 'a' | null
  textObjOp: '' | 'd' | 'c' | 'y'
  pendingFind: FindKind | null
  findOp: '' | 'd' | 'c' | 'y'
  lastFind: { kind: FindKind; char: string } | null
}

export function initialVimState(): VimState {
  return {
    anchor: 0,
    count: '',
    findOp: '',
    lastFind: null,
    mode: 'normal',
    pending: '',
    pendingFind: null,
    pendingTobj: null,
    register: '',
    registerLinewise: false,
    textObjOp: '',
    visualKind: 'char',
  }
}

// The pane's, not the buffer's: a wholesale text replace resets the buffer's own undo.
export interface VimActions {
  undo: () => void
  redo: () => void
  centerLine: () => void
}

type Editor = TextareaRenderable

// `boundary` — what the pane is built with, so a drag replaces what it paints — makes the
// inclusive setter exclusive again, one character short of what vim selected.
function selectInclusive(editor: Editor, start: number, end: number): void {
  editor.selectionOccupancy = 'cell'
  editor.setSelectionInclusive(start, end)
}

// Vim's selection covers the character under the cursor and works backwards; `select: true` cannot.
function markVisual(editor: Editor, state: VimState): void {
  const cursor = editor.cursorOffset
  if (state.visualKind === 'line') {
    const text = editor.plainText
    const start = lineStart(text, Math.min(state.anchor, cursor))
    let end = lineEnd(text, Math.max(state.anchor, cursor))
    if (end < start) {
      end = start
    }
    selectInclusive(editor, start, end)
  } else {
    selectInclusive(
      editor,
      Math.min(state.anchor, cursor),
      Math.max(state.anchor, cursor)
    )
  }
}

const MOTION_KEYS = new Set([
  'h',
  'left',
  'l',
  'right',
  'j',
  'down',
  'k',
  'up',
  'w',
  'b',
  '0',
  '$',
  'G',
  '{',
  '}',
  ';',
  ',',
])

const FIND_KEYS = new Set(['f', 'F', 't', 'T'])
const OPPOSITE: Record<FindKind, FindKind> = { F: 'f', T: 't', f: 'F', t: 'T' }

function motion(
  editor: Editor,
  k: string,
  state: VimState,
  count: number,
  counted: boolean
) {
  if (!MOTION_KEYS.has(k)) {
    return false
  }
  // A cursor move with a selection live collapses it instead of moving.
  if (state.mode === 'visual') {
    editor.clearSelection()
  }
  const repeat = (fn: () => void) => {
    for (let i = 0; i < count; i += 1) {
      fn()
    }
  }

  switch (k) {
    case 'h':
    case 'left': {
      repeat(() => editor.moveCursorLeft())
      return true
    }
    case 'l':
    case 'right': {
      repeat(() => editor.moveCursorRight())
      return true
    }
    case 'j':
    case 'down': {
      repeat(() => editor.moveCursorDown())
      return true
    }
    case 'k':
    case 'up': {
      repeat(() => editor.moveCursorUp())
      return true
    }
    case 'w': {
      repeat(() => editor.moveWordForward())
      return true
    }
    case 'b': {
      repeat(() => editor.moveWordBackward())
      return true
    }
    case '0': {
      editor.gotoLineHome()
      return true
    }
    case '$': {
      editor.gotoLineEnd()
      return true
    }
    case 'G': {
      // `gotoLine` counts from zero, vim from one.
      if (counted) {
        editor.gotoLine(count - 1)
      } else {
        editor.gotoBufferEnd()
      }
      return true
    }
    case '{': {
      moveParagraphUp(editor, count)
      return true
    }
    case '}': {
      moveParagraphDown(editor, count)
      return true
    }
    case ';':
    case ',': {
      const last = state.lastFind
      if (last) {
        runFind(
          editor,
          state,
          k === ';' ? last.kind : OPPOSITE[last.kind],
          last.char,
          count,
          true,
          ''
        )
      }
      return true
    }
    default: {
      return false
    }
  }
}

function yankSelection(editor: Editor, state: VimState): void {
  const text = editor.getSelectedText()
  if (text) {
    state.register = text
    state.registerLinewise = false
  }
}

// The trailing newline is load-bearing — `paste` strips it back off.
function yankLines(editor: Editor, state: VimState, count: number): void {
  const { row } = editor.logicalCursor
  state.register = `${editor.plainText
    .split('\n')
    .slice(row, row + count)
    .join('\n')}\n`
  state.registerLinewise = true
}

function deleteLine(editor: Editor, state: VimState, count: number): void {
  yankLines(editor, state, count)
  for (let i = 0; i < count; i += 1) {
    editor.deleteLine()
  }
}

const OPERATOR_TARGETS: Record<
  string,
  (editor: Editor, count: number) => void
> = {
  $: (e) => e.deleteToLineEnd(),
  0: (e) => e.deleteToLineStart(),
  b: (e, n) => {
    for (let i = 0; i < n; i += 1) {
      e.deleteWordBackward()
    }
  },
  w: (e, n) => {
    for (let i = 0; i < n; i += 1) {
      e.deleteWordForward()
    }
  },
}

function lineStart(text: string, offset: number): number {
  const idx = text.lastIndexOf('\n', offset - 1)
  return idx + 1
}

function lineEnd(text: string, offset: number): number {
  const idx = text.indexOf('\n', offset)
  return idx === -1 ? text.length - 1 : Math.max(0, idx - 1)
}

function findTarget(
  text: string,
  cursor: number,
  kind: FindKind,
  char: string,
  count: number,
  repeat: boolean
): number | null {
  const forward = kind === 'f' || kind === 't'
  const from = lineStart(text, cursor)
  const to = lineEnd(text, cursor)
  // `t` leaves the caret against its character, so a repeat would find the same one.
  const skip = repeat && (kind === 't' || kind === 'T') ? 1 : 0
  let left = count
  const step = forward ? 1 : -1
  for (let i = cursor + step * (1 + skip); i >= from && i <= to; i += step) {
    if (text[i] === char) {
      left -= 1
    }
    if (text[i] === char && left === 0) {
      if (kind === 'f' || kind === 'F') {
        return i
      }
      const target = kind === 't' ? i - 1 : i + 1
      // A motion that moves nowhere is a failure: `dt,` with the comma adjacent deletes nothing.
      return target === cursor ? null : target
    }
  }
  return null
}

// A failed motion takes its operator down with it: `dt,` with no comma deletes nothing.
function runFind(
  editor: Editor,
  state: VimState,
  kind: FindKind,
  char: string,
  count: number,
  repeat: boolean,
  op: '' | 'd' | 'c' | 'y'
): void {
  const cursor = editor.cursorOffset
  const target = findTarget(editor.plainText, cursor, kind, char, count, repeat)
  if (target === null) {
    return
  }
  if (state.mode === 'visual') {
    editor.clearSelection()
  }
  if (!op) {
    editor.cursorOffset = target
    return
  }
  // Forward takes the character landed on, backward leaves the one under the cursor.
  const forward = kind === 'f' || kind === 't'
  const start = forward ? cursor : target
  const end = forward ? target : cursor - 1
  if (end < start) {
    return
  }
  editor.setSelectionInclusive(start, end)
  yankSelection(editor, state)
  if (op === 'y') {
    editor.clearSelection()
    editor.cursorOffset = start
    return
  }
  editor.deleteSelection()
  state.mode = op === 'c' ? 'insert' : 'normal'
}

function moveParagraphUp(editor: Editor, count: number): void {
  const lines = editor.plainText.split('\n')
  let { row } = editor.logicalCursor

  for (let c = 0; c < count; c += 1) {
    if (row <= 0) {
      break
    }
    row -= 1
    while (row > 0 && lines[row]!.trim() !== '') {
      row -= 1
    }
  }

  editor.gotoLine(row)
}

function moveParagraphDown(editor: Editor, count: number): void {
  const lines = editor.plainText.split('\n')
  let { row } = editor.logicalCursor
  const maxRow = lines.length - 1

  for (let c = 0; c < count; c += 1) {
    if (row >= maxRow) {
      break
    }
    row += 1
    while (row < maxRow && lines[row]!.trim() !== '') {
      row += 1
    }
  }

  editor.gotoLine(Math.min(row, maxRow))
}

const PAIR_OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const PAIR_CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const TEXT_OBJ_TARGETS = new Set(['{', '}', '(', ')', '[', ']'])

function findEnclosingPair(
  text: string,
  cursor: number,
  open: string,
  close: string
): { open: number; close: number } | null {
  let depth = 1
  let openIdx = -1
  // A cursor on the close bracket would count it as a nested close and never find the open.
  const start = cursor > 0 && text[cursor] === close ? cursor - 1 : cursor
  for (let i = start; i >= 0; i -= 1) {
    if (text[i] === close) {
      depth += 1
    } else if (text[i] === open) {
      depth -= 1
      if (depth === 0) {
        openIdx = i
        break
      }
    }
  }
  if (openIdx === -1) {
    return null
  }

  depth = 1
  let closeIdx = -1
  for (let i = openIdx + 1; i < text.length; i += 1) {
    if (text[i] === open) {
      depth += 1
    } else if (text[i] === close) {
      depth -= 1
      if (depth === 0) {
        closeIdx = i
        break
      }
    }
  }
  if (closeIdx === -1) {
    return null
  }

  return { close: closeIdx, open: openIdx }
}

function handleTextObject(editor: Editor, k: string, state: VimState): boolean {
  if (!TEXT_OBJ_TARGETS.has(k)) {
    return false
  }
  const open = k in PAIR_OPEN ? k : PAIR_CLOSE[k]!
  const close = PAIR_OPEN[open]!
  const text = editor.plainText
  const cursor = editor.cursorOffset
  const pair = findEnclosingPair(text, cursor, open, close)
  if (!pair) {
    state.textObjOp = ''
    return true
  }

  if (state.pendingTobj === 'i') {
    if (pair.open + 1 >= pair.close) {
      state.textObjOp = ''
      return true
    }
    state.anchor = pair.open + 1
    editor.cursorOffset = pair.close - 1
  } else {
    state.anchor = pair.open
    editor.cursorOffset = pair.close
  }
  return true
}

function atLineEnd(editor: Editor): boolean {
  const { row, col } = editor.logicalCursor
  return col >= (editor.plainText.split('\n')[row]?.length ?? 0)
}

// The buffer's caret sits between characters and can rest past the end of a line; vim's cannot.
function clampToLine(editor: Editor, state: VimState): void {
  if (state.mode === 'insert') {
    return
  }
  if (atLineEnd(editor) && editor.logicalCursor.col > 0) {
    editor.moveCursorLeft()
  }
}

function paste(editor: Editor, state: VimState, before: boolean): void {
  if (!state.register) {
    return
  }
  if (state.registerLinewise) {
    if (before) {
      editor.gotoLineStart()
    } else {
      editor.gotoLineEnd()
      editor.newLine()
    }
    editor.insertText(state.register.replace(/\n$/u, ''))
    if (before) {
      editor.newLine()
      editor.moveCursorUp()
    }
  } else {
    // Past the last character, stepping right would carry the paste onto the next line.
    if (!before && !atLineEnd(editor)) {
      editor.moveCursorRight()
    }
    editor.insertText(state.register)
  }
}

export function handleVimKey(
  editor: Editor,
  key: KeyEvent,
  state: VimState,
  actions: VimActions
): boolean {
  const consumed = dispatch(editor, key, state, actions)
  // Dropped before the clamp and repainted after: unclamped, `v$` takes the newline.
  const visual = state.mode === 'visual'
  if (visual) {
    editor.clearSelection()
  }
  clampToLine(editor, state)
  if (visual) {
    markVisual(editor, state)
  }
  return consumed
}

function dispatch(
  editor: Editor,
  key: KeyEvent,
  state: VimState,
  actions: VimActions
): boolean {
  // A place on the keyboard, not a letter: with a Cyrillic layout `dd` arrives as `вв`.
  const pressed = latinKey(key)
  // Shifted letters arrive as the lowercase name plus `shift`.
  const k =
    key.shift && /^[a-z]$/u.test(pressed) ? pressed.toUpperCase() : pressed
  if (state.mode === 'insert') {
    if (k === 'escape') {
      state.mode = 'normal'
      editor.moveCursorLeft()
      return true
    }
    return false
  }

  // Before anything else can read the key: `f5` searches for a 5, `fd` is not a delete.
  if (state.pendingFind) {
    const kind = state.pendingFind
    const op = state.findOp
    const digits = state.count
    state.pendingFind = null
    state.findOp = ''
    state.count = ''
    if (key.ctrl || k.length !== 1) {
      return true
    }
    // The character is text, so the one the layout printed, not `k`'s place on the board.
    const char = key.sequence.length === 1 ? key.sequence : key.name
    state.lastFind = { char, kind }
    runFind(
      editor,
      state,
      kind,
      char,
      Math.max(1, Number(digits || '1')),
      false,
      op
    )
    return true
  }

  if (key.ctrl) {
    if (k === 'r') {
      actions.redo()
      return true
    }
    if (k === 'd' || k === 'u') {
      for (let i = 0; i < 10; i += 1) {
        if (k === 'd') {
          editor.moveCursorDown()
        } else {
          editor.moveCursorUp()
        }
      }
      return true
    }
    return false
  }

  // A leading "0" is the line-start motion, not the start of a count.
  if (/^\d$/u.test(k) && !(k === '0' && state.count === '')) {
    state.count += k
    return true
  }
  // Consumed here; only an operator setter puts it back, so `3dd` reaches `dd` with its 3.
  const digits = state.count
  state.count = ''
  const count = Math.max(1, Number(digits || '1'))

  if (state.pending) {
    const op = state.pending
    state.pending = ''

    // Only d/c/y take a text object: without the gate `gi` would paint a selection.
    if (
      (k === 'i' || k === 'a') &&
      !state.pendingTobj &&
      (op === 'd' || op === 'c' || op === 'y')
    ) {
      state.textObjOp = op
      state.pendingTobj = k
      state.count = digits
      return true
    }

    if (op === 'd' || op === 'c' || op === 'y') {
      if (FIND_KEYS.has(k)) {
        state.pendingFind = k as FindKind
        state.findOp = op
        state.count = digits
        return true
      }
      if ((k === ';' || k === ',') && state.lastFind) {
        const last = state.lastFind
        runFind(
          editor,
          state,
          k === ';' ? last.kind : OPPOSITE[last.kind],
          last.char,
          count,
          true,
          op
        )
        return true
      }
    }

    if (op === 'g') {
      if (k === 'g') {
        if (digits) {
          editor.gotoLine(count - 1)
        } else {
          editor.gotoBufferHome()
        }
        if (state.mode === 'visual') {
          markVisual(editor, state)
        }
      }
      return true
    }
    if (op === 'z') {
      if (k === 'z') {
        if (digits) {
          editor.gotoLine(count - 1)
        }
        actions.centerLine()
      }
      return true
    }
    if (k === op) {
      if (op === 'd') {
        deleteLine(editor, state, count)
      } else if (op === 'y') {
        yankLines(editor, state, count)
      } else if (op === 'c') {
        editor.gotoLineStart()
        editor.deleteToLineEnd()
        state.mode = 'insert'
      }
      return true
    }
    if (op === 'd' || op === 'c') {
      const cut = OPERATOR_TARGETS[k]
      if (cut) {
        cut(editor, count)
        if (op === 'c') {
          state.mode = 'insert'
        }
      }
    }
    return true
  }

  // Before the motions, so `{` here is a text object and not a paragraph.
  if (state.pendingTobj) {
    if (TEXT_OBJ_TARGETS.has(k)) {
      handleTextObject(editor, k, state)
      state.pendingTobj = null
      const saved = state.textObjOp
      state.textObjOp = ''
      if (saved) {
        const start = Math.min(state.anchor, editor.cursorOffset)
        const end = Math.max(state.anchor, editor.cursorOffset)
        editor.setSelectionInclusive(start, end)
        if (saved === 'd') {
          yankSelection(editor, state)
          editor.deleteSelection()
          state.mode = 'normal'
        } else if (saved === 'y') {
          yankSelection(editor, state)
          editor.clearSelection()
          state.mode = 'normal'
        } else if (saved === 'c') {
          yankSelection(editor, state)
          editor.deleteSelection()
          state.mode = 'insert'
        }
      } else if (state.mode === 'visual') {
        editor.clearSelection()
        const cursor = editor.cursorOffset
        editor.setSelectionInclusive(
          Math.min(state.anchor, cursor),
          Math.max(state.anchor, cursor)
        )
      }
      return true
    }
    // Both reset: a leaked pendingTobj turns every later bracket key into a text object.
    state.pendingTobj = null
    state.textObjOp = ''
  }

  if (FIND_KEYS.has(k)) {
    state.pendingFind = k as FindKind
    state.count = digits
    return true
  }

  // Before the mode switches, so visual mode extends the selection.
  if (motion(editor, k, state, count, digits !== '')) {
    if (state.mode === 'visual') {
      markVisual(editor, state)
    }
    return true
  }

  // Ahead of the visual/normal split: `zz` recentres while a selection is live too.
  if (k === 'z') {
    state.pending = 'z'
    state.count = digits
    return true
  }

  if (state.mode === 'visual') {
    if (k === 'i' || k === 'a') {
      state.pendingTobj = k
      return true
    }

    const start = Math.min(state.anchor, editor.cursorOffset)

    if (state.visualKind === 'line') {
      const text = editor.plainText
      const lines = text.split('\n')
      const cursorRow = editor.logicalCursor.row
      const anchorRow = text.slice(0, state.anchor).split('\n').length - 1
      const rowStart = Math.min(anchorRow, cursorRow)
      const rowCount = Math.abs(anchorRow - cursorRow) + 1

      editor.clearSelection()

      switch (k) {
        case 'escape': {
          state.mode = 'normal'
          break
        }
        case 'd':
        case 'x':
        case 'c': {
          editor.gotoLine(rowStart)
          deleteLine(editor, state, rowCount)
          state.mode = k === 'c' ? 'insert' : 'normal'
          break
        }
        case 'y': {
          state.register = `${lines.slice(rowStart, rowStart + rowCount).join('\n')}\n`
          state.registerLinewise = true
          editor.cursorOffset = start
          state.mode = 'normal'
          break
        }
        default: {
          break
        }
      }
      return true
    }

    switch (k) {
      case 'escape': {
        editor.clearSelection()
        state.mode = 'normal'
        break
      }
      case 'd':
      case 'x': {
        yankSelection(editor, state)
        editor.deleteSelection()
        state.mode = 'normal'
        break
      }
      case 'y': {
        yankSelection(editor, state)
        editor.clearSelection()
        editor.cursorOffset = start
        state.mode = 'normal'
        break
      }
      case 'c': {
        yankSelection(editor, state)
        editor.deleteSelection()
        state.mode = 'insert'
        break
      }
      default: {
        break
      }
    }
    return true
  }

  switch (k) {
    case 'i': {
      state.mode = 'insert'
      break
    }
    case 'a': {
      editor.moveCursorRight()
      state.mode = 'insert'
      break
    }
    case 'I': {
      editor.gotoLineStart()
      state.mode = 'insert'
      break
    }
    case 'A': {
      editor.gotoLineEnd()
      state.mode = 'insert'
      break
    }
    case 'o': {
      editor.gotoLineEnd()
      editor.newLine()
      state.mode = 'insert'
      break
    }
    case 'O': {
      editor.gotoLineStart()
      editor.newLine()
      editor.moveCursorUp()
      state.mode = 'insert'
      break
    }
    case 'v': {
      state.visualKind = 'char'
      state.mode = 'visual'
      state.anchor = editor.cursorOffset
      markVisual(editor, state)
      break
    }
    case 'V': {
      state.visualKind = 'line'
      state.mode = 'visual'
      state.anchor = lineStart(editor.plainText, editor.cursorOffset)
      markVisual(editor, state)
      break
    }
    case 'x': {
      for (let i = 0; i < count; i += 1) {
        // `deleteChar` deletes forward: at the end of a line it would eat the newline.
        if (atLineEnd(editor)) {
          if (editor.logicalCursor.col === 0) {
            break
          }
          editor.moveCursorLeft()
        }
        editor.deleteChar()
      }
      break
    }
    case 'D': {
      editor.deleteToLineEnd()
      break
    }
    case 'C': {
      editor.deleteToLineEnd()
      state.mode = 'insert'
      break
    }
    case 'u': {
      for (let i = 0; i < count; i += 1) {
        actions.undo()
      }
      break
    }
    case 'p': {
      paste(editor, state, false)
      break
    }
    case 'P': {
      paste(editor, state, true)
      break
    }
    case 'd':
    case 'c':
    case 'y':
    case 'g': {
      state.pending = k
      state.count = digits
      return true
    }
    case 'escape': {
      break
    }
    default: {
      return true
    }
  }
  return true
}
