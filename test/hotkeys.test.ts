import { describe, expect, test } from 'bun:test'

import { parseKeypress } from '@opentui/core'

// Bytes a terminal puts on the wire in raw mode.
const seq = (bytes: string) => {
  const key = parseKeypress(bytes)
  return {
    name: key?.name,
    ctrl: key?.ctrl ?? false,
    shift: key?.shift ?? false,
    meta: key?.meta ?? false,
    option: key?.option ?? false,
  }
}

const ESC = '\u001B'
const ctrl = (letter: string) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)
// Terminal.app and iTerm2 prefix Esc for Opt.
const withOpt = (bytes: string) => `${ESC}${bytes}`

describe('what terminals can encode', () => {
  test('Ctrl+Shift+letter is indistinguishable from Ctrl+letter', () => {
    expect(seq(ctrl('f')).shift).toBe(false)
    expect(seq(ctrl('n')).shift).toBe(false)
  })

  test('Ctrl+Opt+letter arrives as ctrl+meta, not ctrl+option', () => {
    expect(seq(withOpt(ctrl('f')))).toMatchObject({ name: 'f', ctrl: true, meta: true })
    expect(seq(withOpt(ctrl('f'))).option).toBe(false)
    expect(seq(withOpt(ctrl('n')))).toMatchObject({ name: 'n', ctrl: true, meta: true })
  })

  test('every plain Ctrl binding survives the wire', () => {
    for (const letter of 'poszqtgfrwnbdycxv'.split('')) {
      expect(seq(ctrl(letter))).toMatchObject({ name: letter, ctrl: true })
    }
  })

  test('the tab and page chords keep their names', () => {
    expect(seq(`${ESC}[5;5~`)).toMatchObject({ name: 'pageup', ctrl: true })
    expect(seq(`${ESC}[6;5~`)).toMatchObject({ name: 'pagedown', ctrl: true })
    expect(seq(`${ESC}[1;7D`)).toMatchObject({ name: 'left', ctrl: true })
    expect(seq(`${ESC}[1;7C`)).toMatchObject({ name: 'right', ctrl: true })
  })
})
