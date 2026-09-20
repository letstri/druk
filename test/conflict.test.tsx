import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

async function clash(outside: string | null = 'theirs from outside\n') {
  const dir = fixture({ 'a.ts': 'mine\n' })
  const file = join(dir, 'a.ts')
  const t = await launch(dir)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  await press(t, input => void input.typeText('EDIT'))

  if (outside === null) rmSync(file)
  else writeFileSync(file, outside)
  await new Promise(resolve => setTimeout(resolve, 300))
  await settle(t)

  return { t, dir, file }
}

const save = (t: Harness) => press(t, input => input.pressKey('s', { ctrl: true }))
const choose = async (t: Harness, steps: number) => {
  for (let step = 0; step < steps; step++) await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
}

describe('saving a file that changed underneath', () => {
  test('asks instead of clobbering', async () => {
    const { t, file } = await clash()
    await save(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('changed on disk')
    expect(frame).toContain('Overwrite')
    expect(frame).toContain('Reload')
    expect(readFileSync(file, 'utf8')).toBe('theirs from outside\n')
  })

  test('the warning goes away once the files agree again', async () => {
    const { t, file } = await clash()
    expect(t.captureCharFrame()).toContain('unsaved edits')

    writeFileSync(file, 'EDITmine\n')
    await new Promise(resolve => setTimeout(resolve, 300))
    await settle(t)

    expect(t.captureCharFrame()).not.toContain('unsaved edits')
  })

  test('Overwrite writes my version and clears the warning', async () => {
    const { t, file } = await clash()
    await save(t)
    await choose(t, 0)
    await new Promise(resolve => setTimeout(resolve, 300))
    await settle(t)

    expect(readFileSync(file, 'utf8')).toBe('EDITmine\n')
    expect(t.captureCharFrame()).not.toContain('unsaved edits')
  })

  test('Reload takes the outside version and drops mine', async () => {
    const { t, file } = await clash()
    await save(t)
    await choose(t, 1)

    expect(t.captureCharFrame()).toContain('theirs from outside')
    expect(t.captureCharFrame()).not.toContain('EDITmine')
    expect(readFileSync(file, 'utf8')).toBe('theirs from outside\n')
  })

  test('Cancel writes nothing and keeps my edits', async () => {
    const { t, file } = await clash()
    await save(t)
    await choose(t, 2)

    expect(readFileSync(file, 'utf8')).toBe('theirs from outside\n')
    expect(t.captureCharFrame()).toContain('EDITmine')
  })
})

describe('saving a file that was deleted underneath', () => {
  test('offers to recreate it and never offers to reload nothing', async () => {
    const { t } = await clash(null)
    await save(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('was deleted on disk')
    expect(frame).toContain('recreate the file')
    expect(frame).not.toContain('discard my changes')
  })

  test('recreating writes the buffer back to disk', async () => {
    const { t, file } = await clash(null)
    await save(t)
    await choose(t, 0)

    expect(readFileSync(file, 'utf8')).toBe('EDITmine\n')
  })
})

describe('how the warning is coloured', () => {
  test('a clash is amber, not the red kept for failures', async () => {
    const { t } = await clash()

    const spans = t.captureSpans() as unknown as {
      lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
    }
    const message = spans.lines.at(-1)!.spans.find(span => span.text.includes('unsaved edits'))
    const hex = (fg?: { buffer: Uint8Array }) =>
      fg
        ? `#${Array.from(fg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
        : ''

    expect(message).toBeDefined()
    expect(hex(message!.fg)).toBe(ui.dirty.toLowerCase())
    expect(hex(message!.fg)).not.toBe(ui.error.toLowerCase())
  })
})
