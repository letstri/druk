import type { KeyEvent } from '@opentui/core'

export interface Chord {
  ctrl: boolean
  alt: boolean
  key: string
}

const MODIFIERS: Record<string, 'ctrl' | 'alt'> = {
  alt: 'alt',
  cmd: 'alt',
  command: 'alt',
  control: 'ctrl',
  ctrl: 'ctrl',
  meta: 'alt',
  opt: 'alt',
  option: 'alt',
  shift: 'alt',
  super: 'alt',
}

const ALIASES: Record<string, string> = {
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  backsp: 'backspace',
  bksp: 'backspace',
  del: 'delete',
  enter: 'return',
  esc: 'escape',
  ins: 'insert',
  pgdn: 'pagedown',
  pgdown: 'pagedown',
  pgup: 'pageup',
  ret: 'return',
  spc: 'space',
  '←': 'left',
  '↑': 'up',
  '→': 'right',
  '↓': 'down',
}

const FUNCTION_KEY = /^f([1-9]|1[0-2])$/u

const NAMED = new Set([
  'left',
  'right',
  'up',
  'down',
  'pageup',
  'pagedown',
  'home',
  'end',
  'tab',
  'space',
  'return',
  'escape',
  'backspace',
  'delete',
  'insert',
])

const DISPLAY: Record<string, string> = {
  backspace: 'Bksp',
  delete: 'Del',
  down: '↓',
  end: 'End',
  escape: 'Esc',
  home: 'Home',
  insert: 'Ins',
  left: '←',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  return: 'Enter',
  right: '→',
  space: 'Space',
  tab: 'Tab',
  up: '↑',
}

const RESERVED: Record<string, string> = {
  '[': 'Ctrl+[ is Escape',
  c: 'Ctrl+C copies the selection, or quits when there is none',
  h: 'Ctrl+H is Backspace',
  i: 'Ctrl+I is the Tab byte',
  j: 'Ctrl+J is a newline',
  m: 'Ctrl+M is Enter',
  space: 'Ctrl+Space triggers autocomplete',
}

const isKeyName = (key: string) =>
  NAMED.has(key) ||
  FUNCTION_KEY.test(key) ||
  (key.length === 1 && key >= '!' && key <= '~')

export function parseChord(spelling: string): Chord | null {
  const parts = spelling
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) {
    return null
  }
  const chord: Chord = { alt: false, ctrl: false, key: '' }
  for (const [at, part] of parts.entries()) {
    const lower = part.toLowerCase()
    const last = at === parts.length - 1
    const modifier = MODIFIERS[lower]
    // A modifier name counts as one only ahead of the key: "Ctrl+Shift" is no chord.
    if (modifier && !last) {
      chord[modifier] = true
      continue
    }
    if (!last) {
      return null
    }
    const key = ALIASES[lower] ?? lower
    if (!isKeyName(key)) {
      return null
    }
    chord.key = key
  }
  return chord.key ? chord : null
}

export function formatChord(chord: Chord, altLabel: string): string {
  const key =
    DISPLAY[chord.key] ??
    (FUNCTION_KEY.test(chord.key) ? chord.key.toUpperCase() : null)
  const parts = [
    ...(chord.ctrl ? ['Ctrl'] : []),
    ...(chord.alt ? [altLabel] : []),
    key ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key),
  ]
  return parts.join('+')
}

export const chordId = (chord: Chord): string =>
  `${chord.ctrl ? 'c' : ''}${chord.alt ? 'a' : ''}:${chord.key}`

// shift counts too: Ctrl+Shift+<letter> is byte-identical to Ctrl+<letter> on the wire.
export const secondary = (key: KeyEvent) =>
  Boolean(key.option || key.meta || key.shift)

export function matchesChord(chord: Chord, key: KeyEvent): boolean {
  // Enter reports under either name depending on the terminal.
  const name = key.name === 'enter' ? 'return' : key.name
  return (
    name === chord.key &&
    Boolean(key.ctrl) === chord.ctrl &&
    secondary(key) === chord.alt
  )
}

// Without Ctrl it would be typing the editor never sees: the keymap runs before the textarea.
export function bindingProblem(chord: Chord): string | null {
  if (!chord.ctrl) {
    return FUNCTION_KEY.test(chord.key)
      ? null
      : 'A shortcut needs Ctrl or a function key'
  }
  if (!chord.alt) {
    const reserved = RESERVED[chord.key]
    if (reserved) {
      return reserved
    }
  }
  return null
}
