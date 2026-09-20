import { expect, test } from 'bun:test'

import { ALT } from '../src/ui/keys'
import { fixture, launch, openPalette, press, pressEscape, runCommand } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'alpha beta\n', 'b.ts': 'const b = 2\n' }
const ESC = String.fromCharCode(27)

// The Opt modifier is an ESC prefix ahead of the Ctrl byte.
const ctrlOpt = (letter: string) =>
  `${ESC}${String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)}`

const F5 = `${ESC}[15~`
const F6 = `${ESC}[17~`

const frame = (t: Harness) => t.captureCharFrame()

test('a custom chord runs the command, and the key it replaced does not', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { 'view.sidebar': `Ctrl+${ALT}+B` } })
  expect(frame(t)).toContain('EXPLORER')

  await press(t, i => void i.pressKeys([ctrlOpt('b')]))
  expect(frame(t)).not.toContain('EXPLORER')

  await press(t, i => i.pressKey('b', { ctrl: true }))
  expect(frame(t)).not.toContain('EXPLORER')
})

test('a command with no default key can be given one', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { help: 'F5', settings: 'F6' } })
  await press(t, i => void i.pressKeys([F5]))
  expect(frame(t)).toContain('Keyboard shortcuts')
  await pressEscape(t)
  await press(t, i => void i.pressKeys([F6]))
  expect(frame(t)).toContain('Settings —')
})

test('"none" takes a key away without disturbing the others', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { goto: 'none' } })
  await press(t, i => i.pressKey('g', { ctrl: true }))
  expect(frame(t)).not.toContain('Go to line')
  await press(t, i => i.pressKey('p', { ctrl: true }))
  expect(frame(t)).toContain('Open file')
})

test('the palette still reaches a command whose key was taken away', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { goto: 'none' } })
  await openPalette(t)
  await press(t, i => void i.typeText('Go to line'))
  await press(t, i => i.pressEnter())
  expect(frame(t)).toContain('Go to line')
})

test('the help table advertises the custom key, not the one it replaced', async () => {
  const t = await launch(
    fixture(PROJECT),
    { keybindings: { 'view.sidebar': `Ctrl+${ALT}+B`, 'settings': 'F6' } },
    { height: 64 },
  )
  await runCommand(t, 'Keyboard shortcuts')
  const rowFor = async (text: string) => {
    for (let i = 0; i < 60; i++) {
      const row = frame(t)
        .split('\n')
        .find(line => line.includes(text))
      if (row) return row
      await press(t, input => input.pressArrow('down'))
    }
    throw new Error(`No row for ${text} in the help table`)
  }
  expect(await rowFor('Show / hide sidebar')).toContain(`Ctrl+${ALT}+B`)
  expect(await rowFor('Settings')).toContain('F6')
  expect(frame(t)).toContain('Custom keys')
})

test('a chord bound twice leaves one command with it and warns about the other', async () => {
  const t = await launch(fixture(PROJECT), {
    keybindings: { 'problems.list': 'F6', 'settings': 'F6' },
  })
  expect(frame(t)).toContain('F6 is bound twice')

  await press(t, i => void i.pressKeys([F6]))
  expect(frame(t)).toContain('No problems')
  expect(frame(t)).not.toContain('Settings —')
})

test('an lspServers key no extension registers is reported on startup', async () => {
  const t = await launch(fixture(PROJECT), { lspServers: { tyepscript: [] } }, { width: 110 })
  expect(frame(t)).toContain('no installed extension brings a server "tyepscript"')
})

test('a config value that is not a chord is reported and the default kept', async () => {
  const t = await launch(fixture(PROJECT), { keybindings: { save: 'Ctrl+Banana' } })
  expect(frame(t)).toContain('Shortcut "Ctrl+Banana"')
  await press(t, i => i.pressKey('p', { ctrl: true }))
  expect(frame(t)).toContain('Open file')
})

test('the settings page rebinds a command and refuses a chord already spoken for', async () => {
  const t = await launch(fixture(PROJECT), {}, { height: 40 })
  await runCommand(t, 'Settings')
  for (let i = 0; i < 40; i++) {
    const row = frame(t)
      .split('\n')
      .find(line => line.includes('Shortcuts'))
    if (row?.includes('▌')) break
    await press(t, input => input.pressArrow('down'))
  }
  expect(frame(t)).toContain('0 custom')

  // The chord field carries the command's current key, so only unbound ones can be typed into.
  const bind = async (command: string, chord: string) => {
    await press(t, input => input.pressEnter())
    await press(t, input => void input.typeText(command))
    await press(t, input => input.pressEnter())
    await press(t, input => void input.typeText(chord))
    await press(t, input => input.pressEnter())
  }

  await bind('List problems', `Ctrl+${ALT}+K`)
  expect(frame(t)).toContain(`Ctrl+${ALT}+K →`)
  expect(frame(t)).toContain('1 custom')

  await bind('Save all', `Ctrl+${ALT}+K`)
  expect(frame(t)).toContain('unbind that one first')

  await bind('Save all', 'Ctrl+C')
  expect(frame(t)).toContain('Ctrl+C copies')

  await pressEscape(t)
  await press(t, input => void input.pressKeys([ctrlOpt('k')]))
  expect(frame(t)).toContain('No problems')
})
