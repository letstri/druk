import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press } from './helpers'

async function opened(content: string, trimOnSave: boolean) {
  const dir = fixture({ 'a.ts': 'placeholder\n' })
  writeFileSync(join(dir, 'a.ts'), content)
  const t = await launch(dir, { trimOnSave })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const save = () => press(t, i => i.pressKey('s', { ctrl: true }))
  const onDisk = () => readFileSync(join(dir, 'a.ts'), 'utf8')
  return { t, save, onDisk }
}

test('trim on save strips trailing whitespace and adds the final newline', async () => {
  const { save, onDisk } = await opened('const a = 1  \nconst b = 2\t', true)
  await save()
  expect(onDisk()).toBe('const a = 1\nconst b = 2\n')
})

test('the trim reaches the editor as one undoable step', async () => {
  const { t, save } = await opened('const a = 1  \n', true)
  await save()
  expect(t.captureCharFrame()).not.toContain('unsaved')

  await press(t, i => i.pressKey('z', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('unsaved')
})

test('off by default: the file is written byte for byte', async () => {
  const { save, onDisk } = await opened('const a = 1  \n', false)
  await save()
  expect(onDisk()).toBe('const a = 1  \n')
})
