import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

export async function vimEditor(content = 'one\ntwo\nthree\n') {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir, { vim: true })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return { t, dir, file: join(dir, 'a.ts') }
}

export const type = (t: Harness, text: string) => press(t, i => void i.typeText(text))

export async function save(t: Harness, file: string) {
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)
  return readFileSync(file, 'utf8')
}

export const at = (t: Harness) => /Ln (\d+), Col (\d+)/.exec(t.captureCharFrame())?.[0] ?? '?'
