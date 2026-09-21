import { describe, expect, test } from 'bun:test'

import { parseKeypress } from '@opentui/core'

// Bytes a terminal puts on the wire in raw mode.
const seq = (bytes: string) => {
  const key = parseKeypress(bytes)
  return {
    ctrl: key?.ctrl ?? false,
    meta: key?.meta ?? false,
    name: key?.name,
    option: key?.option ?? false,
    shift: key?.shift ?? false,
  }
}

const ESC = '\u001B'
const ctrl = (letter: string) =>
  String.fromCodePoint(letter.toUpperCase().codePointAt(0)! - 64)
// Terminal.app and iTerm2 prefix Esc for Opt.
const withOpt = (bytes: string) => `${ESC}${bytes}`

describe('what terminals can encode', () => {
  test('Ctrl+Shift+letter is indistinguishable from Ctrl+letter', () => {
    expect(seq(ctrl('f')).shift).toBe(false)
    expect(seq(ctrl('n')).shift).toBe(false)
  })

  test('Ctrl+Opt+letter arrives as ctrl+meta, not ctrl+option', () => {
    expect(seq(withOpt(ctrl('f')))).toMatchObject({
      ctrl: true,
      meta: true,
      name: 'f',
    })
    expect(seq(withOpt(ctrl('f'))).option).toBe(false)
    expect(seq(withOpt(ctrl('n')))).toMatchObject({
      ctrl: true,
      meta: true,
      name: 'n',
    })
  })

  test('every plain Ctrl binding survives the wire', () => {
    for (const letter of 'poszqtgfrwnbdycxv') {
      expect(seq(ctrl(letter))).toMatchObject({ ctrl: true, name: letter })
    }
  })

  test('the tab and page chords keep their names', () => {
    expect(seq(`${ESC}[5;5~`)).toMatchObject({ ctrl: true, name: 'pageup' })
    expect(seq(`${ESC}[6;5~`)).toMatchObject({ ctrl: true, name: 'pagedown' })
    expect(seq(`${ESC}[1;7D`)).toMatchObject({ ctrl: true, name: 'left' })
    expect(seq(`${ESC}[1;7C`)).toMatchObject({ ctrl: true, name: 'right' })
  })
})
