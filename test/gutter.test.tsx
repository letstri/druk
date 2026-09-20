import { expect, test } from 'bun:test'

import { fixture, launch, press, pressTimes } from './helpers'

test('line numbers past 99 are not truncated', async () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n')
  const t = await launch(fixture({ 'big.txt': lines }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  await pressTimes(t, 120, i => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('120 line 120')
  expect(frame).not.toContain('unsaved')
})
