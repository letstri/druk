import { expect, test } from 'bun:test'

import { fixture, launch, press } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

// Wide: at 80 columns the labels come back clipped.
async function inTree() {
  return launch(fixture(PROJECT), {}, { width: 120, height: 30 })
}

async function inEditor() {
  const t = await inTree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return t
}

const peek = (t: Awaited<ReturnType<typeof inTree>>) =>
  press(t, i => i.pressKey('k', { ctrl: true }))

test('Ctrl+K in the tree shows the tree keys', async () => {
  const t = await inTree()
  await peek(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('Select a range')
  expect(frame).toContain('Reopen closed tab')
  expect(frame).not.toContain('Toggle comment')
})

test('Ctrl+K in the editor shows the editor keys instead', async () => {
  const t = await inEditor()
  await peek(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('Toggle comment')
  expect(frame).not.toContain('Select a range')
})

test('the next key folds the peek and still does its job', async () => {
  const t = await inTree()
  await press(t, i => i.pressArrow('down'))
  await peek(t)
  expect(t.captureCharFrame()).toContain('Select a range')

  await press(t, i => void i.typeText('r'))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Select a range')
  expect(frame).toContain('Rename to')
})

test('Ctrl+K again closes it without doing anything else', async () => {
  const t = await inTree()
  await peek(t)
  await peek(t)
  expect(t.captureCharFrame()).not.toContain('Select a range')
})

test('the keys are grouped under the help overlay’s headings', async () => {
  const t = await inTree()
  await peek(t)

  const frame = t.captureCharFrame()
  for (const heading of ['General', 'Files & tabs', 'File tree', 'Source control', 'View']) {
    expect(frame).toContain(heading)
  }
  const lines = frame.split('\n')
  const heading = lines.findIndex(line => line.includes('File tree'))
  expect(lines[heading + 1]).toContain('Enter')
})

test('a terminal too short for the whole table says so', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 60, height: 14 })
  await peek(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('General')
  expect(frame).toContain('… more (F1)')
  expect(frame).toContain('Keys · file tree')
  expect(frame).toContain('F1 commands')
})

test('typing in the editor after a peek lands in the buffer', async () => {
  const t = await inEditor()
  await peek(t)
  await press(t, i => void i.typeText('X'))

  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Toggle comment')
  expect(frame).toContain('Xconst a = 1')
})
