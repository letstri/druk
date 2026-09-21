import { describe, expect, test } from 'bun:test'

import { lineRangeAt, wordRangeAt } from '../src/editor/words'

describe('wordRangeAt', () => {
  test('selects an identifier under the caret', () => {
    const text = 'const data = []\n'
    const at = text.indexOf('data')
    expect(wordRangeAt(text, at)).toEqual({ end: at + 4, start: at })
    expect(wordRangeAt(text, at + 2)).toEqual({ end: at + 4, start: at })
  })

  test('treats _ and $ as part of the word', () => {
    const text = 'const _foo$ = 1\n'
    const at = text.indexOf('_foo$')
    expect(wordRangeAt(text, at + 1)).toEqual({ end: at + 5, start: at })
  })

  test('selects a run of spaces, not across a newline', () => {
    const text = 'a  \nb\n'
    expect(wordRangeAt(text, 1)).toEqual({ end: 3, start: 1 })
  })

  test('selects a run of punctuation', () => {
    const text = 'a===b\n'
    expect(wordRangeAt(text, 2)).toEqual({ end: 4, start: 1 })
  })

  test('inside a quoted string still selects only the word', () => {
    const text = 'const s = "hello world"\n'
    const at = text.indexOf('hello')
    expect(wordRangeAt(text, at)).toEqual({ end: at + 5, start: at })
    expect(wordRangeAt(text, text.indexOf('world'))).toEqual({
      end: text.indexOf('world') + 5,
      start: text.indexOf('world'),
    })
  })

  test('a run of punctuation stops at the end of the line', () => {
    const text = 'foo();\nnext\n'
    const at = text.indexOf('(')
    expect(wordRangeAt(text, at)).toEqual({ end: at + 3, start: at })
  })

  test('a caret on the line terminator selects nothing', () => {
    const text = 'const a = 1\nconst b = 2\n'
    const at = text.indexOf('\n')
    expect(wordRangeAt(text, at)).toEqual({ end: at, start: at })
  })

  test('a blank line does not select the blank lines around it', () => {
    const text = 'a\n\n\n\nb\n'
    expect(wordRangeAt(text, 2)).toEqual({ end: 2, start: 2 })
  })

  test('an empty buffer is a zero range', () => {
    expect(wordRangeAt('', 0)).toEqual({ end: 0, start: 0 })
  })
})

describe('lineRangeAt', () => {
  test('covers the whole line including its newline', () => {
    const text = 'const data = []\nnext\n'
    expect(lineRangeAt(text, text.indexOf('data'))).toEqual({
      end: 16,
      start: 0,
    })
  })

  test('the last line without a trailing newline goes to the end', () => {
    const text = 'only'
    expect(lineRangeAt(text, 2)).toEqual({ end: 4, start: 0 })
  })

  test('an empty buffer is a zero range', () => {
    expect(lineRangeAt('', 0)).toEqual({ end: 0, start: 0 })
  })
})
