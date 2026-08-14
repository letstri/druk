/**
 * What a key would print on a US layout, whatever layout is actually up.
 *
 * A terminal sends the character the layout produces, so with Ukrainian selected
 * Ctrl+S arrives as Ctrl+ф and matches no chord: every shortcut in the editor
 * goes dead until the user switches back. Shortcuts are a place on the keyboard
 * rather than a letter, so the character is translated back before anything
 * compares it — the same thing VS Code and JetBrains do.
 *
 * A chord is renamed in place; a bare letter cannot be, since the panels spend
 * bare letters on commands while the editor and every filter field spend the same
 * keystroke on the character it prints — `useKeys` hands that one to the handler
 * alongside the event instead, and each handler picks the reading it needs.
 *
 * A key whose foreign layout prints ASCII is left alone, so it answers to the
 * name the layout gave it: `/` is unreachable on a Ukrainian layout (the key
 * prints `.`) unless the terminal speaks the kitty protocol and sends a base code.
 */

/**
 * US rows beside what a Cyrillic layout prints on the same keys — Ukrainian and
 * Russian, which differ in four of them. Characters that are ASCII on both sides
 * are skipped below: Cyrillic ю sits where the US `.` is, and translating a key
 * that already carries a Latin name would take Ctrl+. from whoever wants it.
 */
const ROWS: [us: string, cyrillic: string][] = [
  ['qwertyuiop[]', 'йцукенгшщзхї'],
  ['qwertyuiop[]', 'йцукенгшщзхъ'],
  ["asdfghjkl;'", 'фівапролджє'],
  ["asdfghjkl;'", 'фывапролджэ'],
  ['zxcvbnm,./', 'ячсмитьбю.'],
  ['`\\', 'ёґ'],
]

const FROM_LAYOUT = new Map<string, string>()
for (const [us, foreign] of ROWS) {
  for (const [at, char] of [...foreign].entries()) {
    if (char.charCodeAt(0) > 127) FROM_LAYOUT.set(char, us[at]!)
  }
}

/**
 * What a key prints with Caps Lock on.
 *
 * A terminal speaking the kitty protocol reports Caps Lock as a modifier bit and
 * sends the key's own, lowercase code — `CSI 97;65u` for a caps-locked A. The
 * uppercase character reaches the app only through the protocol's *associated
 * text*, which is a flag of its own that not every terminal implements, so
 * without this the lock does nothing at all and letters type lowercase.
 *
 * Idempotent, which is what lets it run over every key: a terminal that did send
 * the text already produced this character. Shift reverses the lock, as it does
 * on the OS side, so a caps-locked Shift+A is `a` either way.
 */
export function capsChar(char: string, shift: boolean): string {
  if (char.length !== 1) return char
  const upper = char.toUpperCase()
  const lower = char.toLowerCase()
  // Not a letter — a digit or a symbol is what its own key says, lock or not.
  if (upper === lower || upper.length !== 1 || lower.length !== 1) return char
  return shift ? lower : upper
}

/** The US name of the key `key` is on, or its own name when it is one already. */
export function latinKey(key: { name: string; baseCode?: number }): string {
  const name = key.name
  if (name.length !== 1 || name.charCodeAt(0) < 128) return name
  // The kitty protocol reports which key of a PC-101 keyboard was pressed, which
  // answers for every layout rather than the two the table above knows. Terminals
  // that speak it without the alternate-keys flag send no base code at all.
  const base = key.baseCode
  if (base !== undefined && base > 32 && base < 127) return String.fromCodePoint(base).toLowerCase()
  return FROM_LAYOUT.get(name.toLowerCase()) ?? name
}
