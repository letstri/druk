import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'

const FILE = { 'a.ts': 'const alpha = 1\nconst beta = 2\n' }

async function openedFile(dir: string) {
  const t = await launch(dir)
  await openFile(t, 'a.ts')
  return t
}

const selectedText = (t: Harness) =>
  (
    t as unknown as {
      renderer: { getSelection: () => { getSelectedText: () => string } | null }
    }
  ).renderer
    .getSelection()
    ?.getSelectedText() ?? null

async function exitsDuring(run: () => Promise<void>) {
  let exited = 0
  const realExit = process.exit
  // @ts-expect-error — swapped only for the duration of the call
  process.exit = () => {
    exited += 1
  }
  try {
    await run()
  } finally {
    process.exit = realExit
  }
  return exited
}

describe('Ctrl+C', () => {
  // The quit-for-real case destroys the renderer the harness shares, so it runs last.

  test('asks first when a buffer is unsaved, rather than dropping the work', async () => {
    const t = await openedFile(fixture(FILE))
    await press(t, (input) => input.typeText('EDIT'))
    expect(t.captureCharFrame()).toContain('EDITconst alpha = 1')

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(0)
    const frame = t.captureCharFrame()
    expect(frame).toContain('Unsaved changes')
    expect(frame).toContain('a.ts')
  })

  test('copies instead of quitting while text is selected', async () => {
    const t = await openedFile(fixture(FILE))
    await t.mockMouse.drag(35, 2, 45, 2)
    await settle(t)
    expect(selectedText(t)).toBeTruthy()

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('const alpha = 1')
  })

  test('still quits with a page over the editor', async () => {
    const t = await openedFile(fixture(FILE))
    await press(t, (input) => input.typeText('EDIT'))
    await runCommand(t, 'Settings')

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('Unsaved changes')
  })

  test('still quits with a file rendered instead of edited', async () => {
    const t = await launch(fixture({ 'a.md': '# Title\n' }))
    await openFile(t, 'a.md')
    await press(t, (input) => input.typeText('EDIT'))
    await runCommand(t, 'Markdown: rendered / source')

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('Unsaved changes')
  })

  test('quits when nothing is selected', async () => {
    const t = await openedFile(fixture(FILE))
    expect(selectedText(t)).toBeNull()

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(1)
  })

  test('quits from the welcome screen', async () => {
    const t = await launch(fixture(FILE))
    await runCommand(t, 'Toggle sidebar')
    await settle(t)

    const exited = await exitsDuring(() =>
      press(t, (input) => input.pressKey('c', { ctrl: true }))
    )

    expect(exited).toBe(1)
  })
})
