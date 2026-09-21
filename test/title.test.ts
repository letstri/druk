import { expect, test } from 'bun:test'

import {
  encodeTitle,
  formatTitle,
  restoreTerminalTitle,
  setTerminalTitle,
  supportsTitle,
} from '../src/core/title'

const env = (term: string): NodeJS.ProcessEnv => ({ TERM: term })

test('a console that prints OSC strings gets no title', () => {
  expect(supportsTitle(env('xterm-256color'), true)).toBe(true)
  expect(supportsTitle(env('linux'), true)).toBe(false)
  expect(supportsTitle(env('dumb'), true)).toBe(false)
  expect(supportsTitle(env('xterm-256color'), false)).toBe(false)
  expect(supportsTitle({ DRUK_TITLE: '1', TERM: 'linux' }, true)).toBe(true)
  expect(supportsTitle({ DRUK_TITLE: '0', TERM: 'xterm' }, true)).toBe(false)
})

test('a control character in the name cannot end the sequence early', () => {
  expect(encodeTitle('a\u0007b\u001Bc')).toBe('\u001B]0;abc\u0007')
})

test('the title names the file, the project and the dirty mark', () => {
  expect(formatTitle('druk', null, false)).toBe('druk — druk')
  expect(formatTitle('druk', '/p/src/app/App.tsx', false)).toBe(
    'App.tsx — druk — druk'
  )
  expect(formatTitle('druk', '/p/src/app/App.tsx', true)).toBe(
    '● App.tsx — druk — druk'
  )
})

test('the title is pushed once, repeats are skipped, and the stack is popped', () => {
  const out: string[] = []
  const write = (text: string) => out.push(text)
  const tty = env('xterm-256color')
  setTerminalTitle('one', write, tty, true)
  setTerminalTitle('one', write, tty, true)
  setTerminalTitle('two', write, tty, true)
  restoreTerminalTitle(write)
  restoreTerminalTitle(write)
  expect(out).toEqual([
    '\u001B[22;2t',
    '\u001B]0;one\u0007',
    '\u001B]0;two\u0007',
    '\u001B[23;2t',
  ])
})
