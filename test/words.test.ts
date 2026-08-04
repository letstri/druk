import { describe, expect, test } from 'bun:test'

import { lineRangeAt, wordRangeAt } from '../src/editor/words'

describe('wordRangeAt', () => {
  test('selects an identifier under the caret', () => {
    const text = 'const data = []\n'
    const at = text.indexOf('data')
    expect(wordRangeAt(text, at)).toEqual({ start: at, end: at + 4 })
    expect(wordRangeAt(text, at + 2)).toEqual({ start: at, end: at + 4 })
  })

  test('treats _ and $ as part of the word', () => {
    const text = 'const _foo$ = 1\n'
    const at = text.indexOf('_foo$')
    expect(wordRangeAt(text, at + 1)).toEqual({ start: at, end: at + 5 })
  })

  test('selects a run of spaces, not across a newline', () => {
    const text = 'a  \nb\n'
    expect(wordRangeAt(text, 1)).toEqual({ start: 1, end: 3 })
  })

  test('selects a run of punctuation', () => {
    const text = 'a===b\n'
    expect(wordRangeAt(text, 2)).toEqual({ start: 1, end: 4 })
  })

  test('inside a quoted string still selects only the word', () => {
    const text = 'const s = "hello world"\n'
    const at = text.indexOf('hello')
    expect(wordRangeAt(text, at)).toEqual({ start: at, end: at + 5 })
    expect(wordRangeAt(text, text.indexOf('world'))).toEqual({
      start: text.indexOf('world'),
      end: text.indexOf('world') + 5,
    })
  })

  test('a run of punctuation stops at the end of the line', () => {
    const text = 'foo();\nnext\n'
    const at = text.indexOf('(')
    expect(wordRangeAt(text, at)).toEqual({ start: at, end: at + 3 })
  })

  test('a caret on the line terminator selects nothing', () => {
    const text = 'const a = 1\nconst b = 2\n'
    const at = text.indexOf('\n')
    expect(wordRangeAt(text, at)).toEqual({ start: at, end: at })
  })

  test('a blank line does not select the blank lines around it', () => {
    const text = 'a\n\n\n\nb\n'
    expect(wordRangeAt(text, 2)).toEqual({ start: 2, end: 2 })
  })

  test('an empty buffer is a zero range', () => {
    expect(wordRangeAt('', 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('lineRangeAt', () => {
  test('covers the whole line including its newline', () => {
    const text = 'const data = []\nnext\n'
    expect(lineRangeAt(text, text.indexOf('data'))).toEqual({ start: 0, end: 16 })
  })

  test('the last line without a trailing newline goes to the end', () => {
    const text = 'only'
    expect(lineRangeAt(text, 2)).toEqual({ start: 0, end: 4 })
  })

  test('an empty buffer is a zero range', () => {
    expect(lineRangeAt('', 0)).toEqual({ start: 0, end: 0 })
  })
})
