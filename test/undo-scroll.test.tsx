import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, untilFrame } from './helpers'

const LINES = Array.from({ length: 200 }, (_, n) => `const v${n} = ${n}`)

// The first content row, which names the line the view starts at.
const top = (frame: string) => frame.split('\n')[1]!

async function scrolled(name: string) {
  const dir = fixture({ [name]: `${LINES.join('\n')}\n` })
  return await launch(dir, {}, {}, { openFile: join(dir, name), openLine: 150 })
}

test('undo leaves the view where the edit was', async () => {
  const t = await scrolled('a.ts')
  const before = t.captureCharFrame()

  await press(t, (i) => i.typeText('x'))
  await press(t, (i) => i.pressKey('z', { ctrl: true }))

  expect(t.captureCharFrame()).toBe(before)
})

test('a line edit leaves the view where it was', async () => {
  const t = await scrolled('b.ts')
  const before = t.captureCharFrame()

  await press(t, (i) => i.pressKey('/', { ctrl: true }))
  expect(top(t.captureCharFrame())).toBe(top(before))

  await runCommand(t, 'Delete line')
  expect(top(t.captureCharFrame())).toBe(top(before))
})

test('a reload from disk leaves the view where it was', async () => {
  const dir = fixture({ 'c.ts': `${LINES.join('\n')}\n` })
  const t = await launch(
    dir,
    {},
    {},
    { openFile: join(dir, 'c.ts'), openLine: 150 }
  )
  const before = top(t.captureCharFrame())

  writeFileSync(join(dir, 'c.ts'), `${LINES.join('\n').toUpperCase()}\n`)
  await untilFrame(t, 'V150')

  expect(top(t.captureCharFrame())).toBe(before.toUpperCase())
})
