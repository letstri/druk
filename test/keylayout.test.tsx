import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { capsChar, latinKey } from '../src/core/keylayout'
import type { Harness } from './helpers'
import { fixture, launch, openFile, press, pressEscape, settle, until } from './helpers'

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

// Layout text the mock keyboard cannot encode. Flushed, so a save after it
// reads the edited buffer and not the one before.
async function send(t: Harness, bytes: string) {
  t.renderer.stdin.emit('data', Buffer.from(bytes))
  await settle(t)
}

describe('layout text', () => {
  test.each([
    ['German Option+L', '\x1B[108;3;64u', '@'],
    ['Option+Shift', '\x1B[55;4;92u', '\\'],
    ['AltGr text with its consumed modifiers removed', '\x1B[64;1;64u', '@'],
    ['a pure text event', '\x1B[0;;229u', 'å'],
    ['a composed letter', '\x1B[110;1;241u', 'ñ'],
    ['a dead key committed with Space', '\x1B[32;1;126u', '~'],
    ['multiple code points', '\x1B[0;;101:769:128578u', 'e\u0301🙂'],
    ['text that spells a named key', '\x1B[0;;114:101:116:117:114:110u', 'return'],
    ['text already composed with Caps Lock', '\x1B[101;65;233u', 'é'],
    ['a non-Latin layout', '\x1B[945::97;1;945u', 'α'],
    ['legacy UTF-8', '@~ñåéα🙂', '@~ñåéα🙂'],
  ])(
    '%s is saved exactly as the terminal produced it',
    async (_label, bytes, expected) => {
      const dir = fixture({ 'a.txt': '' })
      const t = await launch(dir, {}, {}, { kittyKeyboard: true })
      await openFile(t, 'a.txt')
      await send(t, bytes)
      await press(t, i => i.pressKey('s', { ctrl: true }))
      await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf8') === expected)
    },
    20000,
  )

  test('a named key keeps its name when the terminal reports its text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\x1B[97;1;97u\x1B[13;1;13u\x1B[9;1;9u\x1B[98;1;98u')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await until(t, () => /^a\n[\t ]+b$/.test(readFileSync(join(dir, 'a.txt'), 'utf8')))
  }, 20000)

  test('an Option dead-key press waits for the committed text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\x1B[110;3u')
    expect(t.captureCharFrame()).not.toContain('unsaved')
    await send(t, '\x1B[32;1;126u\x1B[110;3u\x1B[110;1;241u')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf8') === '~ñ')
  }, 20000)

  test('text reaches search and file-name inputs', async () => {
    const dir = fixture({ 'a.txt': '@~\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await press(t, i => i.pressKey('f', { ctrl: true }))
    await send(t, '\x1B[108;3;64u\x1B[32;1;126u')
    await until(t, () => t.captureCharFrame().includes('1 of 1'))
    await pressEscape(t)
    await press(t, i => i.pressKey('n', { ctrl: true }))
    await send(t, '\x1B[108;3;64u\x1B[32;1;126u')
    expect(t.captureCharFrame()).toContain('@~')
    await press(t, i => i.pressEnter())
    await until(t, () => existsSync(join(dir, '@~')))
  }, 20000)

  test('Option text still uses bracket pairing and undo', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\x1B[53;3;91u')
    expect(t.captureCharFrame()).toContain('[]')
    await send(t, '\x1B[54;3;93u\x1B[108;3;64u')
    expect(t.captureCharFrame()).toContain('[]@')
    await press(t, i => i.pressKey('z', { ctrl: true }))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('')
    await press(t, i => i.pressKey('y', { ctrl: true }))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('[]@')
  }, 20000)

  test('Ctrl+Option shortcuts keep their key even when text is attached', async () => {
    const t = await launch(fixture({ 'a.txt': '' }), {}, {}, { kittyKeyboard: true })
    await send(t, '\x1B[112;7;960u')
    expect(t.captureCharFrame()).toContain('Commands')
    await pressEscape(t)
    await send(t, '\x1B[112;5;112u')
    expect(t.captureCharFrame()).toContain('Open file')
  }, 20000)

  test('Option arrows still move lines and Shift+Option arrows duplicate them', async () => {
    const dir = fixture({ 'a.txt': 'one\ntwo\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\x1B[1;3B')
    await send(t, '\x1B[1;4A')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf8') === 'two\none\none\n')
  }, 20000)

  test('release events never insert text and repeats insert it once per event', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\x1B[108;3:1;64u\x1B[108;3:2;64u\x1B[108;3:3;64u')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf8') === '@@')
  }, 20000)

  test('vim insert mode accepts Option and composed text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, { vim: true }, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await press(t, i => i.pressKey('i'))
    await send(t, '\x1B[108;3;64u\x1B[32;1;126u')
    await pressEscape(t)
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf8') === '@~')
  }, 20000)
})
