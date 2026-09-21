import { expect, test } from 'bun:test'

import {
  fixture,
  launch,
  press,
  pressEscape,
  pressTimes,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

const FILE = [
  'const alpha = 1',
  'const beta = 2',
  'const alpha2 = 3',
  'let alpha3 = 4',
  '',
].join('\n')
const PROJECT = { 'a.ts': FILE }

const SIZE = { height: 30, width: 100 }

async function openFileFromTree(t: Harness) {
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
}

const openSearch = (t: Harness) =>
  press(t, (i) => i.pressKey('f', { ctrl: true }))
const openProjectSearch = (t: Harness) =>
  press(t, (i) => i.pressKey('r', { ctrl: true }))
const scanned = (t: Harness) => settle(t, 300)

test('reopening the search carries the last query', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await settle(t)
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('Search…')

  await openSearch(t)
  await settle(t)
  expect(t.captureCharFrame()).toContain('alpha')
  expect(t.captureCharFrame()).toContain('const alpha2 = 3')
})

test('the remembered query is selected, so typing replaces it', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await settle(t)
  await pressEscape(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('beta'))
  await settle(t)

  const frame = t.captureCharFrame()
  expect(frame).not.toContain('alphabeta')
  expect(frame).toContain('1 of 1')
})

test('reopening lands on the row it was left on', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await settle(t)
  await pressTimes(t, 2, (i) => i.pressArrow('down'))
  await settle(t)
  await pressEscape(t)

  await openSearch(t)
  await settle(t)
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'Ln 4, Col 5')
})

const PROJECT_FILES = {
  'a.ts': 'const alpha = 1\n',
  'b.ts': 'let alpha2 = 3\nlet alpha3 = 4\n',
}

test('reopening the project search carries the query and the row', async () => {
  const t = await launch(fixture(PROJECT_FILES), {}, SIZE)
  await openFileFromTree(t)

  await openProjectSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await scanned(t)
  await pressTimes(t, 2, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'Ln 2, Col 5')

  await openProjectSearch(t)
  await scanned(t)
  const frame = t.captureCharFrame()
  expect(frame).toContain('Search in project')
  expect(frame).toContain('alpha')
  expect(frame).toContain('3 of 3')
})

test('a folded project search comes back folded', async () => {
  const t = await launch(fixture(PROJECT_FILES), {}, SIZE)
  await openFileFromTree(t)

  await openProjectSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await scanned(t)
  await press(t, (i) => i.pressTab({ shift: true }))
  await pressEscape(t)

  await openProjectSearch(t)
  await scanned(t)
  const frame = t.captureCharFrame()
  expect(frame).toContain('▸ a.ts')
  expect(frame).toContain('▸ b.ts')
})

test('the two scopes remember their own searches', async () => {
  const t = await launch(fixture(PROJECT_FILES), {}, SIZE)
  await openFileFromTree(t)

  await openProjectSearch(t)
  await press(t, (i) => i.typeText('alpha2'))
  await scanned(t)
  await pressEscape(t)

  await openSearch(t)
  await settle(t)
  const frame = t.captureCharFrame()
  expect(frame).toContain('Search in file')
  expect(frame).toContain('Type at least 2 characters')
})

test('a selection beats the remembered query and starts from its first hit', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('alpha'))
  await settle(t)
  await pressTimes(t, 2, (i) => i.pressArrow('down'))
  await pressEscape(t)

  await openSearch(t)
  await press(t, (i) => i.typeText('beta'))
  await settle(t)
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, 'Ln 2, Col 7')
})
