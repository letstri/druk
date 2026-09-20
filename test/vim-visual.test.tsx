import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, pressEscape, settle } from './helpers'
import { at, save, type, vimEditor } from './vim-harness'

describe('visual mode', () => {
  test('v selects and d deletes the selection', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(await save(t, file)).toBe('def\n')
  })

  test('v then y yanks, p puts it back', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vly')
    await type(t, '$p')
    expect(await save(t, file)).toBe('abcdefab\n')
  })

  test('v$ stops on the last character, so d keeps the line break', async () => {
    const { t, file } = await vimEditor('const beta = 2\nnext\n')
    await type(t, 'wv$d')
    expect(await save(t, file)).toBe('const \nnext\n')
  })

  test('Esc leaves visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'v')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('c on a selection deletes it and inserts', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vlc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xcdef\n')
  })
})

describe('edges', () => {
  test('x at the end of a line takes the last character, not the newline', async () => {
    const { t, file } = await vimEditor()
    await type(t, '$x')
    expect(await save(t, file)).toBe('on\ntwo\nthree\n')
  })

  test('x on an empty line does nothing', async () => {
    const { t, file } = await vimEditor('a\n\nb\n')
    await type(t, 'jx')
    expect(await save(t, file)).toBe('a\n\nb\n')
  })

  test('dd on the last line', async () => {
    const { t, file } = await vimEditor('a\nb\n')
    await type(t, 'jdd')
    expect(await save(t, file)).toBe('a\n')
  })

  test('3dd takes three lines', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await type(t, '3dd')
    expect(await save(t, file)).toBe('d\n')
  })

  test('d2w deletes two words', async () => {
    const { t, file } = await vimEditor('alpha beta gamma\n')
    await type(t, 'd2w')
    expect(await save(t, file)).toBe('gamma\n')
  })

  test('2dw is the same as d2w', async () => {
    const { t, file } = await vimEditor('alpha beta gamma\n')
    await type(t, '2dw')
    expect(await save(t, file)).toBe('gamma\n')
  })

  test('visual selection can run backwards', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, '$hvhhd')
    expect(await save(t, file)).toBe('abf\n')
  })

  test('visual across lines deletes both halves', async () => {
    const { t, file } = await vimEditor('abc\ndef\n')
    await type(t, 'lvjd')
    expect(await save(t, file)).toBe('af\n')
  })

  test('Esc in visual clears the selection, so the next edit is not it', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    await pressEscape(t)
    await type(t, 'x')
    expect(await save(t, file)).toBe('abdef\n')
  })

  test('u steps back through several bursts', async () => {
    const { t, file } = await vimEditor('a\nb\nc\n')
    await type(t, 'dd')
    await settle(t, 450)
    await type(t, 'dd')
    await settle(t, 450)
    expect(await save(t, file)).toBe('c\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('b\nc\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('a\nb\nc\n')
  })

  test('the mode shows in the status bar', async () => {
    const { t } = await vimEditor()
    await type(t, 'v')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    await type(t, 'i')
    expect(t.captureCharFrame()).toContain('INSERT')
  })

  test('insert mode types normally, arrows included', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'XY')
    await press(t, i => i.pressArrow('down'))
    await type(t, 'Z')
    expect(await save(t, file)).toBe('XYone\ntwZo\nthree\n')
  })

  test('o on the last line opens below it', async () => {
    const { t, file } = await vimEditor('a\nb\n')
    await type(t, 'Go')
    await type(t, 'X')
    expect(await save(t, file)).toBe('a\nb\n\nX')
  })
})

describe('living with the rest of the editor', () => {
  test('Ctrl+D and Ctrl+U move a screenful', async () => {
    const long = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`
    const { t } = await vimEditor(long)
    await press(t, i => i.pressKey('d', { ctrl: true }))
    await settle(t)
    expect(at(t)).toBe('Ln 11, Col 1')
    await press(t, i => i.pressKey('u', { ctrl: true }))
    await settle(t)
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('u undoes a whole insert burst, not one character', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'XYZ')
    await pressEscape(t)
    expect(await save(t, file)).toBe('XYZone\ntwo\nthree\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('one\ntwo\nthree\n')
  })

  test('Ctrl+C, Ctrl+X and Ctrl+V still work in normal mode', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    await press(t, i => i.pressKey('c', { ctrl: true }))
    await pressEscape(t)
    await type(t, '$')
    await type(t, 'i')
    await press(t, i => i.pressKey('v', { ctrl: true }))
    await settle(t)
    expect(await save(t, file)).toBe('abcdeabcf\n')
  })

  test('Esc in normal mode hands the keyboard to the tree', async () => {
    const { t } = await vimEditor()
    await pressEscape(t)
    await type(t, 'd')
    expect(t.captureCharFrame()).toContain('Delete')
  })

  test('switching files starts the new one in normal mode', async () => {
    const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
    const t = await launch(dir, { vim: true })
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressEnter())
    await type(t, 'i')
    expect(t.captureCharFrame()).toContain('INSERT')

    await openFile(t, 'b.ts')
    expect(t.captureCharFrame()).toContain('NORMAL')

    await type(t, 'x')
    expect(t.captureCharFrame()).not.toContain('bbb')
  })

  test('with vim off the same keys type', async () => {
    const dir = fixture({ 'a.ts': 'one\n' })
    const t = await launch(dir, { vim: false })
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressEnter())
    await type(t, 'dd')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('ddone\n')
  })
})

describe('paragraph motions', () => {
  test('} goes to the next blank line', async () => {
    const { t } = await vimEditor('one\ntwo\n\nthree\nfour\n')
    await type(t, '}')
    expect(at(t)).toContain('Ln 3')
  })

  test('{ goes to the previous blank line', async () => {
    const { t } = await vimEditor('one\ntwo\n\nthree\nfour\n')
    await type(t, 'j}')
    expect(at(t)).toContain('Ln 3')
    await type(t, '{')
    expect(at(t)).toContain('Ln 1')
  })

  test('counted paragraph motion: 2}', async () => {
    const { t } = await vimEditor('a\n\nb\n\nc\n')
    await type(t, '2}')
    expect(at(t)).toContain('Ln 4')
  })

  test('} at end of file goes to the trailing blank line', async () => {
    const { t } = await vimEditor('a\nb\n')
    await type(t, 'G}')
    expect(at(t)).toContain('Ln 3')
  })
})

describe('linewise visual mode', () => {
  test('V enters linewise visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'V')
    expect(t.captureCharFrame()).toContain('VISUAL')
  })

  test('Vd deletes the current line', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vd')
    expect(await save(t, file)).toBe('two\nthree\n')
  })

  test('Vjd deletes two lines', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vjd')
    expect(await save(t, file)).toBe('three\n')
  })

  test('Vy yanks linewise and P puts above', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'jVyP')
    expect(await save(t, file)).toBe('one\ntwo\ntwo\nthree\n')
  })

  test('Vc deletes the line and enters insert on the next line', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xtwo\nthree\n')
  })

  test('Esc leaves linewise visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'V')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })
})
