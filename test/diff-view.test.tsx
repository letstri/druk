import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HATCH } from '../src/ui/DiffView'
import {
  launch,
  openDiff,
  openPalette,
  press,
  pressEscape,
  runCommand,
  until,
  untilFrame,
  untilGone,
} from './helpers'

interface Span {
  text: string
  fg: unknown
}

/** A real repository with committed files. */
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-diff-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('the diff shows deletions, additions and both line numbers', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\n')

  const t = await launch(dir)
  await openDiff(t)
  // The renderable assembles its panes on a queued microtask and renders async;
  // under a loaded parallel suite a single flush is not always enough.
  await untilFrame(t, '+ four')

  const frame = t.captureCharFrame()
  expect(frame).toContain('a.ts')
  expect(frame).toContain('+2 −1')
  expect(frame).toContain('- TWO'.replace('TWO', 'two'))
  expect(frame).toContain('+ TWO')
  expect(frame).toContain('+ four')
  expect(frame).toContain('inline')
})

test('"Diff current file" opens the panel on that file, cursor and all', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  // Open b.ts — the second row, so a cursor left at the top would show a.ts.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')

  let frame = t.captureCharFrame()
  expect(frame).toContain('◆ review')
  expect(frame).toContain('+ BETA')

  // The cursor landed on b.ts's row, so the arrows page on from there.
  await press(t, i => i.pressArrow('up'))
  frame = t.captureCharFrame()
  expect(frame).toContain('+ ALPHA')
})

test('"Diff current file" on an unchanged file says so instead of opening', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // a.ts, still clean
  await runCommand(t, 'Diff current file')

  const frame = t.captureCharFrame()
  expect(frame).toContain('No changes in a.ts')
  expect(frame).not.toContain('Esc close')
})

test('there is no "diff all" command — the panel is the only pager', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await openPalette(t)
  await press(t, i => void i.typeText('diff'))
  expect(t.captureCharFrame()).not.toContain('Diff all changes')
})

test('Tab into the diff, then Tab switches to side-by-side and back', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n')

  const t = await launch(dir)
  await openDiff(t)
  // The first Tab leaves the panel — the page only owns the keyboard once it
  // has the focus, which is what keeps the arrows paging the changes.
  await press(t, i => i.pressTab())
  await press(t, i => i.pressTab())

  const frame = t.captureCharFrame()
  expect(frame).toContain('side-by-side')
  // The two panes carry the same changed line, one side each.
  expect(frame).toContain('- two')
  expect(frame).toContain('+ TWO')

  await press(t, i => i.pressTab())
  expect(t.captureCharFrame()).not.toContain('side-by-side')
})

test('an added file stays inline in split view — there is no side to compare', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'b.ts'), 'one\ntwo\n')

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ two')

  const frame = t.captureCharFrame()
  expect(frame).toContain('inline')
  expect(frame).not.toContain('side-by-side')
  // Nothing to toggle, so Tab is dead here rather than flipping the setting.
  expect(frame).not.toContain('Tab layout')

  await press(t, i => i.pressTab())
  await press(t, i => i.pressTab())
  expect(t.captureCharFrame()).not.toContain('side-by-side')
})

test('split view hatches the rows it pads a side with', async () => {
  // One line becomes three: the left pane is padded with two rows the patch has
  // nothing for, and those are what must not read as blank editor.
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\nfive\n')

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ five')

  const run = HATCH.repeat(8)
  await until(t, () => t.captureCharFrame().includes(run))
  const hatched = t
    .captureCharFrame()
    .split('\n')
    .filter(line => line.includes(run))
  expect(hatched.length).toBeGreaterThanOrEqual(2)
})

test('the panel cursor pages the diff: ↓ to the next change, ↑ back', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await openDiff(t)
  expect(t.captureCharFrame()).toContain('+ ALPHA')

  await press(t, i => i.pressArrow('down'))
  let frame = t.captureCharFrame()
  expect(frame).toContain('b.ts')
  expect(frame).toContain('+ BETA')
  expect(frame).not.toContain('+ ALPHA')

  await press(t, i => i.pressArrow('up'))
  frame = t.captureCharFrame()
  expect(frame).toContain('+ ALPHA')
  expect(frame).not.toContain('+ BETA')
})

test('Esc in the diff hands the focus back to the panel, which pages on', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  // Wide enough for the page's long hint spelling, which is what names the key.
  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await press(t, i => i.pressTab()) // into the page: the arrows scroll here now
  expect(t.captureCharFrame()).toContain('Esc panel')

  await pressEscape(t)
  // The page stayed up, and the panel has the keyboard again.
  expect(t.captureCharFrame()).toContain('+ ALPHA')
  await press(t, i => i.pressArrow('down'))
  expect(t.captureCharFrame()).toContain('+ BETA')

  // Esc from the panel is still what closes the page.
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('+ BETA')
})

test('with the sidebar hidden, Esc closes the diff — there is no panel to go back to', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await press(t, i => i.pressKey('b', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Esc close')

  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('+ ALPHA')
})

test('an untracked file diffs as all additions', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'new.ts'), 'fresh\nlines\n')

  const t = await launch(dir)
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('new.ts')
  expect(frame).toContain('+ fresh')
  expect(frame).toContain('+ lines')
})

test('long unchanged stretches stay out of the hunks', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  const changed = [...lines]
  changed[0] = 'CHANGED'
  writeFileSync(join(dir, 'a.ts'), `${changed.join('\n')}\n`)

  const t = await launch(dir, {}, { height: 30 })
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('CHANGED')
  expect(frame).toContain('line2') // context under the change
  expect(frame).not.toContain('line10') // deep in the unchanged middle — not shown
})

test('the mouse wheel scrolls the diff', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  // Touch every line so nothing collapses and the diff is taller than the screen.
  writeFileSync(join(dir, 'a.ts'), `${lines.map(l => `${l}!`).join('\n')}\n`)

  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, '- line0')

  await t.mockMouse.scroll(60, 10, 'down')
  await untilGone(t, '- line0')

  await t.mockMouse.scroll(60, 10, 'up')
  await untilFrame(t, '- line0')
})

test('PageDown and Ctrl+D both page the diff, Ctrl+U comes back', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  writeFileSync(join(dir, 'a.ts'), `${lines.map(l => `${l}!`).join('\n')}\n`)

  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, '- line0')
  await press(t, i => i.pressTab()) // into the page: its keys stay dead unfocused

  await press(t, i => void i.pressKeys(['\u001B[6~']))
  await untilGone(t, '- line0')

  await press(t, i => i.pressKey('u', { ctrl: true }))
  await untilFrame(t, '- line0')

  // Ctrl+D is the page key MacBook keyboards can actually send.
  await press(t, i => i.pressKey('d', { ctrl: true }))
  await untilGone(t, '- line0')
})

test('the diff is a page: sidebar, tabs and status bar all stay around it', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // the file, so the tab row has one
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('+1 −1') // the diff itself
  expect(frame).toContain('◆ review') // the panel does not make way
  const lines = frame.split('\n')
  expect(lines[0]).toContain('a.ts') // tab row still up top
  expect(lines.at(-2)).toContain('⎇ main') // status bar still below
})

test('the palette opens over the diff, and Ctrl+W closes the page', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await openDiff(t)

  // Not a modal: global chords still work on top of the page.
  await openPalette(t)
  expect(t.captureCharFrame()).toContain('Commands')
  await pressEscape(t)
  expect(t.captureCharFrame()).toContain('+1 −1') // still on the page

  await press(t, i => i.pressKey('w', { ctrl: true }))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('+1 −1') // page closed…
  expect(frame).toContain('ONE') // …back to the file, tab intact
  expect(frame.split('\n')[0]).toContain('a.ts')
})

test('a long path is cut from the left so the hints stay on screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'druk-diff-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  const deep = 'a-very/deeply/nested/folder/structure/with-a-quite-long-file-name.test.tsx'
  mkdirSync(join(dir, deep, '..'), { recursive: true })
  writeFileSync(join(dir, deep), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, deep), 'ONE\n')

  const t = await launch(dir)
  await openDiff(t)

  const headerRow = t.captureCharFrame().split('\n')[1]!
  expect(headerRow).toContain('Esc') // hints survived
  expect(headerRow).toContain('…') // the path gave way instead
  expect(headerRow).toContain('name.test.tsx') // and kept its tail
})

test('removed lines highlight like added ones in split view', async () => {
  // The panes show fragments, and tree-sitter's error recovery on the removed
  // side used to drop JSX attribute captures — this is the exact shape that broke.
  const base = [
    'export function App() {',
    '  return (',
    '    <Show>',
    '      <EditorPane',
    '        path={workspace.activePath()}',
    '        theme={config.theme}',
    '      />',
    '    </Show>',
    '  )',
    '}',
    '',
  ].join('\n')
  const dir = repo({ 'a.tsx': base })
  writeFileSync(join(dir, 'a.tsx'), base.replace('theme={config.theme}', 'mode={config.mode}'))

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await openDiff(t)
  // The highlight pass is async; poll for its line rather than outwait it.
  const removedLine = () =>
    (t.captureSpans() as { lines: { spans: Span[] }[] }).lines
      .map(line => line.spans)
      .find(line => line.some(span => span.text === 'theme'))
  await until(t, () => removedLine() !== undefined)

  const spans = removedLine()!
  const fgOf = (text: string) => String(spans.find(span => span.text === text)?.fg)
  // The removed side's attribute name wears the same color as the added side's.
  expect(fgOf('theme')).toBe(fgOf('mode')!)
  // And it is a real syntax color, not the plain-text fallback.
  expect(fgOf('theme')).not.toBe(fgOf('=')!)
})

test('a clean working tree has no row to open a diff from', async () => {
  const t = await launch(repo({ 'a.ts': 'alpha\n' }))
  await runCommand(t, 'Source control')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('no changes')
  expect(frame).not.toContain('Esc close') // no page came up
})

test('unsaved edits diff against HEAD before the file is saved', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'a.ts'), 'saved\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('typed '))
  await openDiff(t)

  const frame = t.captureCharFrame()
  expect(frame).toContain('- alpha')
  expect(frame).toContain('+ typed saved')
})
