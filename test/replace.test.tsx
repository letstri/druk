import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { replaceAll, replaceMatch } from '../src/core/search'
import { fixture, launch, press, pressEscape, settle } from './helpers'

test('replaceAll swaps every occurrence, ignoring case', () => {
  expect(replaceAll('a Foo b foo c', 'foo', 'bar')).toBe('a bar b bar c')
  expect(replaceAll('nothing here', 'foo', 'bar')).toBe('nothing here')
  expect(replaceAll('abc', '', 'x')).toBe('abc')
})

test('the query is matched literally, not as a regex', () => {
  expect(replaceAll('a.b axb', 'a.b', 'Z')).toBe('Z axb')
  expect(replaceAll('cost $5', '$5', 'free')).toBe('cost free')
})

test('the replacement is inserted literally', () => {
  expect(replaceAll('foo', 'foo', '$&$1')).toBe('$&$1')
})

test('a character that changes length when lowercased does not shift the match', () => {
  // U+0130 lowercases to two code units, so offsets from a lowercased copy drift.
  expect(replaceAll('İstanbul FOO', 'foo', 'BAR')).toBe('İstanbul BAR')
})

test('replaceMatch touches the one occurrence it is given', () => {
  const text = 'old one\nold two\n'
  const match = { col: 0, length: 3, line: 1, path: 'a.ts', text: 'old two' }
  expect(replaceMatch(text, match, 'new')).toBe('old one\nnew two\n')
})

test('replaceMatch refuses a match whose line has moved on', () => {
  const stale = { col: 0, length: 3, line: 0, path: 'a.ts', text: 'old one' }
  expect(replaceMatch('edited since\n', stale, 'new')).toBeNull()
})

async function openReplace(dir: string, query: string, replacement: string) {
  // Wide enough that the find widget leaves the file's own lines on screen beside it.
  const t = await launch(dir, {}, { height: 30, width: 110 })
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())

  await press(t, (i) => i.pressKey('f', { ctrl: true }))
  await press(t, (i) => i.typeText(query))
  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.typeText(replacement))
  return t
}

test('the file stays on screen, untouched, while a replacement is typed', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\nconst old2 = old + 1\n' })
  const t = await openReplace(dir, 'old', 'fresh')
  await settle(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('const old = 1')
  expect(frame).toContain('1 of 3')
  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
    'const old = 1\nconst old2 = old + 1\n'
  )
})

test('Enter with the replacement empty deletes the match', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\n' })
  const t = await openReplace(dir, 'old', '')

  await press(t, (i) => i.pressEnter())
  await pressEscape(t)
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('const  = 1\n')
})

test('Ctrl+A replaces every match in the open file', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\nconst old2 = old + 1\n' })
  const t = await openReplace(dir, 'old', 'fresh')

  await press(t, (i) => i.pressKey('a', { ctrl: true }))
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
    'const fresh = 1\nconst fresh2 = fresh + 1\n'
  )
})

test('Enter replaces only the selected match, leaving the rest', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\nconst old2 = old + 1\n' })
  const t = await openReplace(dir, 'old', 'fresh')

  await press(t, (i) => i.pressEnter())
  await pressEscape(t)
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
    'const fresh = 1\nconst old2 = old + 1\n'
  )
})

test('the panel stays open, so the next match can go too', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\nconst old2 = old + 1\n' })
  const t = await openReplace(dir, 'old', 'fresh')

  await press(t, (i) => i.pressEnter())
  await press(t, (i) => i.pressEnter())
  await pressEscape(t)
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(
    'const fresh = 1\nconst fresh2 = old + 1\n'
  )
})

test('a replacement is undoable — it must not wipe the history', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\n' })
  const t = await openReplace(dir, 'old', 'fresh')

  await press(t, (i) => i.pressEnter())
  await pressEscape(t)
  await press(t, (i) => i.pressKey('z', { ctrl: true }))
  await press(t, (i) => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('const old = 1\n')
})
