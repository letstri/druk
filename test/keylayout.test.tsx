import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { capsChar, latinKey } from '../src/core/keylayout'
import type { Harness } from './helpers'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  settle,
  until,
} from './helpers'

describe('a non-Latin layout', () => {
  test('a Cyrillic character names the US key it sits on', () => {
    expect(latinKey({ name: 'ф' })).toBe('a')
    expect(latinKey({ name: 'і' })).toBe('s')
    expect(latinKey({ name: 'ы' })).toBe('s')
    expect(latinKey({ name: 'з' })).toBe('p')
    expect(latinKey({ name: 'Ф' })).toBe('a')
  })

  test('a base code from the kitty protocol wins over the table', () => {
    expect(latinKey({ baseCode: 115, name: 'ф' })).toBe('s')
    expect(latinKey({ baseCode: 97, name: 'α' })).toBe('a')
    expect(latinKey({ name: 'α' })).toBe('α')
  })

  test('a Latin key keeps its own name', () => {
    expect(latinKey({ name: 's' })).toBe('s')
    expect(latinKey({ name: 'escape' })).toBe('escape')
    expect(latinKey({ name: '.' })).toBe('.')
  })

  test('Ctrl+<Cyrillic> runs the shortcut the key holds', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await press(t, (i) => i.pressKey('з', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Open file')
  })

  test('Ctrl+<Cyrillic> saves, the way Ctrl+S does', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, (i) => i.pressKey('x'))
    await press(t, (i) => i.pressKey('і', { ctrl: true }))
    await settle(t, 100)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('x')
  })

  test('typing Cyrillic still types it', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await openFile(t, 'a.ts')
    await press(t, (i) => i.pressKey('ф'))
    expect(t.captureCharFrame()).toContain('ф')
  })

  test("a panel's bare letter runs its command", async () => {
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await press(t, (i) => i.pressArrow('down'))
    await press(t, (i) => i.pressKey('к'))
    expect(t.captureCharFrame()).toContain('Rename to')
  })

  test('vim normal mode answers to the keys, not the letters', async () => {
    const dir = fixture({ 'a.ts': 'one\ntwo\nthree\n' })
    const t = await launch(dir, { vim: true }, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, (i) => i.pressKey('в'))
    await press(t, (i) => i.pressKey('в'))
    await press(t, (i) => i.pressKey('і', { ctrl: true }))
    await settle(t, 100)
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('two\nthree\n')
  })

  test('vim insert mode still types Cyrillic', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'one\n' }),
      { vim: true },
      {},
      { kittyKeyboard: true }
    )
    await openFile(t, 'a.ts')
    await press(t, (i) => i.pressKey('ш'))
    await press(t, (i) => i.pressKey('ф'))
    expect(t.captureCharFrame()).toContain('ф')
  })
})

// A caps-locked key as kitty reports one: own codepoint, lock as modifier 64 (one-based).
const capsKey = (t: Harness, char: string, shift = false) => {
  const mods = 1 + 64 + (shift ? 1 : 0)
  t.renderer.stdin.emit(
    'data',
    Buffer.from(`\u001B[${char.codePointAt(0)};${mods}u`)
  )
}

describe('Caps Lock', () => {
  test('locks a letter and is reversed by Shift', () => {
    expect(capsChar('a', false)).toBe('A')
    expect(capsChar('a', true)).toBe('a')
    expect(capsChar('A', false)).toBe('A')
    expect(capsChar('ф', false)).toBe('Ф')
  })

  test('leaves everything that is not a letter alone', () => {
    expect(capsChar('1', false)).toBe('1')
    expect(capsChar('!', true)).toBe('!')
    expect(capsChar('\u001B', false)).toBe('\u001B')
  })

  test('typing with the lock on types uppercase', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'x\n' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await openFile(t, 'a.ts')
    capsKey(t, 'a')
    capsKey(t, 'b', true)
    await settle(t)
    expect(t.captureCharFrame()).toContain('Ab')
  })

  test("a panel's bare letter still runs its command", async () => {
    const t = await launch(
      fixture({ 'a.ts': 'x\n' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await press(t, (i) => i.pressArrow('down'))
    capsKey(t, 'r')
    await settle(t)
    expect(t.captureCharFrame()).toContain('Rename to')
  })
})

async function send(t: Harness, bytes: string) {
  t.renderer.stdin.emit('data', Buffer.from(bytes))
  await settle(t)
}

describe('layout text', () => {
  test.each([
    ['German Option+L', '\u001B[108;3;64u', '@'],
    ['Option+Shift', '\u001B[55;4;92u', '\\'],
    ['AltGr text with its consumed modifiers removed', '\u001B[64;1;64u', '@'],
    ['a pure text event', '\u001B[0;;229u', 'å'],
    ['a composed letter', '\u001B[110;1;241u', 'ñ'],
    ['a dead key committed with Space', '\u001B[32;1;126u', '~'],
    ['multiple code points', '\u001B[0;;101:769:128578u', 'e\u0301🙂'],
    [
      'text that spells a named key',
      '\u001B[0;;114:101:116:117:114:110u',
      'return',
    ],
    ['text already composed with Caps Lock', '\u001B[101;65;233u', 'é'],
    ['a non-Latin layout', '\u001B[945::97;1;945u', 'α'],
    ['legacy UTF-8', '@~ñåéα🙂', '@~ñåéα🙂'],
  ])(
    '%s is saved exactly as the terminal produced it',
    async (_label, bytes, expected) => {
      const dir = fixture({ 'a.txt': '' })
      const t = await launch(dir, {}, {}, { kittyKeyboard: true })
      await openFile(t, 'a.txt')
      await send(t, bytes)
      await press(t, (i) => i.pressKey('s', { ctrl: true }))
      await until(
        t,
        () => readFileSync(join(dir, 'a.txt'), 'utf-8') === expected
      )
    },
    20_000
  )

  test('a named key keeps its name when the terminal reports its text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(
      t,
      '\u001B[97;1;97u\u001B[13;1;13u\u001B[13;1;13:97u\u001B[13;1;133u'
    )
    await send(t, '\u001B[9;1;9u\u001B[98;1;98u')
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    await until(t, () =>
      /^a\n\n\n[\t ]+b$/u.test(readFileSync(join(dir, 'a.txt'), 'utf-8'))
    )
  }, 20_000)

  test('an Option dead-key press waits for the committed text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\u001B[110;3u')
    expect(t.captureCharFrame()).not.toContain('unsaved')
    await send(t, '\u001B[32;1;126u\u001B[110;3u\u001B[110;1;241u')
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf-8') === '~ñ')
  }, 20_000)

  test('text reaches search and file-name inputs', async () => {
    const dir = fixture({ 'a.txt': '@~\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await press(t, (i) => i.pressKey('f', { ctrl: true }))
    await send(t, '\u001B[108;3;64u\u001B[32;1;126u')
    await until(t, () => t.captureCharFrame().includes('1 of 1'))
    await pressEscape(t)
    await press(t, (i) => i.pressKey('n', { ctrl: true }))
    await send(t, '\u001B[108;3;64u\u001B[32;1;126u')
    expect(t.captureCharFrame()).toContain('@~')
    await press(t, (i) => i.pressEnter())
    await until(t, () => existsSync(join(dir, '@~')))
  }, 20_000)

  test('Option text still uses bracket pairing and undo', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\u001B[53;3;91u')
    expect(t.captureCharFrame()).toContain('[]')
    await send(t, '\u001B[54;3;93u\u001B[108;3;64u')
    expect(t.captureCharFrame()).toContain('[]@')
    await press(t, (i) => i.pressKey('z', { ctrl: true }))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe('')
    await press(t, (i) => i.pressKey('y', { ctrl: true }))
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe('[]@')
  }, 20_000)

  test('Ctrl+Option shortcuts keep their key even when text is attached', async () => {
    const t = await launch(
      fixture({ 'a.txt': '' }),
      {},
      {},
      { kittyKeyboard: true }
    )
    await send(t, '\u001B[112;7;960u')
    expect(t.captureCharFrame()).toContain('Commands')
    await pressEscape(t)
    await send(t, '\u001B[112;5;112u')
    expect(t.captureCharFrame()).toContain('Open file')
  }, 20_000)

  test('Option arrows still move lines and Shift+Option arrows duplicate them', async () => {
    const dir = fixture({ 'a.txt': 'one\ntwo\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\u001B[1;3B')
    await send(t, '\u001B[1;4A')
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    await until(
      t,
      () => readFileSync(join(dir, 'a.txt'), 'utf-8') === 'two\none\none\n'
    )
  }, 20_000)

  test('release events never insert text and repeats insert it once per event', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await send(t, '\u001B[108;3:1;64u\u001B[108;3:2;64u\u001B[108;3:3;64u')
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf-8') === '@@')
  }, 20_000)

  test('vim insert mode accepts Option and composed text', async () => {
    const dir = fixture({ 'a.txt': '' })
    const t = await launch(dir, { vim: true }, {}, { kittyKeyboard: true })
    await openFile(t, 'a.txt')
    await press(t, (i) => i.pressKey('i'))
    await send(t, '\u001B[108;3;64u\u001B[32;1;126u')
    await pressEscape(t)
    await press(t, (i) => i.pressKey('s', { ctrl: true }))
    await until(t, () => readFileSync(join(dir, 'a.txt'), 'utf-8') === '@~')
  }, 20_000)
})
