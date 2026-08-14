import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { capsChar, latinKey } from '../src/core/keylayout'
import type { Harness } from './helpers'
import { fixture, launch, openFile, press, settle } from './helpers'

describe('a non-Latin layout', () => {
  test('a Cyrillic character names the US key it sits on', () => {
    expect(latinKey({ name: 'ф' })).toBe('a')
    expect(latinKey({ name: 'і' })).toBe('s')
    expect(latinKey({ name: 'ы' })).toBe('s')
    expect(latinKey({ name: 'з' })).toBe('p')
    // Shift is a separate flag, so the uppercase form is the same key.
    expect(latinKey({ name: 'Ф' })).toBe('a')
  })

  test('a base code from the kitty protocol wins over the table', () => {
    // Layouts the table knows nothing about are covered by this alone.
    expect(latinKey({ name: 'ф', baseCode: 115 })).toBe('s')
    expect(latinKey({ name: 'α', baseCode: 97 })).toBe('a')
    expect(latinKey({ name: 'α' })).toBe('α')
  })

  test('a Latin key keeps its own name', () => {
    expect(latinKey({ name: 's' })).toBe('s')
    expect(latinKey({ name: 'escape' })).toBe('escape')
    expect(latinKey({ name: '.' })).toBe('.')
  })

  test('Ctrl+<Cyrillic> runs the shortcut the key holds', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, { kittyKeyboard: true })
    // Ctrl+з — з is the Ukrainian key at P, so this is Ctrl+P.
    await press(t, i => i.pressKey('з', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Open file')
  })

  test('Ctrl+<Cyrillic> saves, the way Ctrl+S does', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, i => i.pressKey('x'))
    // і is the Ukrainian key at S.
    await press(t, i => i.pressKey('і', { ctrl: true }))
    await settle(t, 100)
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('x')
  })

  test('typing Cyrillic still types it', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, i => i.pressKey('ф'))
    expect(t.captureCharFrame()).toContain('ф')
  })

  // The panels spend bare letters on commands, which no chord translation reaches.
  test("a panel's bare letter runs its command", async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, { kittyKeyboard: true })
    await press(t, i => i.pressArrow('down'))
    // к is the Ukrainian key at R, which renames the tree's selection.
    await press(t, i => i.pressKey('к'))
    expect(t.captureCharFrame()).toContain('Rename to')
  })

  test('vim normal mode answers to the keys, not the letters', async () => {
    const dir = fixture({ 'a.ts': 'one\ntwo\nthree\n' })
    const t = await launch(dir, { vim: true }, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    // в is the Ukrainian key at D: `dd` deletes the line the caret is on.
    await press(t, i => i.pressKey('в'))
    await press(t, i => i.pressKey('в'))
    await press(t, i => i.pressKey('і', { ctrl: true }))
    await settle(t, 100)
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('two\nthree\n')
  })

  test('vim insert mode still types Cyrillic', async () => {
    const t = await launch(fixture({ 'a.ts': 'one\n' }), { vim: true }, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    // ш is the Ukrainian key at I, which enters insert mode; ф then types.
    await press(t, i => i.pressKey('ш'))
    await press(t, i => i.pressKey('ф'))
    expect(t.captureCharFrame()).toContain('ф')
  })
})

/**
 * A caps-locked key as the kitty protocol reports it *without* the associated-text
 * flag: the key's own codepoint, and the lock as a modifier (64, sent one-based).
 * mockInput has no Caps Lock, so the sequence goes in as bytes.
 */
const capsKey = (t: Harness, char: string, shift = false) => {
  const mods = 1 + 64 + (shift ? 1 : 0)
  t.renderer.stdin.emit('data', Buffer.from(`\x1B[${char.codePointAt(0)};${mods}u`))
}

describe('Caps Lock', () => {
  test('locks a letter and is reversed by Shift', () => {
    expect(capsChar('a', false)).toBe('A')
    expect(capsChar('a', true)).toBe('a')
    // Already uppercase: the terminal reported the text, so this changes nothing.
    expect(capsChar('A', false)).toBe('A')
    expect(capsChar('ф', false)).toBe('Ф')
  })

  test('leaves everything that is not a letter alone', () => {
    expect(capsChar('1', false)).toBe('1')
    expect(capsChar('!', true)).toBe('!')
    expect(capsChar('\x1B', false)).toBe('\x1B')
  })

  test('typing with the lock on types uppercase', async () => {
    const t = await launch(fixture({ 'a.ts': 'x\n' }), {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    capsKey(t, 'a')
    capsKey(t, 'b', true)
    await settle(t)
    expect(t.captureCharFrame()).toContain('Ab')
  })

  test("a panel's bare letter still runs its command", async () => {
    const t = await launch(fixture({ 'a.ts': 'x\n' }), {}, {}, { kittyKeyboard: true })
    await press(t, i => i.pressArrow('down'))
    capsKey(t, 'r')
    await settle(t)
    expect(t.captureCharFrame()).toContain('Rename to')
  })
})
