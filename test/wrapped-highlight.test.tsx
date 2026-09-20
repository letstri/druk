import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, until } from './helpers'
import type { Harness } from './helpers'

// `scrollY` counts visual rows; highlights are addressed by logical line.
const LOCKFILE = `{
  "lockfileVersion": 1,
  "packages": {
${Array.from(
  { length: 800 },
  (_, index) =>
    `    "@scope/pkg-${index}": ["@scope/pkg-${index}@1.0.0", "", { "dependencies": { "a": "^1.0.0" } }, "sha512-${'x'.repeat(90)}=="],`,
).join('\n')}
  }
}
`

function colors(t: Harness) {
  const frame = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
  }
  const seen = new Set<string>()
  for (const line of frame.lines.slice(1, 22)) {
    for (const span of line.spans) {
      if (!span.text.trim() || !span.fg) continue
      seen.add(Array.from(span.fg.buffer.slice(0, 3)).join(','))
    }
  }
  return seen
}

const painted = (t: Harness) => until(t, () => colors(t).size > 2)

async function openLock() {
  const t = await launch(fixture({ 'bun.lock': LOCKFILE }), {}, { width: 100, height: 24 })
  await openFile(t, 'bun.lock')
  await painted(t)
  return t
}

const gotoLine = async (t: Harness, line: number) => {
  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText(String(line)))
  await press(t, input => input.pressEnter())
  await painted(t)
}

describe('highlighting a file whose lines wrap', () => {
  test('is still painted hundreds of lines in', async () => {
    const t = await openLock()
    const atTop = colors(t).size
    expect(atTop).toBeGreaterThan(2)

    await gotoLine(t, 400)
    expect(colors(t).size).toBeGreaterThan(2)
  }, 60000)

  test('and at the very end of the file', async () => {
    const t = await openLock()
    await gotoLine(t, 795)

    expect(colors(t).size).toBeGreaterThan(2)
  }, 60000)
})
