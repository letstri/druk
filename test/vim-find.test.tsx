import { describe, expect, test } from 'bun:test'

import { at, save, type, vimEditor } from './vim-harness'

/** Offsets: `(` is 12, the comma 16, `)` 21; the o's are 1, 13 and 20. */
const LINE = 'const a = fn(one, two);\nsecond line\n'

describe('vim character search', () => {
  test('f lands on the character, t stops against it', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, 'f(')
    expect(at(t)).toBe('Ln 1, Col 13')

    await type(t, '0t)')
    expect(at(t)).toBe('Ln 1, Col 21')
  })

  test('a count picks the nth one', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, '2fo')
    expect(at(t)).toBe('Ln 1, Col 14')
  })

  test('F and T search back the other way', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, '$F(')
    expect(at(t)).toBe('Ln 1, Col 13')

    await type(t, '$T(')
    expect(at(t)).toBe('Ln 1, Col 14')
  })

  test('the search stays on its own line', async () => {
    const { t } = await vimEditor(LINE)
    // The only `d` in the file is on line two — vim's search would not reach it.
    await type(t, 'fd')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('a character the line does not hold leaves the cursor alone', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, 'fz')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('; walks on and , turns back', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, 'fo')
    expect(at(t)).toBe('Ln 1, Col 2')
    await type(t, ';')
    expect(at(t)).toBe('Ln 1, Col 14')
    await type(t, ';')
    expect(at(t)).toBe('Ln 1, Col 21')
    await type(t, ',')
    expect(at(t)).toBe('Ln 1, Col 14')
  })

  test('; after t steps over the character it is resting against', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, 'to')
    expect(at(t)).toBe('Ln 1, Col 1')
    // Without the skip this would find the same `o` for ever.
    await type(t, ';')
    expect(at(t)).toBe('Ln 1, Col 13')
  })

  test('; with nothing searched for yet does nothing', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, ';')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('df takes the character, dt stops before it', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'df,')
    expect(await save(t, file)).toBe(' two);\nsecond line\n')
  })

  test('dt leaves the character it stopped against', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'dt,')
    expect(await save(t, file)).toBe(', two);\nsecond line\n')
  })

  test('dF deletes back to it, keeping the character under the cursor', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, '$dF(')
    expect(await save(t, file)).toBe('const a = fn;\nsecond line\n')
  })

  test('a search that finds nothing deletes nothing', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'dfz')
    expect(await save(t, file)).toBe(LINE)
  })

  test('c through a search opens insert mode where the text was', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'cf(')
    expect(t.captureCharFrame()).toContain('INSERT')
    await type(t, 'let b = g')
    expect(await save(t, file)).toBe('let b = gone, two);\nsecond line\n')
  })

  test('a count reaches the operator through the search', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'd2fo')
    expect(await save(t, file)).toBe('ne, two);\nsecond line\n')
  })

  test('the searched-for character is never read as a command or a count', async () => {
    const { t, file } = await vimEditor('a1a2a3\n')
    // `f1` is a search for a 1, not a count of one; `d` after `f` is the target.
    await type(t, 'f1')
    expect(at(t)).toBe('Ln 1, Col 2')
    await type(t, 'x')
    expect(await save(t, file)).toBe('aa2a3\n')
  })

  test('the search extends a visual selection', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'vf,d')
    expect(await save(t, file)).toBe(' two);\nsecond line\n')
  })

  test('y through a search leaves the cursor where the yank began', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'wyf,')
    expect(at(t)).toBe('Ln 1, Col 7')
    await type(t, '$p')
    expect(await save(t, file)).toBe('const a = fn(one, two);a = fn(one,\nsecond line\n')
  })

  test('dT deletes back to the character, keeping it', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, '$dT(')
    expect(await save(t, file)).toBe('const a = fn(;\nsecond line\n')
  })

  test('a count reaches the repeat', async () => {
    const { t } = await vimEditor(LINE)
    await type(t, 'fo2;')
    expect(at(t)).toBe('Ln 1, Col 21')
  })

  test('the repeat extends a visual selection', async () => {
    const { t, file } = await vimEditor(LINE)
    await type(t, 'vfo;d')
    expect(await save(t, file)).toBe('ne, two);\nsecond line\n')
  })

  test('t against the character beside the caret is a motion that failed', async () => {
    const { t, file } = await vimEditor('a,b\n')
    // Vim moves nowhere here, and a motion that did not move takes its operator
    // with it — the caret's own character is not the operator's to eat.
    await type(t, 'dt,')
    expect(await save(t, file)).toBe('a,b\n')
  })

  test('the character searched for is the one the layout printed', async () => {
    // With a Cyrillic layout up, `ф` sits on the `a` key: a search reading the
    // key's place rather than its character would land on the `a` at col 5.
    const { t } = await vimEditor('let a = ф\n')
    await type(t, 'fф')
    expect(at(t)).toBe('Ln 1, Col 9')
  })
})
