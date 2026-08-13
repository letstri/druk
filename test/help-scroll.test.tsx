import { expect, test } from 'bun:test'

import { fixture, launch, openPalette, press, pressTimes } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

async function openHelp(height: number) {
  const t = await launch(fixture(PROJECT), {}, { height })
  await openPalette(t)
  await press(t, i => void i.typeText('shortcuts'))
  await press(t, i => i.pressEnter())
  return t
}

test('on a short terminal the table windows instead of clipping the footer', async () => {
  const t = await openHelp(20)
  const frame = t.captureCharFrame()

  expect(frame).toContain('Keyboard shortcuts')
  expect(frame).toContain('General')
  expect(frame).toContain('↑↓ scroll · Esc close')
  // The last section is off-screen until scrolled to.
  expect(frame).not.toContain('Editor → tree')

  await pressTimes(t, 60, i => i.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('Editor → tree')
})

test('a tall terminal shows every section with the plain footer', async () => {
  // Exactly the height the whole table needs: the overlay draws a window of
  // `height - 7` lines, so a row added to `KEYS` costs a row here too.
  const t = await openHelp(82)
  const frame = t.captureCharFrame()

  for (const section of [
    'General',
    'Editing',
    'Search & replace',
    'File tree',
    'Review',
    'View',
    'Extensions',
  ]) {
    expect(frame).toContain(section)
  }
  expect(frame).toContain('Editor → tree')
  expect(frame).toContain('Press Esc to close')
})
