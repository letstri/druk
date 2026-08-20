import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'
import { at, save, type, vimEditor } from './vim-harness'

describe('vim mode basics', () => {
  test('starts in normal mode and says so', async () => {
    const { t } = await vimEditor()
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('i enters insert mode and Esc leaves it, with the sidebar showing', async () => {
    // Esc is also "leave the editor for the tree". App's handler runs first and
    // focus moves synchronously, so without a vim guard the mode never changes
    // and the next key is a tree command — `d` would offer to delete the file.
    const { t } = await vimEditor()
    await press(t, i => i.pressKey('i'))
    expect(t.captureCharFrame()).toContain('INSERT')

    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(t.captureCharFrame()).not.toContain('Delete')
  })

  test('normal mode swallows unknown keys instead of typing them', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('qqq')) // no such command — must not reach the buffer
    await press(t, i => i.pressKey('i'))
    await press(t, i => void i.typeText('X'))
    await press(t, i => i.pressKey('s', { ctrl: true }))

    expect(readFileSync(file, 'utf8')).toBe('Xone\ntwo\nthree\n')
  })

  test('dd deletes a line and p puts it back', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\nthree\n')

    await press(t, i => void i.typeText('p'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\none\nthree\n')
  })

  test('a count applies to the operator that follows it', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('c\nd\n')
  })

  test('a count is not carried into the next command', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2j')) // move, consuming the 2
    await press(t, i => void i.typeText('dd')) // deletes one line, not two
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('a\nb\nd\n')
  })
})

describe('motions', () => {
  test('l moves right, h back', async () => {
    const { t } = await vimEditor()
    await type(t, 'll')
    expect(at(t)).toBe('Ln 1, Col 3')
    await type(t, 'h')
    expect(at(t)).toBe('Ln 1, Col 2')
  })

  test('j / k move by line', async () => {
    const { t } = await vimEditor()
    await type(t, 'jj')
    expect(at(t)).toBe('Ln 3, Col 1')
    await type(t, 'k')
    expect(at(t)).toBe('Ln 2, Col 1')
  })

  test('counted motion: 2j', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\ne\n')
    await type(t, '2j')
    expect(at(t)).toBe('Ln 3, Col 1')
  })

  test('$ goes to line end, 0 to the start', async () => {
    const { t } = await vimEditor()
    await type(t, '$')
    // On the last character, as vim leaves it — not past it.
    expect(at(t)).toBe('Ln 1, Col 3')
    await type(t, '0')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('G goes to the last line, gg back to the first', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\n')
    await type(t, 'G')
    expect(at(t)).toContain('Ln 5')
    await type(t, 'gg')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('w / b step by word', async () => {
    const { t } = await vimEditor('alpha beta gamma\n')
    await type(t, 'w')
    expect(at(t)).toBe('Ln 1, Col 7')
    await type(t, 'w')
    expect(at(t)).toBe('Ln 1, Col 12')
    await type(t, 'b')
    expect(at(t)).toBe('Ln 1, Col 7')
  })

  test('5G jumps to line 5', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\ne\nf\n')
    await type(t, '5G')
    expect(at(t)).toBe('Ln 5, Col 1')
  })
})

describe('entering insert mode', () => {
  test('i inserts before the cursor', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xone\ntwo\nthree\n')
  })

  test('a inserts after it', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'a')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oXne\ntwo\nthree\n')
  })

  test('A appends at the line end', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'A')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oneX\ntwo\nthree\n')
  })

  test('I inserts at the line start', async () => {
    const { t, file } = await vimEditor()
    await type(t, '$I')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xone\ntwo\nthree\n')
  })

  test('o opens a line below, O above', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'o')
    await type(t, 'X')
    expect(await save(t, file)).toBe('one\nX\ntwo\nthree\n')

    await pressEscape(t)
    await type(t, 'O')
    await type(t, 'Y')
    expect(await save(t, file)).toBe('one\nY\nX\ntwo\nthree\n')
  })

  test('Esc leaves insert mode and steps left', async () => {
    const { t } = await vimEditor()
    await type(t, 'A')
    await type(t, 'XY')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(at(t)).toBe('Ln 1, Col 5')
  })
})

describe('normal-mode edits', () => {
  test('x deletes the character under the cursor', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'x')
    expect(await save(t, file)).toBe('ne\ntwo\nthree\n')
  })

  test('3x deletes three', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, '3x')
    expect(await save(t, file)).toBe('def\n')
  })

  test('D deletes to the line end', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'lD')
    expect(await save(t, file)).toBe('o\ntwo\nthree\n')
  })

  test('C deletes to the line end and inserts', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'lC')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oX\ntwo\nthree\n')
  })

  test('dw deletes a word', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'dw')
    expect(await save(t, file)).toBe('beta\n')
  })

  test('cw changes a word', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'cw')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xbeta\n')
  })

  test('d$ deletes to the end', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'wd$')
    expect(await save(t, file)).toBe('alpha \n')
  })

  test('cc clears the line and inserts', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'jcc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('one\nX\nthree\n')
  })

  test('yy then p puts the copy below', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'yyp')
    expect(await save(t, file)).toBe('one\none\ntwo\nthree\n')
  })

  test('yy then P puts it above', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'jyyP')
    expect(await save(t, file)).toBe('one\ntwo\ntwo\nthree\n')
  })

  test('u undoes the last edit', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'dd')
    await type(t, 'u')
    expect(await save(t, file)).toBe('one\ntwo\nthree\n')
  })

  test('Ctrl+R redoes it', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'dd')
    await type(t, 'u')
    await press(t, i => i.pressKey('r', { ctrl: true }))
    await settle(t)
    expect(await save(t, file)).toBe('two\nthree\n')
  })
})

describe('viewport', () => {
  const long = `${Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')}\n`
  const shown = (t: Harness) =>
    t
      .captureCharFrame()
      .split('\n')
      .flatMap(row => row.match(/line \d+/) ?? [])

  test('zz puts the cursor line in the middle of the window', async () => {
    const { t } = await vimEditor(long)
    await type(t, '100G')
    expect(at(t)).toBe('Ln 100, Col 1')
    const before = shown(t)
    expect(before).toContain('line 99')
    // G reveals the line by the smallest scroll, so it sits near the bottom.
    expect(before[0]).not.toBe('line 90')

    await type(t, 'zz')
    expect(at(t)).toBe('Ln 100, Col 1')
    const after = shown(t)
    expect(after[0]).toBe('line 90')
    const mid = after.indexOf('line 99')
    expect(Math.abs(mid - Math.floor(after.length / 2))).toBeLessThanOrEqual(1)
    expect(t.captureCharFrame()).not.toContain('●')
  })

  test('a count with zz jumps to that line and centres it', async () => {
    const { t } = await vimEditor(long)
    await type(t, '50zz')
    expect(at(t)).toBe('Ln 50, Col 1')
    const lines = shown(t)
    expect(lines[0]).toBe('line 40')
    expect(lines).toContain('line 49')
  })

  test('zz recentres with a selection live, and the selection survives', async () => {
    const { t, file } = await vimEditor(long)
    await type(t, '100G')
    await type(t, 'vjj')
    await type(t, 'zz')
    expect(shown(t)[0]).toBe('line 92') // the caret is on line 102 after vjj
    // The viewport moved; the selection is still the one `v` started.
    await type(t, 'd')
    expect(await save(t, file)).toContain('line 98\nine 101\n')
  })

  test('zz near the top of the file scrolls nothing and moves no caret', async () => {
    const { t } = await vimEditor(long)
    await type(t, 'gg')
    const before = shown(t)
    await type(t, 'zz')
    expect(at(t)).toBe('Ln 1, Col 1')
    expect(shown(t)).toEqual(before)
  })
})
