import { expect, test } from 'bun:test'

import { invalidateSyntaxStyle, segmentsIn } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { fixture, launch, press, pressTimes } from './helpers'
import { parseHighlights, WHOLE } from './syntax'

const BIG = `settings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n${Array.from(
  { length: 1500 },
  (_, i) =>
    `  /package-${i}@1.0.${i}:\n    resolution: {integrity: sha512-${'abcdef0123456789'.repeat(2)}${i}}\n    engines: {node: '>=18'}\n    dev: false`,
).join('\n')}\n`

const rgb = (hex: string) =>
  [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16)).join(',')

const SMALL = `settings:\n  /package-0@1.0.0:\n    engines: {node: '>=18'}\n    dev: false\n`

async function timeOpen(body: string) {
  const t = await launch(fixture({ 'lock.yaml': body }))
  const started = performance.now()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return { elapsed: performance.now() - started, frame: t.captureCharFrame() }
}

// A ratio, not a duration: a wall-clock budget has to hold on the slowest machine.
test('opening a large file costs about what opening a small one costs', async () => {
  const ratios: number[] = []
  let frame = ''
  for (let n = 0; n < 3; n++) {
    const small = await timeOpen(SMALL)
    const big = await timeOpen(BIG)
    frame = big.frame
    ratios.push(big.elapsed / small.elapsed)
  }
  const median = ratios.toSorted((a, b) => a - b)[1]!

  expect(frame).toContain('settings:')
  expect(`${median.toFixed(1)}x the small file, under 5x: ${median < 5}`).toBe(
    `${median.toFixed(1)}x the small file, under 5x: true`,
  )
}, 30000)

test('scrolling deep into a large file keeps highlights', async () => {
  // The theme is module state shared across the file's tests.
  setTheme('dark')
  invalidateSyntaxStyle()

  const t = await launch(fixture({ 'lock.yaml': BIG }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await pressTimes(t, 300, i => i.pressArrow('down'))

  const spans = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Record<string, number> } }[] }[]
  }
  const foreground = new Set<string>()
  for (const line of spans.lines) {
    for (const span of line.spans) {
      if (span.fg && span.text.trim()) {
        const b = span.fg.buffer
        foreground.add(`${b['0']},${b['1']},${b['2']}`)
      }
    }
  }
  expect(foreground).toContain(rgb((THEMES.dark.syntax.property as { fg: string }).fg))
}, 20000)

test('segmenting one line costs a fraction of segmenting the whole file', async () => {
  const source = `${Array.from(
    { length: 8000 },
    (_, i) => `export function fn${i}(a: number, b: string): string { return \`x-${i}\` }`,
  ).join('\n')}\n`

  const parsed = await parseHighlights(source, 'typescript')
  const time = (runs: number, fn: () => void) => {
    fn()
    const started = performance.now()
    for (let n = 0; n < runs; n++) fn()
    return (performance.now() - started) / runs
  }

  const whole = time(5, () => void segmentsIn(parsed, 0, WHOLE))
  let line = 4000
  const one = time(50, () => void segmentsIn(parsed, line, line++))

  expect(`${whole.toFixed(2)}ms whole vs ${one.toFixed(3)}ms per line: ${whole / one > 20}`).toBe(
    `${whole.toFixed(2)}ms whole vs ${one.toFixed(3)}ms per line: true`,
  )
}, 30000)
