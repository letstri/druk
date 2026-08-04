import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { helpRows } from '../src/ui/keys'
import { F1, fixture, launch, openFile, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
const PROJECT = { 'a.ts': 'alpha beta\n', 'b.ts': 'const b = 2\n' }

async function tree() {
  return launch(fixture(PROJECT))
}
async function opened() {
  const t = await tree()
  await openFile(t, 'a.ts')
  return t
}
const frame = (t: Harness) => t.captureCharFrame()

/**
 * One sweep over every key HelpOverlay and the palette advertise. It exists because
 * a dead key is invisible: Tab did nothing in the editor for a long time, and Ctrl+X
 * was once silently swallowed before it could reach the clipboard.
 */
test('every advertised hotkey does something', async () => {
  const report: string[] = []
  const check = (name: string, ok: boolean) => report.push(`${ok ? 'ok  ' : 'DEAD'}  ${name}`)

  let t = await tree()
  await press(t, i => void i.pressKeys([F1]))
  check('F1 palette', frame(t).includes('Commands'))

  // Ctrl+Opt+P: Opt sends an ESC prefix ahead of Ctrl+P (0x10).
  t = await tree()
  await press(t, i => void i.pressKeys([`${ESC}${String.fromCharCode(16)}`]))
  check('Ctrl+Opt+P palette', frame(t).includes('Commands'))

  t = await tree()
  await press(t, i => i.pressKey('p', { ctrl: true }))
  check('Ctrl+P file picker', frame(t).includes('Open file'))

  t = await tree()
  await press(t, i => i.pressKey('o', { ctrl: true }))
  check('Ctrl+O file picker', frame(t).includes('Open file'))

  t = await tree()
  await press(t, i => i.pressKey('g', { ctrl: true }))
  check('Ctrl+G go to line', frame(t).includes('Go to line'))

  t = await opened()
  await press(t, i => i.pressKey('f', { ctrl: true }))
  check('Ctrl+F find in file', frame(t).includes('Search in file'))

  t = await opened()
  await press(t, i => i.pressKey('r', { ctrl: true }))
  check('Ctrl+R find in project', frame(t).includes('Search in project'))

  t = await tree()
  await press(t, i => i.pressKey('n', { ctrl: true }))
  check('Ctrl+N new file', frame(t).includes('New file name'))

  // Ctrl+Opt+N: Opt sends an ESC prefix ahead of Ctrl+N (0x0e).
  t = await tree()
  await press(t, i => void i.pressKeys([`${ESC}${String.fromCharCode(14)}`]))
  check('Ctrl+Opt+N new folder', frame(t).includes('New folder name'))

  t = await opened()
  await press(t, i => i.pressKey('t', { ctrl: true }))
  check('Ctrl+T switch tab', frame(t).includes('Switch tab'))

  // Ctrl+Opt+G: ESC prefix ahead of Ctrl+G (0x07).
  t = await tree()
  await press(t, i => void i.pressKeys([`${ESC}${String.fromCharCode(7)}`]))
  check('Ctrl+Opt+G source control', frame(t).includes('◆ review'))

  t = await tree()
  await press(t, i => i.pressKey('b', { ctrl: true }))
  check('Ctrl+B sidebar', !frame(t).includes('explorer'))

  t = await opened()
  await press(t, i => i.pressKey('w', { ctrl: true }))
  check('Ctrl+W close tab', frame(t).includes('no open files'))

  t = await tree()
  await press(t, i => i.pressArrow('down'))
  check('↓ moves in tree', frame(t).includes('a.ts'))

  t = await tree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  check('Enter opens file', frame(t).includes('alpha beta'))

  t = await tree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('a'))
  check('a new file (tree)', frame(t).includes('New file name'))

  // Shift+A should mean "new folder" — terminals send a bare uppercase letter.
  t = await tree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('A'))
  check('A new folder (tree)', frame(t).includes('New folder name'))

  t = await tree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('r'))
  check('r rename (tree)', frame(t).includes('Rename to'))

  t = await tree()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('d'))
  check('d delete (tree)', frame(t).includes('Delete'))

  t = await opened()
  await pressEscape(t)
  await press(t, i => i.pressArrow('down'))
  check('Esc editor → tree', frame(t).includes('explorer'))

  // Cut and paste go through the system clipboard, so they can only be swept on
  // a machine that has one — headless CI has no pbcopy/xclip to round-trip through.
  const clipboard = ['pbcopy', 'wl-copy', 'xclip', 'xsel'].some(tool => Bun.which(tool))
  if (!clipboard) {
    const dead = report.filter(line => line.startsWith('DEAD'))
    if (dead.length > 0) console.error(`\n${report.join('\n')}\n`)
    expect(dead).toEqual([])
    return
  }

  // Cut: select with the mouse, since that is the only way to select now, then
  // Ctrl+X should remove it.
  const dirCut = fixture(PROJECT)
  t = await launch(dirCut)
  await openFile(t, 'a.ts')
  const alphaAt = frame(t).split('\n')[1]!.indexOf('alpha')
  await t.mockMouse.drag(alphaAt, 1, alphaAt + 5, 1)
  await t.mockMouse.release(alphaAt + 5, 1)
  await settle(t)
  await press(t, i => i.pressKey('x', { ctrl: true }))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  const afterCut = readFileSync(join(dirCut, 'a.ts'), 'utf8')
  check('Ctrl+X cut', !afterCut.startsWith('alpha'))

  // Paste what was just cut.
  await press(t, i => i.pressKey('v', { ctrl: true }))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  const afterPaste = readFileSync(join(dirCut, 'a.ts'), 'utf8')
  check('Ctrl+V paste', afterPaste.includes('alpha'))

  await settle(t)
  const dead = report.filter(line => line.startsWith('DEAD'))
  // Print the whole table only when something is wrong: the failure message names
  // the dead keys, but the surrounding oks say how far the sweep got.
  if (dead.length > 0) console.error(`\n${report.join('\n')}\n`)
  expect(dead).toEqual([])
}, 120000)

test('the help table does not list one key twice with different meanings', () => {
  const rows = helpRows()
  const keys = rows.map(([key]) => key)
  expect(new Set(keys).size).toBe(keys.length)

  // Ctrl+C both copies and quits; the row has to say so, or it reads as a bug
  // when the editor exits. This is the row that misled once already.
  const copyRow = rows.find(([key]) => key.includes('Ctrl+C'))!
  expect(copyRow[1].toLowerCase()).toContain('quit')
})
