import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape } from './helpers'
import { at, save, type, vimEditor } from './vim-harness'

async function bEdit(content: string) {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir, { vim: true })
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  return { dir, file: join(dir, 'a.ts'), t }
}

describe('text objects', () => {
  const BRACE = 'const x = { hello }\n'
  const PAREN = 'const x = ( hello )\n'
  const BRACKET = 'const x = [ hello ]\n'

  test('di{ deletes the inner block from normal mode', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('ci{ changes inner block and enters insert', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ci{X')
    expect(await save(t, file)).toBe('const x = {X}\n')
  })

  test('yi{ yanks inner block and p pastes after', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'yi{$p')
    expect(await save(t, file)).toBe('const x = { hello } hello \n')
  })

  test('vi{ selects inner block, then d deletes it', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'vi{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('da{ deletes block including braces', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('ca{ deletes around and enters insert', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ca{X')
    expect(await save(t, file)).toBe('const x = X\n')
  })

  test('ya{ yanks around and p pastes', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ya{$p')
    expect(await save(t, file)).toBe('const x = { hello }{ hello }\n')
  })

  test('va{ selects around, then d deletes', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'va{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('di( deletes inner parens', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'di(')
    expect(await save(t, file)).toBe('const x = ()\n')
  })

  test('da( deletes parens including braces', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'da(')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('ci( changes inner parens and enters insert', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'ci(X')
    expect(await save(t, file)).toBe('const x = (X)\n')
  })

  test('di) deletes inner parens (cursor at close paren)', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '018l')
    await type(t, 'di)')
    expect(await save(t, file)).toBe('const x = ()\n')
  })

  test('di[ deletes inner brackets', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'di[')
    expect(await save(t, file)).toBe('const x = []\n')
  })

  test('da[ deletes brackets including braces', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'da[')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('yi[ yanks inner brackets and p pastes', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'yi[$p')
    expect(await save(t, file)).toBe('const x = [ hello ] hello \n')
  })

  test('di{ with cursor on open brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '010l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('di{ with cursor on close brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '018l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('da{ with cursor on open brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '010l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('di{ with cursor before pair is a no-op', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '04l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe(BRACE)
  })

  test('di{ with cursor after pair is a no-op', async () => {
    const { t, file } = await bEdit('before { hello } after\n')
    await type(t, '017l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('before { hello } after\n')
  })

  test('di{ with nested braces deletes the innermost pair', async () => {
    const { t, file } = await bEdit('outer { inner { core } more }\n')
    await type(t, '016l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('outer { inner {} more }\n')
  })

  test('da{ on nested braces deletes only the innermost pair', async () => {
    const { t, file } = await bEdit('outer { inner { core } more }\n')
    await type(t, '016l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('outer { inner  more }\n')
  })

  test('di{ with no braces in file is a no-op', async () => {
    const { t, file } = await vimEditor('hello world\n')
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('hello world\n')
  })

  test('di{ on empty braces is a no-op', async () => {
    const { t, file } = await bEdit('const x = {}\n')
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('da{ on empty braces deletes the braces', async () => {
    const { t, file } = await bEdit('const x = {}\n')
    await type(t, '012l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('diw cancels the prefix: a later { is a paragraph motion again', async () => {
    const { t } = await vimEditor('a { b }\n\nc { d }\ne\n')
    await type(t, 'jj04l')
    await type(t, 'diw')
    await type(t, '{')
    expect(at(t)).toContain('Ln 2')
  })

  test('gi{ is not a text object: g does not take i as a prefix', async () => {
    const { t } = await vimEditor('{ x }\nrest\n')
    await type(t, 'gi{')
    expect(at(t)).toContain('Col 1')
  })

  test('vi{ in visual mode, c changes inner block', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'vi{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'cX')
    expect(await save(t, file)).toBe('const x = {X}\n')
  })

  test('va{ in visual mode, y yanks around (Esc exits visual)', async () => {
    const { t } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'va{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })
})
