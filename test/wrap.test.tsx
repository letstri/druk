import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, runCommand, settle } from './helpers'

const TAIL = 'TAIL_MARKER'
const PROJECT = { 'a.ts': `const line = "${'x'.repeat(80)}" // ${TAIL}\n` }

const SIZE = { height: 20, width: 60 }

const savedWrap = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).wrap

test('long lines wrap by default, as they always have', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, SIZE, { openFile: join(dir, 'a.ts') })

  expect(t.captureCharFrame()).toContain(TAIL)
})

test('wrap: false keeps one buffer line per row, tail past the edge', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, { wrap: false }, SIZE, {
    openFile: join(dir, 'a.ts'),
  })

  expect(t.captureCharFrame()).not.toContain(TAIL)
})

test('the palette command toggles wrap live, and it persists', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, SIZE, { openFile: join(dir, 'a.ts') })
  expect(t.captureCharFrame()).toContain(TAIL)

  await runCommand(t, 'Toggle word wrap')
  await settle(t)
  expect(t.captureCharFrame()).not.toContain(TAIL)
  expect(savedWrap()).toBe(false)

  await runCommand(t, 'Toggle word wrap')
  await settle(t)
  expect(t.captureCharFrame()).toContain(TAIL)
  expect(savedWrap()).toBe(true)
})
