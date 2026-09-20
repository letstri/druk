// Only non-ASCII is mapped below: Cyrillic ю sits on the US `.`, whose Ctrl+. is someone's.
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

// kitty reports Caps Lock as a modifier bit and sends the lowercase code; idempotent.
export function capsChar(char: string, shift: boolean): string {
  if (char.length !== 1) return char
  const upper = char.toUpperCase()
  const lower = char.toLowerCase()
  if (upper === lower || upper.length !== 1 || lower.length !== 1) return char
  return shift ? lower : upper
}

export function latinKey(key: { name: string; baseCode?: number }): string {
  const name = key.name
  if (name.length !== 1 || name.charCodeAt(0) < 128) return name
  // kitty's PC-101 base code answers for every layout; terminals without it send none.
  const base = key.baseCode
  if (base !== undefined && base > 32 && base < 127) return String.fromCodePoint(base).toLowerCase()
  return FROM_LAYOUT.get(name.toLowerCase()) ?? name
}
