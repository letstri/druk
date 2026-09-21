import { expect, test } from 'bun:test'

import {
  launch,
  openDiff,
  openFile,
  openPalette,
  press,
  pressEscape,
  runCommand,
  until,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'
import { changedRepo } from './repo'

const repo = () => changedRepo('druk-listeners-')

const counts = (t: Harness) => ({
  keypress: t.renderer.keyInput.listenerCount('keypress'),
  resize: t.renderer.listenerCount('resize'),
})

const same = (a: ReturnType<typeof counts>, b: ReturnType<typeof counts>) =>
  a.resize === b.resize && a.keypress === b.keypress

test('closing a panel releases the resize and keypress listeners it took', async () => {
  const t = await launch(repo(), {}, { height: 40 })
  await openFile(t, 'a.ts')
  const base = counts(t)

  await openDiff(t)
  await untilFrame(t, '+ ALPHA')
  expect(counts(t).keypress).toBeGreaterThan(base.keypress)
  await openPalette(t)
  expect(counts(t).keypress).toBeLessThanOrEqual(t.renderer.getMaxListeners())
  await pressEscape(t)
  await pressEscape(t)
  await untilGone(t, '+ ALPHA')
  await until(t, () => same(counts(t), base))

  await runCommand(t, 'Settings')
  await untilFrame(t, 'Editor')
  await pressEscape(t)
  await until(t, () => same(counts(t), base))

  await press(t, (i) => i.pressKey('f', { ctrl: true }))
  await pressEscape(t)
  await until(t, () => same(counts(t), base))

  await runCommand(t, 'Keyboard shortcuts')
  await pressEscape(t)
  await until(t, () => same(counts(t), base))
}, 20_000)

test('the renderer carries more listeners than the default ten without a warning', async () => {
  const t = await launch(repo())
  expect(t.renderer.getMaxListeners()).toBeGreaterThan(10)
  expect(t.renderer.keyInput.getMaxListeners()).toBeGreaterThan(10)
})
