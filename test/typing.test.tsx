import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press } from './helpers'

async function edit(
  initial: string,
  type: (i: Parameters<Parameters<typeof press>[1]>[0]) => void
) {
  const dir = fixture({ 'a.ts': initial })
  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await press(t, type)
  await press(t, (i) => i.pressKey('s', { ctrl: true }))
  return readFileSync(join(dir, 'a.ts'), 'utf-8')
}

test('brackets and quotes close themselves', async () => {
  expect(await edit('', (i) => i.typeText('f('))).toBe('f()')
  expect(await edit('', (i) => i.typeText('x = ['))).toBe('x = []')
  expect(await edit('', (i) => i.typeText('s = "'))).toBe('s = ""')
})

test('typing the closer steps over the inserted one', async () => {
  expect(await edit('', (i) => i.typeText('f()'))).toBe('f()')
})

test('apostrophes inside words are left alone', async () => {
  expect(await edit('', (i) => i.typeText("it's"))).toBe("it's")
})

test('Enter keeps the current indentation', async () => {
  const out = await edit('  const a = 1', (i) => {
    i.pressKey('e', { ctrl: true })
    i.pressEnter()
    void i.typeText('b')
  })
  expect(out).toBe('  const a = 1\n  b')
})
