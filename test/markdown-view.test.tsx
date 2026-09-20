import { expect, test } from 'bun:test'

import { fixture, launch, openFile, pressEscape, runCommand, settle, until } from './helpers'
import type { Harness } from './helpers'

const DOC = `# Title

Some **bold** prose.

- first item
- second item

\`\`\`ts
const a = 1
\`\`\`
`

const frame = (t: Harness) => t.captureCharFrame()

async function render(t: Harness) {
  await openFile(t, 'doc.md')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('Title'))
}

test('a markdown tab renders its document, and switches back to the source', async () => {
  const t = await launch(fixture({ 'doc.md': DOC }))
  await render(t)

  const shown = frame(t)
  expect(shown).toContain('Title')
  expect(shown).not.toContain('# Title')
  expect(shown).toContain('bold')
  expect(shown).toContain('first item')
  expect(shown).toContain('const a = 1')
  expect(shown).toContain('¶ doc.md')

  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('# Title'))
  expect(frame(t)).not.toContain('¶ doc.md')
})

test('Esc on the rendered page goes back to the text', async () => {
  const t = await launch(fixture({ 'doc.md': DOC }))
  await render(t)

  await pressEscape(t)
  await until(t, () => frame(t).includes('# Title'))
})

test('the rendered view shows unsaved edits, not the file on disk', async () => {
  const t = await launch(fixture({ 'doc.md': '# Saved\n' }))
  await openFile(t, 'doc.md')
  const { mockInput } = t
  mockInput.typeText('# Typed\n')
  await settle(t)

  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('Typed'))
})

test('the tab strip carries the rendered view as a button, on markdown tabs only', async () => {
  const t = await launch(fixture({ 'doc.md': DOC, 'a.ts': 'const a = 1\n' }))
  await openFile(t, 'doc.md')
  await until(t, () => frame(t).includes('¶ preview'))

  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('¶ source'))

  await openFile(t, 'a.ts')
  await until(t, () => frame(t).includes('const a = 1'))
  expect(frame(t)).not.toContain('¶ preview')
  expect(frame(t)).not.toContain('¶ source')
})

test('a file that is not markdown says so instead of rendering', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openFile(t, 'a.ts')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('Not a markdown file'))
  expect(frame(t)).toContain('const a = 1')
})

test('markdownPreview opens a markdown file rendered, and the toggle still reaches the source', async () => {
  const t = await launch(fixture({ 'doc.md': DOC, 'a.ts': 'const a = 1\n' }), {
    markdownPreview: true,
  })
  await openFile(t, 'doc.md')
  await until(t, () => frame(t).includes('Title'))
  expect(frame(t)).not.toContain('# Title')

  await runCommand(t, 'Markdown: rendered')
  await until(t, () => frame(t).includes('# Title'))

  await openFile(t, 'a.ts')
  await until(t, () => frame(t).includes('const a = 1'))
})
