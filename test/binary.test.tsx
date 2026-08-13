import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, openFile, press, settle } from './helpers'
import { tempDir } from './temp'

/** A project with a real binary file next to a text one. */
function project() {
  const dir = tempDir()
  writeFileSync(join(dir, '.DS_Store'), Buffer.from([0, 1, 2, 0, 3, 4]))
  writeFileSync(join(dir, 'main.ts'), 'const a = 1\n')
  return dir
}

test('a binary file is listed but does not open', async () => {
  const t = await launch(project())
  expect(t.captureCharFrame()).toContain('.DS_Store')

  await press(t, i => i.pressArrow('down')) // .DS_Store sorts first
  await press(t, i => i.pressEnter())
  await settle(t)

  const frame = t.captureCharFrame()
  // Over the pane, where the file would have appeared — not a footnote in the bar.
  expect(frame).toContain('.DS_Store cannot be shown')
  expect(frame).toContain('binary')
  // Still no tab and no buffer: the refusal is drawn, not opened.
  expect(frame.split('\n')[0]).not.toContain('.DS_Store')
})

test('the refusal covers the file that was open, and leaves when a key is pressed', async () => {
  const t = await launch(project())
  await openFile(t, 'main.ts')
  expect(t.captureCharFrame()).toContain('const a = 1')

  await openFile(t, '.DS_Store')

  // The point of drawing it here: the open file is not still sitting there looking
  // like the thing that was asked for.
  expect(t.captureCharFrame()).not.toContain('const a = 1')
  expect(t.captureCharFrame()).toContain('cannot be shown')

  await press(t, i => i.pressArrow('down'))
  await settle(t)
  expect(t.captureCharFrame()).toContain('const a = 1')
  expect(t.captureCharFrame()).not.toContain('cannot be shown')
})

test('it can never be written back to disk, because it is never a buffer', async () => {
  const dir = project()
  const before = readFileSync(join(dir, '.DS_Store'))
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  // Typing goes nowhere in particular: there is nothing open to type into.
  await press(t, i => void i.typeText('xxx'))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)

  expect(readFileSync(join(dir, '.DS_Store'))).toEqual(before)
})

test('a stray NUL past the header does not make a source file binary', async () => {
  const dir = project()
  // A sentinel in a string literal, the way `src/core/mermaid/graph.ts` carried
  // one: git calls this binary, every editor opens it, and so must druk.
  const source = `${'// pad\n'.repeat(80)}const id = '\0dummy'\nconst tail = 2\n`
  writeFileSync(join(dir, 'stray.ts'), source)

  // Tall enough for the NUL's own line to be on screen: it sits past the 512-byte
  // header window, which is 74 lines of padding down.
  const t = await launch(dir, {}, { height: 100 })
  await openFile(t, 'stray.ts')

  expect(t.captureCharFrame()).not.toContain('cannot be shown')
  // The text *after* the NUL is the assertion: a C-string truncation anywhere in
  // the read/parse path would drop it and a save would then write the loss out.
  expect(t.captureCharFrame()).toContain('const tail = 2')

  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)
  expect(readFileSync(join(dir, 'stray.ts'), 'utf8')).toBe(source)
})

test('NULs dense enough to be data are still refused, header or no header', async () => {
  const dir = project()
  // A text-looking header over compressed-ish bytes: nothing in the first 512,
  // then every 50th byte a NUL — 2%, well past what a sentinel reaches.
  const body = Buffer.alloc(4096, 0x41)
  for (let i = 600; i < body.length; i += 50) body[i] = 0
  writeFileSync(join(dir, 'dense.bin'), Buffer.concat([Buffer.from('#!/text\n'), body]))

  const t = await launch(dir)
  await openFile(t, 'dense.bin')
  expect(t.captureCharFrame()).toContain('cannot be shown')
})

test('text files still open normally afterwards', async () => {
  const t = await launch(project())
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await settle(t)

  const frame = t.captureCharFrame()
  // The refusal went away with the next key, so the file is visible again.
  expect(frame).toContain('const a = 1')
  expect(frame).not.toContain('cannot be shown')
  expect(frame.split('\n')[0]).toContain('main.ts')
  expect(frame.split('\n')[0]).not.toContain('.DS_Store')
})
