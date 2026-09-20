import { expect, test } from 'bun:test'

import { fixture, launch, openPalette, runCommand, untilFrame } from './helpers'
import type { Harness } from './helpers'

const rowOf = (t: Harness, text: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .findIndex(line => line.includes(text))

test('a click on a file picker row opens that file', async () => {
  const t = await launch(
    fixture({ 'alpha.ts': 'const alpha = 1\n', 'beta.ts': 'const beta = 2\n' }),
  )

  await runCommand(t, 'Open file')
  await untilFrame(t, 'beta.ts')

  const y = rowOf(t, 'beta.ts')
  expect(y).toBeGreaterThan(0)
  await t.mockMouse.click(20, y)
  await untilFrame(t, 'const beta = 2')
}, 15_000)

test('a click on a palette row opens that submenu', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))

  await openPalette(t)
  await untilFrame(t, 'Commands')
  const y = rowOf(t, 'View ')
  expect(y).toBeGreaterThan(0)
  await t.mockMouse.click(20, y)
  await untilFrame(t, 'Toggle word wrap')
}, 15_000)
