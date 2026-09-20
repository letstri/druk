import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, runCommand } from './helpers'

// The Opt modifier is an ESC prefix ahead of the Ctrl byte.
const ctrlOpt = (letter: string) =>
  `${String.fromCharCode(27)}${String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)}`

describe('copying a file path', () => {
  test('copies the tree selection while the tree has the keyboard', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
    const t = await launch(dir)
    await press(t, input => input.pressArrow('down'))

    await runCommand(t, 'Copy relative path')

    const frame = t.captureCharFrame()
    expect(frame).toContain('Copied a.ts')
    expect(frame).not.toContain('press p')
  })

  test('copies the open file once the editor has the keyboard', async () => {
    const dir = fixture({ 'src/deep/a.ts': 'const a = 1\n' })
    const t = await launch(dir)
    await openFile(t, 'a.ts')

    await runCommand(t, 'Copy relative path')

    expect(t.captureCharFrame()).toContain('Copied src/deep/a.ts')
  })

  test('copies the absolute path, root and all', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir, {}, { width: 200 })
    await press(t, input => input.pressArrow('down'))

    await runCommand(t, 'Copy path')

    expect(t.captureCharFrame()).toContain(`Copied ${dir}/a.ts`)
  })

  test('the chord copies rather than quitting, from the tree and the editor alike', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir, {}, { width: 200 })
    await press(t, input => input.pressArrow('down'))

    // Ctrl+Opt+C carries the Ctrl+C byte, and the quit guard runs ahead of the keymap.
    await press(t, input => void input.pressKeys([ctrlOpt('c')]))
    expect(t.captureCharFrame()).toContain(`Copied ${dir}/a.ts`)

    await openFile(t, 'a.ts')
    await press(t, input => void input.pressKeys([ctrlOpt('c')]))
    expect(t.captureCharFrame()).toContain(`Copied ${dir}/a.ts`)
  })

  test('falls back to the absolute path for a file the project does not hold', async () => {
    const outside = fixture({ 'far.ts': 'export const far = 1\n' })
    const t = await launch(
      fixture({ 'a.ts': 'const a = 1\n' }),
      {},
      { width: 200 },
      {
        openFile: `${outside}/far.ts`,
      },
    )

    await runCommand(t, 'Copy relative path')

    const frame = t.captureCharFrame()
    expect(frame).toContain(`Copied ${outside}/far.ts`)
    expect(frame).toContain('outside the project')
  })

  test('keeps a dotted name inside the project rather than reading it as an escape', async () => {
    const dir = fixture({ '..rc': 'x = 1\n' })
    const t = await launch(dir, {}, { width: 200 })
    await press(t, input => input.pressArrow('down'))

    await runCommand(t, 'Copy relative path')

    const frame = t.captureCharFrame()
    expect(frame).toContain('Copied ..rc')
    expect(frame).not.toContain('outside the project')
  })

  test('says so rather than copying nothing when no file is in hand', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir)

    await runCommand(t, 'Copy path')

    expect(t.captureCharFrame()).toContain('No file to copy the path of')
  })
})
