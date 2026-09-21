import { basename, relative } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { loadNotes, NOTE_LABELS, readNotes, saveNotes } from '../core/review'
import type { NoteKind, ReviewNote } from '../core/review'
import { plural } from '../core/text'
import { chordFor } from '../ui/keys'
import type { ReviewRow } from '../ui/ReviewPanel'
import type { Status } from './status'
import type { Workspace } from './workspace'

export type { ReviewRow } from '../ui/ReviewPanel'

const oneLine = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

const emptyHints = (chord = 'palette → Review → Note'): string[] => {
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

// ms: within this, a note missing from an external write reads as a stale clobber.
const RESCUE_WINDOW = 2000

export function createReview(deps: {
  rootDir: string
  status: Status
  workspace: Workspace
}) {
  const { rootDir, status, workspace } = deps
  const { say } = status

  const initial = loadNotes(rootDir)
  const [notes, setNotes] = createSignal<ReviewNote[]>(initial)
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = createSignal(0)

  const seen = new Set(initial.map((note) => note.id))
  const created = new Set<string>()

  const writeNotes = (next: ReviewNote[]) => {
    for (const note of next) {
      seen.add(note.id)
    }
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

  const reloadNotes = () => {
    const fresh = readNotes(rootDir)
    if (fresh === null) {
      return
    }
    const held = notes()
    // The value compare absorbs the watch event some platforms send for druk's own save.
    if (
      fresh.length === held.length &&
      fresh.every((note, i) => sameNote(note, held[i]!))
    ) {
      return
    }
    const freshIds = new Set(fresh.map((note) => note.id))
    const orphaned = held.filter(
      (note) =>
        created.has(note.id) &&
        !freshIds.has(note.id) &&
        Date.now() - note.at < RESCUE_WINDOW
    )
    for (const id of freshIds) {
      seen.add(id)
    }
    if (orphaned.length === 0) {
      return setNotes(fresh)
    }
    writeNotes([...fresh, ...orphaned])
  }

  const threads = createMemo(() => {
    const byParent = new Map<string, ReviewNote[]>()
    for (const note of notes()) {
      if (!note.parent) {
        continue
      }
      const held = byParent.get(note.parent)
      if (held) {
        held.push(note)
      } else {
        byParent.set(note.parent, [note])
      }
    }
    for (const said of byParent.values()) {
      said.sort((a, b) => a.at - b.at)
    }
    return byParent
  })

  const repliesOf = (id: string) => threads().get(id) ?? []

  // A reply whose note another writer deleted is listed on its own rather than lost.
  const threadStarts = createMemo(() => {
    const ids = new Set(notes().map((note) => note.id))
    return notes().filter((note) => !note.parent || !ids.has(note.parent))
  })

  let counter = 0
  const nextId = () => {
    counter += 1
    return `${Date.now().toString(36)}-${counter}`
  }

  const add = (
    note: Omit<ReviewNote, 'id' | 'at' | 'parent'>,
    parent?: string
  ) => {
    const full: ReviewNote = { ...note, at: Date.now(), id: nextId(), parent }
    created.add(full.id)
    writeNotes([...notes(), full])
    const where = `${basename(note.path)}:${note.line + 1}`
    if (parent) {
      const said = repliesOf(parent).length
      return say(`Replied on ${where} — ${said} in this thread`)
    }
    say(
      `${NOTE_LABELS[note.kind]} noted on ${where} — ${threadStarts().length} in this review`
    )
  }

  const reply = (parent: ReviewNote, body: string) => {
    add(
      {
        body,
        endLine: parent.endLine,
        kind: 'note',
        line: parent.line,
        path: parent.path,
      },
      parent.id
    )
  }

  const removeNote = (id: string) => {
    const held = notes().find((note) => note.id === id)
    if (!held) {
      return
    }
    const gone = new Set([id, ...repliesOf(id).map((note) => note.id)])
    writeNotes(notes().filter((note) => !gone.has(note.id)))
    const answers = gone.size - 1
    const what = held.parent
      ? 'reply'
      : `${NOTE_LABELS[held.kind].toLowerCase()} on ${basename(held.path)}`
    say(
      `Removed the ${what}${answers > 0 ? ` and its ${answers} repl${answers === 1 ? 'y' : 'ies'}` : ''}`
    )
  }

  const clear = () => {
    if (notes().length === 0) {
      return say('No review notes to clear')
    }
    const gone = notes().length
    writeNotes([])
    say(`Cleared ${plural(gone, 'review note')}`)
  }

  const notesFor = (path: string) =>
    threadStarts().filter((note) => note.path === path)

  const marks = createMemo(() => {
    const path = workspace.activePath()
    const byLine = new Map<
      number,
      { draft: boolean; label: string; text: string }
    >()
    if (!path) {
      return byLine
    }
    for (const note of notesFor(path)) {
      const said = repliesOf(note.id).length
      byLine.set(note.line, {
        draft: true,
        label:
          said > 0
            ? `${NOTE_LABELS[note.kind]} ↳${said}`
            : NOTE_LABELS[note.kind],
        text: oneLine(note.body),
      })
    }
    return byLine
  })

  const grouped = createMemo(() => {
    const groups = new Map<string, { rel: string; notes: ReviewNote[] }>()
    const group = (path: string) => {
      const rel = relative(rootDir, path) || basename(path)
      const held = groups.get(rel)
      if (held) {
        return held
      }
      const made = { notes: [], rel }
      groups.set(rel, made)
      return made
    }
    for (const note of threadStarts()) {
      group(note.path).notes.push(note)
    }
    return [...groups.values()].toSorted((a, b) => a.rel.localeCompare(b.rel))
  })

  const rows = createMemo<ReviewRow[]>(() => {
    const out: ReviewRow[] = []
    for (const entry of grouped()) {
      const shut = collapsed().has(entry.rel)
      out.push({
        collapsed: shut,
        count: entry.notes.reduce(
          (held, note) => held + 1 + repliesOf(note.id).length,
          0
        ),
        id: `file:${entry.rel}`,
        kind: 'file',
        rel: entry.rel,
      })
      if (shut) {
        continue
      }
      for (const note of entry.notes.toSorted((a, b) => a.line - b.line)) {
        out.push({
          id: note.id,
          kind: 'note',
          label: `${NOTE_LABELS[note.kind]} ${note.line + 1}`,
          note,
          text: oneLine(note.body),
        })
        for (const said of repliesOf(note.id)) {
          out.push({
            id: said.id,
            kind: 'reply',
            label: said.author ? `↳ @${said.author}` : '↳ you',
            note: said,
            text: oneLine(said.body),
          })
        }
      }
    }
    if (out.length === 0) {
      const hints = emptyHints(chordFor('review.note'))
      for (const [index, label] of hints.entries()) {
        out.push({ id: `hint:${index}`, kind: 'hint', label })
      }
    }
    return out
  })

  const at = () => Math.max(0, Math.min(cursor(), rows().length - 1))
  const row = () => rows()[at()]
  const move = (delta: number) =>
    setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)))
  const moveTo = (index: number) =>
    setCursor(Math.max(0, Math.min(index, rows().length - 1)))

  const toggleFile = (rel: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(rel)) {
        next.add(rel)
      }
      return next
    })

  const fold = (shut: boolean) => {
    const current = row()
    if (current?.kind !== 'file' || current.collapsed === shut) {
      return
    }
    toggleFile(current.rel)
  }

  const collapseAll = () =>
    setCollapsed(new Set(grouped().map((entry) => entry.rel)))

  const placeOf = (note: ReviewNote) => ({ line: note.line, path: note.path })

  const remarkOf = (index = at()): ReviewNote | null => {
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current || current.kind === 'hint') {
      return null
    }
    if (current.kind === 'note' || current.kind === 'reply') {
      return current.note
    }
    return (
      grouped().find((entry) => entry.rel === current.rel)?.notes[0] ?? null
    )
  }

  const targetOf = (index = at()) => {
    const remark = remarkOf(index)
    return remark ? placeOf(remark) : null
  }

  // Only for the file on screen: the card is drawn in that file's coordinates.
  const card = createMemo(() => {
    const remark = remarkOf()
    const path = workspace.activePath()
    if (!remark || !path) {
      return null
    }
    const place = placeOf(remark)
    if (place.path !== path) {
      return null
    }
    const root =
      (remark.parent && notes().find((note) => note.id === remark.parent)) ||
      remark
    return {
      body: root.body,
      draft: true,
      heading: NOTE_LABELS[root.kind],
      line: place.line,
      replies: repliesOf(root.id).map((said) => ({
        body: said.body,
        label: said.author ? `@${said.author}` : 'you',
      })),
    }
  })

  const activate = (
    index = at(),
    open?: (path: string, line: number) => void
  ) => {
    moveTo(index)
    const current = row()
    if (!current || current.kind === 'hint') {
      return
    }
    if (current.kind === 'file') {
      return toggleFile(current.rel)
    }
    if (current.kind === 'note' || current.kind === 'reply') {
      open?.(current.note.path, current.note.line)
    }
  }

  const remove = () => {
    const current = row()
    if (current?.kind !== 'note' && current?.kind !== 'reply') {
      return
    }
    removeNote(current.note.id)
  }

  // Answering a reply answers its note: a thread is flat.
  const replyTarget = (): ReviewNote | null => {
    const remark = remarkOf()
    if (!remark) {
      say('Put the cursor on a remark to answer it', 'warn')
      return null
    }
    return (
      (remark.parent && notes().find((note) => note.id === remark.parent)) ||
      remark
    )
  }

  return {
    activate,
    add,
    card,
    clear,
    collapseAll,
    count: () => notes().length,
    cursor: at,
    fold,
    marks,
    move,
    moveTo,
    notes,
    reloadNotes,
    remove,
    removeNote,
    repliesOf,
    reply,
    replyTarget,
    rows,
    targetOf,
  }
}

export type Review = ReturnType<typeof createReview>

export const KIND_CHOICES: { id: NoteKind; label: string }[] = [
  { id: 'issue', label: 'Issue — this is wrong and needs fixing' },
  { id: 'suggestion', label: 'Suggestion — consider changing this' },
  { id: 'question', label: 'Question — explain this' },
  { id: 'note', label: 'Note — context worth carrying' },
]
