import { afterEach, expect, test } from 'bun:test'

import {
  encodeProgress,
  progressFromBusy,
  PROGRESS_ENV,
  reportProgress,
  resetProgress,
  supportsProgress,
} from '../src/core/progress'

afterEach(resetProgress)

test('encodes ConEmu OSC 9;4 states', () => {
  expect(encodeProgress({ kind: 'off' })).toBe('\x1B]9;4;0\x07')
  expect(encodeProgress({ kind: 'indeterminate' })).toBe('\x1B]9;4;3\x07')
  expect(encodeProgress({ kind: 'percent', value: 42 })).toBe('\x1B]9;4;1;42\x07')
  expect(encodeProgress({ kind: 'percent', value: -4 })).toBe('\x1B]9;4;1;0\x07')
  expect(encodeProgress({ kind: 'percent', value: 140 })).toBe('\x1B]9;4;1;100\x07')
})

test('a counted operation is a percent, anything else a spinner', () => {
  expect(progressFromBusy(null)).toEqual({ kind: 'off' })
  expect(progressFromBusy({})).toEqual({ kind: 'indeterminate' })
  expect(progressFromBusy({ done: 0, total: 0 })).toEqual({ kind: 'indeterminate' })
  expect(progressFromBusy({ done: 1, total: 4 })).toEqual({ kind: 'percent', value: 25 })
})

test('only terminals that implement OSC 9;4 get a sequence', () => {
  expect(supportsProgress({}, true)).toBe(false)
  expect(supportsProgress({ WT_SESSION: '1' }, false)).toBe(false)
  expect(supportsProgress({ WT_SESSION: '1' }, true)).toBe(true)
  expect(supportsProgress({ TERM_PROGRAM: 'ghostty' }, true)).toBe(true)
  expect(supportsProgress({ TERM_PROGRAM: 'WezTerm' }, true)).toBe(true)
  expect(supportsProgress({ TERM_PROGRAM: 'iTerm.app' }, true)).toBe(true)
  expect(supportsProgress({ KITTY_WINDOW_ID: '1' }, true)).toBe(true)
  expect(supportsProgress({ TERM: 'xterm-ghostty' }, true)).toBe(true)
  expect(supportsProgress({ VTE_VERSION: '7900' }, true)).toBe(true)
  expect(supportsProgress({ VTE_VERSION: '5202' }, true)).toBe(false)
  expect(supportsProgress({ TERM: 'alacritty' }, true)).toBe(false)
  expect(supportsProgress({ [PROGRESS_ENV]: '0', TERM_PROGRAM: 'ghostty' }, true)).toBe(false)
  expect(supportsProgress({ [PROGRESS_ENV]: '1' }, true)).toBe(true)
})

test('reportProgress writes once per change and never to an unsupported terminal', () => {
  const written: string[] = []
  const write = (text: string) => written.push(text)
  const env = { TERM_PROGRAM: 'ghostty' }

  reportProgress({ kind: 'indeterminate' }, write, env, true)
  reportProgress({ kind: 'indeterminate' }, write, env, true)
  reportProgress({ kind: 'percent', value: 50 }, write, env, true)
  reportProgress({ kind: 'off' }, write, env, true)
  reportProgress({ kind: 'off' }, write, {}, true)

  expect(written).toEqual(['\x1B]9;4;3\x07', '\x1B]9;4;1;50\x07', '\x1B]9;4;0\x07'])
})
