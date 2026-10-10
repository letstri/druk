import { expect, test } from 'bun:test'

import { fixture, launch, press, runCommand, settle, until } from './helpers'
import type { Harness } from './helpers'

const files = {
  'a.ts': 'const a = 1\n',
  'src/deep/b.ts': 'const b = 2\n',
  'src/deep/more/c.ts': 'const c = 3\n',
}

const rowOf = (t: Harness, name: string) => {
  const rows = t.captureCharFrame().split('\n')
  const y = rows.findIndex((row, i) => i > 0 && row.includes(name))
  return { x: rows[y]!.indexOf(name), y }
}

test('Option-click opens a folder with everything below it, and shuts it the same way', async () => {
  const t = await launch(fixture(files))
  const at = rowOf(t, 'src')

  await press(t, () =>
    t.mockMouse.click(at.x, at.y, undefined, { modifiers: { alt: true } })
  )
  await until(t, () => t.captureCharFrame().includes('c.ts'))
  expect(t.captureCharFrame()).toContain('more')

  await settle(t, 600)
  await press(t, () =>
    t.mockMouse.click(at.x, at.y, undefined, { modifiers: { alt: true } })
  )
  expect(t.captureCharFrame()).not.toContain('deep')
})

test('a plain click still opens one level', async () => {
  const t = await launch(fixture(files))
  const at = rowOf(t, 'src')

  await press(t, () => t.mockMouse.click(at.x, at.y))
  await until(t, () => t.captureCharFrame().includes('deep'))
  expect(t.captureCharFrame()).not.toContain('c.ts')
})

test('Option+→ / ← on the keyboard opens and shuts everything below the folder', async () => {
  const t = await launch(fixture(files))
  await press(t, (i) => i.pressArrow('down'))

  await press(t, (i) => i.pressArrow('right', { meta: true }))
  await until(t, () => t.captureCharFrame().includes('c.ts'))
  expect(t.captureCharFrame()).toContain('more')

  await press(t, (i) => i.pressArrow('left', { meta: true }))
  expect(t.captureCharFrame()).not.toContain('deep')
  expect(t.captureCharFrame()).toContain('src')
})

test('the palette does the same for the folder under the cursor', async () => {
  const t = await launch(fixture(files))
  await press(t, (i) => i.pressArrow('down'))

  await runCommand(t, 'Expand folder and its subfolders')
  await until(t, () => t.captureCharFrame().includes('c.ts'))

  await runCommand(t, 'Collapse folder and its subfolders')
  await until(t, () => !t.captureCharFrame().includes('deep'))
})

test('Option+→ / ← as terminals send them, ESC f and ESC b, do the same', async () => {
  const t = await launch(fixture(files))
  await press(t, (i) => i.pressArrow('down'))

  await press(t, (i) => i.pressKey('f', { meta: true }))
  await until(t, () => t.captureCharFrame().includes('c.ts'))

  await press(t, (i) => i.pressKey('b', { meta: true }))
  expect(t.captureCharFrame()).not.toContain('deep')
})

test('an Option-click straight after a plain click is not taken for a double click', async () => {
  const t = await launch(fixture(files))
  const at = rowOf(t, 'src')

  await press(t, () => t.mockMouse.click(at.x, at.y))
  await until(t, () => t.captureCharFrame().includes('deep'))
  await press(t, () =>
    t.mockMouse.click(at.x, at.y, undefined, { modifiers: { alt: true } })
  )

  await until(t, () => !t.captureCharFrame().includes('deep'))
})
