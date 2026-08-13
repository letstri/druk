/**
 * Reading code with a review beside you: the notes dropped on lines while
 * reading, and the answers to them.
 *
 * The division is the panel's usual one — this owns the list, the cursor and
 * the fold state, `ui/ReviewPanel.tsx` draws whatever `rows()` returns and
 * reports clicks, and `app/keyboard.ts` holds the keys.
 *
 * Nothing here talks to a network. A review is what this session's reader and
 * whichever agent shares the notes file have said to each other, and that is
 * deliberately all of it.
 */
import { basename, relative } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { loadNotes, NOTE_LABELS, readNotes, saveNotes } from '../core/review'
import type { NoteKind, ReviewNote } from '../core/review'
import { chordFor } from '../ui/keys'
import type { ReviewRow } from '../ui/ReviewPanel'
import type { Status } from './status'
import type { Workspace } from './workspace'

export type { ReviewRow } from '../ui/ReviewPanel'

/** One line of a remark, for a row that has one line to draw it in. */
const oneLine = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

/**
 * What the panel says when the review is empty, which is the only time it has
 * the room to say anything: a sidebar is thirty columns, so the lines are short
 * enough to survive being cut at one, and the key is asked for rather than
 * spelled out — a rebind has to rename it here too.
 */
const emptyHints = (chord: string): string[] => {
  const key = chord || 'palette → Review → Note'
  return [
    'No notes yet.',
    '',
    `${key} notes the line`,
    'or selection under the',
    'cursor as an issue,',
    'suggestion, question',
    'or note.',
    '',
    '↑↓     walk the list',
    'Enter  jump to the line',
    'r      answer a remark',
    '⌫      drop the thread',
    '←→     fold a file',
    '',
    'Notes are kept per',
    'project in review.json',
    'beside the config, so',
    'an agent can read them',
    'and answer them live.',
  ]
}

/** How long after creating a note an external write missing it reads as a stale clobber. */
const RESCUE_WINDOW = 2000

export function createReview(deps: { rootDir: string; status: Status; workspace: Workspace }) {
  const { rootDir, status, workspace } = deps
  const { say } = status

  const initial = loadNotes(rootDir)
  const [notes, setNotes] = createSignal<ReviewNote[]>(initial)
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = createSignal(0)

  // What lets a save merge instead of clobber (`seen`), and an adopt tell an
  // external delete from a stale writer's overwrite (`created`, against the
  // note's own age).
  const seen = new Set(initial.map(note => note.id))
  const created = new Set<string>()

  /** Notes are the one thing here that outlives the session, so every write persists. */
  const writeNotes = (next: ReviewNote[]) => {
    for (const note of next) seen.add(note.id)
    setNotes(next)
    saveNotes(rootDir, next, { seen })
  }

  const sameNote = (a: ReviewNote, b: ReviewNote) =>
    a.id === b.id &&
    a.path === b.path &&
    a.line === b.line &&
    a.endLine === b.endLine &&
    a.kind === b.kind &&
    a.body === b.body &&
    a.at === b.at &&
    a.parent === b.parent &&
    a.author === b.author

  /**
   * Adopt what the file says — the way git state made in another terminal
   * shows up without a restart. The value compare absorbs a watch event that
   * reports a save of druk's own, which some platforms deliver and some do
   * not: a rename is announced under whichever of the two names the platform
   * picks, and the temp one is filtered out by name.
   */
  const reloadNotes = () => {
    const fresh = readNotes(rootDir)
    // Unreadable is another writer caught mid-file: "not now", never "no notes".
    if (fresh === null) return
    const held = notes()
    if (fresh.length === held.length && fresh.every((note, i) => sameNote(note, held[i]!))) return
    const freshIds = new Set(fresh.map(note => note.id))
    // A note this session created seconds ago, gone from a file druk did not
    // write, was clobbered by a writer holding a copy read before it existed —
    // so it goes back, and back to disk. Age is what separates that from a
    // deliberate delete: druk cannot see whether the other side read the file
    // before or after the save, and only the racing writer is quick. Past the
    // window the file is right and the note is the file's to delete.
    const orphaned = held.filter(
      note =>
        created.has(note.id) && !freshIds.has(note.id) && Date.now() - note.at < RESCUE_WINDOW,
    )
    for (const id of freshIds) seen.add(id)
    if (orphaned.length === 0) return setNotes(fresh)
    writeNotes([...fresh, ...orphaned])
  }

  /**
   * The replies to each note, oldest first — the order a conversation reads in,
   * and not the order the list happens to hold them in: another writer appends
   * wherever it likes, and druk's own rescue puts a note back at the end.
   */
  const threads = createMemo(() => {
    const byParent = new Map<string, ReviewNote[]>()
    for (const note of notes()) {
      if (!note.parent) continue
      const held = byParent.get(note.parent)
      if (held) held.push(note)
      else byParent.set(note.parent, [note])
    }
    for (const said of byParent.values()) said.sort((a, b) => a.at - b.at)
    return byParent
  })

  const repliesOf = (id: string) => threads().get(id) ?? []

  /**
   * The notes a thread hangs off. A reply whose note is gone from the file —
   * another writer deleted one and left its answers — is one of these too: it
   * is somebody's words, and hiding it would lose them silently.
   */
  const threadStarts = createMemo(() => {
    const ids = new Set(notes().map(note => note.id))
    return notes().filter(note => !note.parent || !ids.has(note.parent))
  })

  /** Ids only have to be unique within this list; the clock plus a counter is that. */
  let counter = 0
  const nextId = () => `${Date.now().toString(36)}-${counter++}`

  const add = (note: Omit<ReviewNote, 'id' | 'at' | 'parent'>, parent?: string) => {
    const full: ReviewNote = { ...note, id: nextId(), at: Date.now(), parent }
    created.add(full.id)
    writeNotes([...notes(), full])
    const where = `${basename(note.path)}:${note.line + 1}`
    if (parent) {
      const said = repliesOf(parent).length
      return say(`Replied on ${where} — ${said} in this thread`)
    }
    say(`${NOTE_LABELS[note.kind]} noted on ${where} — ${threadStarts().length} in this review`)
  }

  /**
   * An answer to a note, which is a note of its own carrying the other's id —
   * see `core/review.ts` for why a thread is a list rather than a field. It
   * takes the line and the file it answers on: everything that groups, marks
   * or opens a remark reads those, and a reply belongs wherever its note does.
   */
  const reply = (parent: ReviewNote, body: string) => {
    add(
      { path: parent.path, line: parent.line, endLine: parent.endLine, kind: 'note', body },
      parent.id,
    )
  }

  const removeNote = (id: string) => {
    const held = notes().find(note => note.id === id)
    if (!held) return
    // A thread goes whole: a reply without the note it answers reads as a
    // remark nobody made, and there is no way back to the question it was for.
    const gone = new Set([id, ...repliesOf(id).map(note => note.id)])
    writeNotes(notes().filter(note => !gone.has(note.id)))
    const answers = gone.size - 1
    const what = held.parent
      ? 'reply'
      : `${NOTE_LABELS[held.kind].toLowerCase()} on ${basename(held.path)}`
    say(
      `Removed the ${what}${answers > 0 ? ` and its ${answers} repl${answers === 1 ? 'y' : 'ies'}` : ''}`,
    )
  }

  const clear = () => {
    if (notes().length === 0) return say('No review notes to clear')
    const gone = notes().length
    writeNotes([])
    say(`Cleared ${gone} review note${gone === 1 ? '' : 's'}`)
  }

  /**
   * Draft notes of one file, by line — the gutter marks and the inline text.
   * Threads, not messages: a reply sits on the line its note does, and one mark
   * per line is what the gutter and the row after the line have room for.
   */
  const notesFor = (path: string) => threadStarts().filter(note => note.path === path)

  /** What the editor draws beside a line: the threads of the open file, one per line. */
  const marks = createMemo(() => {
    const path = workspace.activePath()
    const byLine = new Map<number, { draft: boolean; label: string; text: string }>()
    if (!path) return byLine
    for (const note of notesFor(path)) {
      const said = repliesOf(note.id).length
      byLine.set(note.line, {
        draft: true,
        // The count is the whole of what a thread adds to a one-line mark: the
        // conversation itself is in the panel and in the card under the line.
        label: said > 0 ? `${NOTE_LABELS[note.kind]} ↳${said}` : NOTE_LABELS[note.kind],
        text: oneLine(note.body),
      })
    }
    return byLine
  })

  /** Every thread, grouped by file, files in path order. */
  const grouped = createMemo(() => {
    const groups = new Map<string, { rel: string; notes: ReviewNote[] }>()
    const group = (path: string) => {
      const rel = relative(rootDir, path) || basename(path)
      const held = groups.get(rel)
      if (held) return held
      const made = { rel, notes: [] }
      groups.set(rel, made)
      return made
    }
    for (const note of threadStarts()) group(note.path).notes.push(note)
    return [...groups.values()].toSorted((a, b) => a.rel.localeCompare(b.rel))
  })

  const rows = createMemo<ReviewRow[]>(() => {
    const out: ReviewRow[] = []
    for (const entry of grouped()) {
      const shut = collapsed().has(entry.rel)
      out.push({
        kind: 'file',
        id: `file:${entry.rel}`,
        rel: entry.rel,
        // Replies counted too: the number says what the fold is hiding, and a
        // fold hides the whole thread.
        count: entry.notes.reduce((held, note) => held + 1 + repliesOf(note.id).length, 0),
        collapsed: shut,
      })
      if (shut) continue
      for (const note of entry.notes.toSorted((a, b) => a.line - b.line)) {
        out.push({
          kind: 'note',
          id: note.id,
          note,
          label: `${NOTE_LABELS[note.kind]} ${note.line + 1}`,
          text: oneLine(note.body),
        })
        // The answers under what they answer, and only the file's fold hides
        // them: a thread is three rows on a bad day, and a second fold to learn
        // would cost more than it saved.
        for (const said of repliesOf(note.id)) {
          out.push({
            kind: 'reply',
            id: said.id,
            note: said,
            label: said.author ? `↳ @${said.author}` : '↳ you',
            text: oneLine(said.body),
          })
        }
      }
    }
    // An empty review is the one place with room to say what the panel is for,
    // and the one time the user has nothing else to read here.
    if (out.length === 0) {
      const hints = emptyHints(chordFor('review.note'))
      for (const [index, label] of hints.entries()) {
        out.push({ kind: 'hint', id: `hint:${index}`, label })
      }
    }
    return out
  })

  const at = () => Math.max(0, Math.min(cursor(), rows().length - 1))
  const row = () => rows()[at()]
  const move = (delta: number) => setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)))
  const moveTo = (index: number) => setCursor(Math.max(0, Math.min(index, rows().length - 1)))

  const toggleFile = (rel: string) =>
    setCollapsed(previous => {
      const next = new Set(previous)
      if (!next.delete(rel)) next.add(rel)
      return next
    })

  /** → and ←, which only ever mean "open" and "shut", and only on a heading. */
  const fold = (shut: boolean) => {
    const current = row()
    if (current?.kind !== 'file' || current.collapsed === shut) return
    toggleFile(current.rel)
  }

  const collapseAll = () => setCollapsed(new Set(grouped().map(entry => entry.rel)))

  /** The line one remark is about. */
  const placeOf = (note: ReviewNote) => ({ path: note.path, line: note.line })

  /**
   * The remark the row at `index` speaks for, which is what both the editor
   * that follows the cursor and the card under the line are about.
   *
   * A heading answers with the first remark of its file rather than with
   * nothing: it is the row the cursor lands on when the panel opens, and a
   * review that shows no code until the second keypress is the thing this is
   * for. A collapsed group still answers — the remarks are hidden, not gone.
   */
  const remarkOf = (index = at()): ReviewNote | null => {
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current || current.kind === 'hint') return null
    if (current.kind === 'note' || current.kind === 'reply') return current.note
    return grouped().find(entry => entry.rel === current.rel)?.notes[0] ?? null
  }

  const targetOf = (index = at()) => {
    const remark = remarkOf(index)
    return remark ? placeOf(remark) : null
  }

  /**
   * The remark under the cursor as the editor opens it: a card under its line,
   * and only while it is about the file on screen — the card is drawn in that
   * file's coordinates, so one belonging to another file has nowhere to go.
   */
  const card = createMemo(() => {
    const remark = remarkOf()
    const path = workspace.activePath()
    if (!remark || !path) return null
    const place = placeOf(remark)
    if (place.path !== path) return null
    // The whole thread, whichever of its messages the cursor is on: a reply read
    // without the remark it answers is half a conversation.
    const root = (remark.parent && notes().find(note => note.id === remark.parent)) || remark
    return {
      line: place.line,
      draft: true,
      heading: NOTE_LABELS[root.kind],
      body: root.body,
      replies: repliesOf(root.id).map(said => ({
        label: said.author ? `@${said.author}` : 'you',
        body: said.body,
      })),
    }
  })

  /** Enter: fold a heading, or land on the line the remark is about. */
  const activate = (index = at(), open?: (path: string, line: number) => void) => {
    moveTo(index)
    const current = row()
    if (!current || current.kind === 'hint') return
    if (current.kind === 'file') return toggleFile(current.rel)
    if (current.kind === 'note' || current.kind === 'reply') {
      open?.(current.note.path, current.note.line)
    }
  }

  /** Backspace: drop the thread, or the one answer, under the cursor. */
  const remove = () => {
    const current = row()
    if (current?.kind !== 'note' && current?.kind !== 'reply') return
    removeNote(current.note.id)
  }

  /**
   * The note an answer would hang off — the remark the card is showing, so `r`
   * answers what is on screen rather than what the cursor is literally on: a
   * heading stands in for its file's first remark, as it does everywhere else.
   *
   * Answering a reply answers the note it belongs to. A thread is flat, as it is
   * everywhere a review is read, and nesting the second answer under the first
   * says a hierarchy nobody meant.
   */
  const replyTarget = (): ReviewNote | null => {
    const remark = remarkOf()
    if (!remark) {
      say('Put the cursor on a remark to answer it', 'warn')
      return null
    }
    return (remark.parent && notes().find(note => note.id === remark.parent)) || remark
  }

  return {
    notes,
    marks,
    rows,
    cursor: at,
    move,
    moveTo,
    targetOf,
    card,
    activate,
    fold,
    collapseAll,
    remove,
    add,
    reply,
    replyTarget,
    repliesOf,
    removeNote,
    clear,
    reloadNotes,
    /** The header's count, which no fold narrows. */
    count: () => notes().length,
  }
}

export type Review = ReturnType<typeof createReview>

/** Kinds as the chooser lists them, with what each one means to an agent. */
export const KIND_CHOICES: { id: NoteKind; label: string }[] = [
  { id: 'issue', label: 'Issue — this is wrong and needs fixing' },
  { id: 'suggestion', label: 'Suggestion — consider changing this' },
  { id: 'question', label: 'Question — explain this' },
  { id: 'note', label: 'Note — context worth carrying' },
]
