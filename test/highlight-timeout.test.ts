import { expect, mock, test } from 'bun:test'

import * as opentui from '@opentui/core'

let highlightCalls = 0
const stuckClient = {
  addFiletypeParser: () => {},
  highlightOnce: () => {
    highlightCalls += 1
    return Promise.withResolvers<never>().promise
  },
  initialize: () => Promise.resolve(),
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
  if (typeof first === 'symbol') {
    throw new TypeError('unreachable')
  }
  expect(
    first.ordered.every((capture) => capture.group === 'indent.guide')
  ).toBe(true)
  expect(highlightCalls).toBe(1)

  await computeHighlights('const two = 2\n', 'typescript')
  await computeHighlights('const three = 3\n', 'typescript')
  expect(highlightCalls).toBe(3)

  const after = await computeHighlights('const four = 4\n', 'typescript')
  expect(after).not.toBe(STALE)
  expect(highlightCalls).toBe(3)
})

test('patterns-only languages never touch the worker', async () => {
  setParseTimeoutForTests(150)
  const calls = highlightCalls
  const parsed = await computeHighlights('services:\n  app:\n', 'yaml')
  expect(parsed).not.toBe(STALE)
  if (typeof parsed === 'symbol') {
    throw new TypeError('unreachable')
  }
  expect(parsed.ordered.some((capture) => capture.group === 'property')).toBe(
    true
  )
  expect(highlightCalls).toBe(calls)
})
