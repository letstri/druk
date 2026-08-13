import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadNotes, saveNotes } from '../src/core/review'
import { ALT } from '../src/ui/keys'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  settle,
  until,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

// ── Notes, and where they live ─────────────────────────────────────────────

test('notes survive a restart, and clearing forgets the project', () => {
  const file = join(tempDir('druk-notes-'), 'review.json')
  const note = {
    id: 'a',
    path: '/p/src/a.ts',
    line: 4,
    endLine: 4,
    kind: 'issue' as const,
    body: 'wrong',
    at: 1,
  }
  saveNotes('/p', [note], { now: 1, file })
  expect(loadNotes('/p', file)).toEqual([note])
  // Another project's notes are not this one's.
  expect(loadNotes('/other', file)).toEqual([])
  saveNotes('/p', [], { now: 2, file })
  expect(loadNotes('/p', file)).toEqual([])
})

// ── The editor ──────────────────────────────────────────────────────────────

const NOTES_PATH = join(process.env.XDG_CONFIG_HOME!, 'druk', 'review.json')

const theirNote = (dir: string, id: string, body: string) => ({
  id,
  path: join(dir, 'a.ts'),
  line: 0,
  endLine: 0,
  kind: 'note',
  body,
  at: 1,
})

const PROJECT = { 'a.ts': 'const a = 1\nconst b = 2\n' }

/** Write a note on the open file's current line, through the palette. */
async function noteLine(t: Harness, kind: string, text: string) {
  await runCommand(t, `Note this line as ${kind}`)
  await press(t, i => void i.typeText(text))
  await press(t, i => i.pressEnter())
}

test('a note lands in the panel, in the gutter and after the line', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'this should be const')

  // Inline, after the end of the line it is about.
  expect(t.captureCharFrame()).toContain('ISSUE: this should be const')

  await runCommand(t, 'Review panel')
  await untilFrame(t, 'ISSUE 1')
  expect(t.captureCharFrame()).toContain('a.ts')
})

test('a remark too long for its row names the panel that holds the whole of it', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 90, height: 16 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'this should be a const and the reason for it runs past the row')

  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('const a = 1'))
  expect(row).toContain('…')
  expect(row).toContain(`Ctrl+${ALT}+R`)

  // The hint follows the caret: the line below carries no note and no key.
  await press(t, i => i.pressArrow('down'))
  expect(
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('const a = 1')),
  ).not.toContain(`Ctrl+${ALT}+R`)
})

test('the panel opens the remark as a card under its line, and pages files', async () => {
  const t = await launch(
    fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\nconst c = 3\n' }),
    {},
    { width: 100, height: 24 },
  )
  await openFile(t, 'b.ts')
  await press(t, i => i.pressArrow('down'))
  await noteLine(t, 'issue', 'wrong on b')
  await openFile(t, 'a.ts')
  await noteLine(t, 'question', 'why on a')

  // The cursor lands on the first file's heading, and the card opens under the
  // line of its first remark rather than waiting for a keypress.
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'why on a')
  const card = t.captureCharFrame()
  expect(card).toContain('◆ QUESTION')
  // The card sits in a gap opened for it, so the line it is about is still on
  // screen under its own number rather than behind the box.
  expect(card).toContain('const a = 1')

  // Two rows down is b.ts's heading — a file that is not the one on screen, so
  // the cursor pages the editor to it and the card follows.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await untilFrame(t, 'wrong on b')
  const paged = t.captureCharFrame()
  expect(paged).toContain('const b = 2')
  // Opening the file must not hand the keyboard to the editor: the arrows are
  // what drives the pager, and the card is only up while the panel holds them.
  expect(paged).toContain('◆ ISSUE')
})

test('the gap the card sits in never reaches the file, and closes on the editor', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' })
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await press(t, i => void i.typeText('X'))
  await noteLine(t, 'issue', 'blank rows must not be saved')

  await runCommand(t, 'Review panel')
  await untilFrame(t, 'must not be saved')

  // The buffer is holding rows the file has not. Saving must write the file.
  await runCommand(t, 'Save file')
  await settle(t, 200)
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('Xconst a = 1\nconst b = 2\nconst c = 3\n')

  // And taking the keyboard closes the card, which is what keeps those rows
  // from ever being typed into.
  await press(t, i => i.pressTab())
  await untilGone(t, '◆ ISSUE')
  expect(t.captureCharFrame()).toContain('const c = 3')
})

test('leaving the panel takes the gap back out of the buffer', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' })
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'first')

  await runCommand(t, 'Review panel')
  await untilFrame(t, '◆ ISSUE')

  // Closing the panel is the pass with no view left holding the file, so the
  // buffer had to be compared against `props.content` rather than against
  // itself — it used to keep the blank rows for good, which reads in the editor
  // as the code below the note having been pushed down and renumbered.
  await pressEscape(t)
  await untilGone(t, '◆ ISSUE')
  const back = t.captureCharFrame()
  expect(back).toContain('const b = 2')
  // Line 2 is `const b = 2` again, not three rows of nothing.
  expect(back).toMatch(/2\s+const b = 2/)

  await runCommand(t, 'Save file')
  await settle(t, 200)
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\nconst b = 2\nconst c = 3\n')
})

test('an empty panel says what it is for, in the keys actually bound', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 30 })
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'No notes yet')

  const frame = t.captureCharFrame()
  // The chord is read off the keymap rather than spelled into the text, so a
  // rebind renames it here too.
  expect(frame).toContain(`Ctrl+${ALT}+A notes the line`)
  expect(frame).toContain('answer a remark')
  // And where the notes go, which is the half an agent needs to be told.
  expect(frame).toContain('review.json')
})

test('a note needs a file, and says so from the tree', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await runCommand(t, 'Note this line as issue')
  expect(t.captureCharFrame()).toContain('Open a file to note a line in it')
})

test('Backspace in the panel drops the note under the cursor', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'question', 'why two?')

  await runCommand(t, 'Review panel')
  // Onto the note under its file heading, then remove it.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressBackspace())
  await untilFrame(t, 'Removed the question')
  expect(t.captureCharFrame()).toContain('No notes yet')
})

// ── Threads ─────────────────────────────────────────────────────────────────

test('r answers the remark under the cursor, and the thread reads as one', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'this should be const')

  await runCommand(t, 'Review panel')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('r'))
  // The prompt names what is being answered — the last chance to notice it is
  // the wrong remark.
  expect(t.captureCharFrame()).toContain('Reply to ISSUE · a.ts:1')
  await press(t, i => void i.typeText('let is fine here'))
  await press(t, i => i.pressEnter())

  await untilFrame(t, '↳ you')
  const frame = t.captureCharFrame()
  // The panel: the answer under what it answers, and the file heading counts it.
  expect(frame).toContain('let is fine here')
  // The card: both halves of the conversation, under the line they are about.
  expect(frame).toContain('◆ ISSUE')
  expect(frame).toContain('↳ you: let is fine here')

  // Answering an answer stays in the same thread rather than nesting one deeper.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('r'))
  expect(t.captureCharFrame()).toContain('Reply to ISSUE · a.ts:1')
  await pressEscape(t)
})

/** A note, then an answer to it — the panel's cursor left on the note itself. */
async function noteAndReply(t: Harness, body: string, answer: string) {
  await noteLine(t, 'issue', body)
  await runCommand(t, 'Review panel')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => void i.typeText('r'))
  await press(t, i => void i.typeText(answer))
  await press(t, i => i.pressEnter())
  await untilFrame(t, '↳ you')
}

test('an answered note says so after its line', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteAndReply(t, 'wrong', 'no it is not')

  // The inline mark is one line whatever the thread holds: the count is all a
  // row after the code has space to say.
  await press(t, i => i.pressTab())
  await untilGone(t, '◆ ISSUE')
  expect(t.captureCharFrame()).toContain('ISSUE ↳1: wrong')
})

test('deleting a note takes its answers with it', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteAndReply(t, 'answer this', 'answered')

  // The cursor never left the note, and Backspace on it clears the thread — a
  // reply to nothing is a remark nobody can read.
  await press(t, i => i.pressBackspace())
  await untilFrame(t, 'and its 1 reply')
  expect(t.captureCharFrame()).toContain('No notes yet')
  expect(loadNotes(dir, NOTES_PATH)).toEqual([])
})

test("an agent's answer arrives under the note it answers", async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'explain this')
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'explain this')

  const held = JSON.parse(readFileSync(NOTES_PATH, 'utf8')) as {
    [key: string]: { notes: { id: string }[] }
  }
  const parent = held[dir]!.notes[0]!.id
  writeFileSync(
    NOTES_PATH,
    JSON.stringify({
      [dir]: {
        notes: [
          ...held[dir]!.notes,
          { ...theirNote(dir, 'x9', 'it is the parser'), parent, author: 'claude' },
        ],
        touchedAt: 2,
      },
    }),
  )

  await untilFrame(t, '↳ @claude')
  expect(t.captureCharFrame()).toContain('it is the parser')
})

test('a note taken on a selection carries the whole span', async () => {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  // Select both lines: the note is about the pair, so its title says 1-2.
  await pressTimes(t, 2, i => i.pressArrow('down', { shift: true }))
  await runCommand(t, 'Note this line as issue')
  expect(t.captureCharFrame()).toContain('a.ts:1-2')
  await pressEscape(t)
})

// ── Another writer, while druk is open ──────────────────────────────────────

test('a note written by another process appears, and its delete empties', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'No notes yet')

  writeFileSync(
    NOTES_PATH,
    JSON.stringify({ [dir]: { notes: [theirNote(dir, 'x1', 'left by an agent')], touchedAt: 1 } }),
  )
  await untilFrame(t, 'left by an agent')

  writeFileSync(NOTES_PATH, '{}\n')
  await untilGone(t, 'left by an agent')
})

test('a stale overwrite gives back the note it never saw', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'written here')
  await untilFrame(t, 'written here')

  // An agent that read the file before the note existed writes its stale copy
  // back — with its own note, without druk's.
  writeFileSync(
    NOTES_PATH,
    JSON.stringify({ [dir]: { notes: [theirNote(dir, 'x2', 'left by an agent')], touchedAt: 1 } }),
  )
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'left by an agent')
  await untilFrame(t, 'written here')
  // And the rescue reached the disk, not just the panel.
  await until(t, () => readFileSync(NOTES_PATH, 'utf8').includes('written here'))
})

test('an agent may delete a note druk wrote, once it is not a race', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await openFile(t, 'a.ts')
  await noteLine(t, 'issue', 'fix this')
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'fix this')
  expect(readFileSync(NOTES_PATH, 'utf8')).toContain('fix this')

  // Long enough that the note is no longer young enough to rescue — the whole
  // point being that past that age an absence is a delete and not a clobber,
  // which is the flow the notes exist for: the agent fixes and strikes off.
  await settle(t, 2300)
  writeFileSync(NOTES_PATH, JSON.stringify({ [dir]: { notes: [], touchedAt: 2 } }))

  await untilGone(t, 'fix this')
  // And it stays gone: no save puts it back behind the panel.
  await settle(t, 200)
  expect(readFileSync(NOTES_PATH, 'utf8')).not.toContain('fix this')
})

test('an unreadable notes file changes nothing on screen', async () => {
  const dir = fixture(PROJECT)
  writeFileSync(
    NOTES_PATH,
    JSON.stringify({
      [dir]: { notes: [theirNote(dir, 'x3', 'held before the tear')], touchedAt: 1 },
    }),
  )
  const t = await launch(dir, {}, { width: 100, height: 24 })
  await runCommand(t, 'Review panel')
  await untilFrame(t, 'held before the tear')

  writeFileSync(NOTES_PATH, '{ torn mid-write')
  // The assertion is that nothing happened, so the fixed wait is the right tool.
  await settle(t, 300)
  expect(t.captureCharFrame()).toContain('held before the tear')
})
