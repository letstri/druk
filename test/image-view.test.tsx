import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encode } from 'fast-png'

import { fixture, launch, openFile, press, settle, untilFrame } from './helpers'

function project(): { dir: string; png: string } {
  const dir = fixture({ 'main.ts': 'const a = 1\n' })
  const png = join(dir, 'logo.png')
  const pixels: number[] = []
  for (let i = 0; i < 16; i += 1) {
    pixels.push(255, 0, 0, 255, 0, 0, 255, 255)
  }
  writeFileSync(
    png,
    encode({ channels: 4, data: new Uint8Array(pixels), height: 8, width: 4 })
  )
  return { dir, png }
}

describe('image viewer', () => {
  // The core decodes off the thread, so the dimensions and the picture arrive a frame or
  // more after the tab does.
  test('druk logo.png opens the viewer, not a refusal', async () => {
    const { dir, png } = project()
    const t = await launch(
      dir,
      {},
      { height: 24, width: 80 },
      { openFile: png }
    )
    await untilFrame(t, 'logo.png — 4×8 · 1 KB')
    const frame = t.captureCharFrame()
    expect(frame).toMatch(/[▀▄█▌▐]/u)
    expect(frame).not.toContain('binary')
  })

  test('opening an image from the picker shows the viewer and closes like a tab', async () => {
    const { dir } = project()
    const t = await launch(dir, {}, { height: 24, width: 80 })
    await openFile(t, 'logo')
    await untilFrame(t, 'logo.png — 4×8 · 1 KB')

    const frame = t.captureCharFrame()
    expect(frame).toMatch(/[▀▄█▌▐]/u)
    expect(frame).not.toContain('cannot be')

    expect(frame).toContain('image')

    await press(t, (input) => input.pressKey('w', { ctrl: true }))
    expect(t.captureCharFrame()).not.toContain('logo.png — 4×8')
  })

  test('an image tab survives a session restore', async () => {
    const { dir } = project()
    const first = await launch(dir, {}, { height: 24, width: 80 })
    await openFile(first, 'logo')
    await untilFrame(first, 'logo.png — 4×8')

    const second = await launch(dir, {}, { height: 24, width: 80 })
    await untilFrame(second, 'logo.png — 4×8 · 1 KB')
  })

  test('an image tab never becomes a buffer, so nothing can write it back', async () => {
    const { dir, png } = project()
    const t = await launch(dir, {}, { height: 24, width: 80 })
    await openFile(t, 'logo')
    await untilFrame(t, 'logo.png — 4×8')

    const before = [...(await Bun.file(png).bytes())]
    await press(t, (input) => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect([...(await Bun.file(png).bytes())]).toEqual(before)
    expect(t.captureCharFrame()).not.toContain('Saved logo.png')
  })
})
