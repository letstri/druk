import { expect, test } from 'bun:test'

import { stepHistory } from '../src/core/messageHistory'

const past = ['newest', 'older', 'oldest']

test('↑ walks back from the draft, ↓ walks out to it again', () => {
  const first = stepHistory(past, -1, 1, 'typing', '')
  expect(first).toEqual({ at: 0, value: 'newest', draft: 'typing' })

  const second = stepHistory(past, first!.at, 1, first!.value, first!.draft)
  expect(second).toEqual({ at: 1, value: 'older', draft: 'typing' })

  const back = stepHistory(past, second!.at, -1, second!.value, second!.draft)
  expect(back).toEqual({ at: 0, value: 'newest', draft: 'typing' })

  const out = stepHistory(past, back!.at, -1, back!.value, back!.draft)
  expect(out).toEqual({ at: -1, value: 'typing', draft: 'typing' })
})

test('a key with nowhere to go leaves the field alone', () => {
  expect(stepHistory([], -1, 1, 'typing', '')).toBeNull()
  // Already on the draft: ↓ is not a way to clear the box.
  expect(stepHistory(past, -1, -1, 'typing', '')).toBeNull()
  expect(stepHistory(past, 2, 1, 'oldest', 'typing')).toBeNull()
})
