import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { fixture, launch, openFile, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' }

async function open(t: Harness, name: string) {
  await openFile(t, name)
}

async function watcherSettles(t: Harness) {
  await sleep(300)
  await settle(t)
}

describe('a file deleted outside the editor', () => {
  test('loses its tab', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'a.ts')
    await open(t, 'b.ts')
    expect(t.captureCharFrame().split('\n')[0]).toContain('a.ts')

    rmSync(join(dir, 'a.ts'))
    await watcherSettles(t)

    const bar = t.captureCharFrame().split('\n')[0]!
    expect(bar).not.toContain('a.ts')
    expect(bar).toContain('b.ts')
  })

  test('the last tab closing leaves the empty state, not a ghost buffer', async () => {
    const dir = fixture({ 'only.ts': 'const only = 1\n' })
    const t = await launch(dir)
    await open(t, 'only.ts')
    expect(t.captureCharFrame()).toContain('const only = 1')

    rmSync(join(dir, 'only.ts'))
    await watcherSettles(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('no open files')
    expect(frame).not.toContain('const only = 1')
  })

  test('keeps the tab when there are unsaved edits to recreate it from', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'a.ts')
    await press(t, (input) => input.typeText('EDIT'))

    rmSync(join(dir, 'a.ts'))
    await watcherSettles(t)

    const frame = t.captureCharFrame()
    expect(frame.split('\n')[0]).toContain('a.ts')
    expect(frame).toContain('EDITconst a = 1')

    await press(t, (input) => input.pressKey('s', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('was deleted on disk')
  })

  test('the warning says deleted, not changed — there is no diff to go looking for', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'a.ts')
    await press(t, (input) => input.typeText('EDIT'))

    rmSync(join(dir, 'a.ts'))
    await watcherSettles(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('Deleted on disk with unsaved edits')
    expect(frame).not.toContain('Changed on disk with unsaved edits')
  })
})
