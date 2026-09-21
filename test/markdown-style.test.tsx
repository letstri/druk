import { expect, test } from 'bun:test'

import { fixture, launch, openFile, runCommand, until } from './helpers'
import type { Harness } from './helpers'

const DOC = `# Heading One

| Key | Does |
| --- | --- |
| \`F1\` | Command palette |
`

const frame = (t: Harness) => t.captureCharFrame()

// The renderable asks the style table for `markup.heading.1` and `default`; the native table does
// no dotted fallback, so a missing group left headings plain and table prose TextTable's own white.
function colorAt(t: Harness, word: string): string {
  const lines = frame(t).split('\n')
  const row = lines.findIndex((line) => line.includes(word))
  const buffer = t.renderer.currentRenderBuffer
  const at = (row * buffer.width + lines[row]!.indexOf(word)) * 4
  const { fg } = buffer.buffers
  return [0, 1, 2].map((channel) => fg[at + channel]).join(',')
}

test('a rendered heading and table prose take the theme, not the renderable defaults', async () => {
  const t = await launch(
    fixture({ 'doc.md': DOC }),
    {},
    { height: 20, width: 90 }
  )
  await openFile(t, 'doc.md')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('Command palette'))

  // markup.heading, ui.text (not the table's own #ffffff) and markup.raw.
  expect(colorAt(t, 'Heading One')).toBe('121,192,255')
  expect(colorAt(t, 'Command palette')).toBe('230,237,243')
  expect(colorAt(t, 'F1')).toBe('165,214,255')
}, 30_000)
