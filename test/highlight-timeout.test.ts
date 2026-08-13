import { expect, mock, test } from 'bun:test'

import * as opentui from '@opentui/core'

/**
 * A worker parse that never answers must not wedge highlighting (#82): the
 * editor serializes parses behind one flag, so a single pending promise left
 * every later file — every language, patterns included — unhighlighted until
 * restart. The guard answers null after a timeout, and repeated timeouts
 * retire the worker for the session instead of taxing every parse.
 */

let highlightCalls = 0
const stuckClient = {
  initialize: () => Promise.resolve(),
  addFiletypeParser: () => {},
  highlightOnce: () => {
    highlightCalls++
    return new Promise(() => {}) // the hung worker: nothing ever settles this
  },
}

mock.module('@opentui/core', () => ({
  ...opentui,
  getTreeSitterClient: () => stuckClient,
}))

const { computeHighlights, setParseTimeoutForTests, STALE } =
  await import('../src/languages/highlight')

test('a hung worker parse falls back instead of pending forever', async () => {
  setParseTimeoutForTests(150)

  const first = await computeHighlights('const one = 1\n', 'typescript')
  expect(first).not.toBe(STALE)
  if (typeof first === 'symbol') throw new Error('unreachable')
  // The fallback carries no syntax captures — only what needs no worker.
  expect(first.ordered.every(capture => capture.group === 'indent.guide')).toBe(true)
  expect(highlightCalls).toBe(1)

  // Two more strikes retire the worker for the session…
  await computeHighlights('const two = 2\n', 'typescript')
  await computeHighlights('const three = 3\n', 'typescript')
  expect(highlightCalls).toBe(3)

  // …so the next parse never waits on it at all.
  const after = await computeHighlights('const four = 4\n', 'typescript')
  expect(after).not.toBe(STALE)
  expect(highlightCalls).toBe(3)
})

test('patterns-only languages never touch the worker', async () => {
  setParseTimeoutForTests(150)
  const calls = highlightCalls
  const parsed = await computeHighlights('services:\n  app:\n', 'yaml')
  expect(parsed).not.toBe(STALE)
  if (typeof parsed === 'symbol') throw new Error('unreachable')
  expect(parsed.ordered.some(capture => capture.group === 'property')).toBe(true)
  expect(highlightCalls).toBe(calls)
})
