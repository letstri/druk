import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { CONFIG_FILE } from './config'
import { watchPath, writeAtomic } from './fs'

const NOTES_FILE = join(dirname(CONFIG_FILE), 'review.json')

const MAX_PROJECTS = 20

export const NOTE_KINDS = ['issue', 'suggestion', 'question', 'note'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_LABELS: Record<NoteKind, string> = {
  issue: 'ISSUE',
  note: 'NOTE',
  question: 'QUESTION',
  suggestion: 'SUGGESTION',
}

export interface ReviewNote {
  id: string
  path: string
  line: number
  endLine: number
  kind: NoteKind
  body: string
  at: number
  // A reply is a note of its own: an answer only ever appends, so two writers cannot clash.
  parent?: string
  author?: string
}

const isKind = (raw: unknown): raw is NoteKind =>
  NOTE_KINDS.includes(raw as NoteKind)

function parseNote(raw: unknown): ReviewNote | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const note = raw as Record<string, unknown>
  if (typeof note.id !== 'string' || typeof note.path !== 'string') {
    return null
  }
  if (typeof note.line !== 'number' || typeof note.body !== 'string') {
    return null
  }
  if (!isKind(note.kind)) {
    return null
  }
  const line = Math.max(0, Math.floor(note.line))
  const endLine =
    typeof note.endLine === 'number'
      ? Math.max(line, Math.floor(note.endLine))
      : line
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : undefined
  return {
    at: typeof note.at === 'number' ? note.at : 0,
    author: text(note.author),
    body: note.body,
    endLine,
    id: note.id,
    kind: note.kind,
    line,
    parent: text(note.parent),
    path: note.path,
  }
}

type NotesFile = Record<string, { notes: unknown; touchedAt?: number }>

// `{}` missing vs `null` unreadable must stay apart: treating unreadable as empty wipes the file.
function readAll(file: string): NotesFile | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as NotesFile)
      : null
  } catch {
    return null
  }
}

const notesOf = (entry: NotesFile[string] | undefined): ReviewNote[] =>
  entry && Array.isArray(entry.notes)
    ? entry.notes
        .map(parseNote)
        .filter((note): note is ReviewNote => note !== null)
    : []

export function readNotes(
  rootDir: string,
  file = NOTES_FILE
): ReviewNote[] | null {
  const all = readAll(file)
  return all === null ? null : notesOf(all[rootDir])
}

export function loadNotes(rootDir: string, file = NOTES_FILE): ReviewNote[] {
  return readNotes(rootDir, file) ?? []
}

export interface SaveOptions {
  // Ids this session accounted for: a file-side note outside the set is another writer's, and kept.
  // Every id in `notes` must already be in the set, or a save doubles it.
  seen?: ReadonlySet<string>
  now?: number
  file?: string
}

export function saveNotes(
  rootDir: string,
  notes: ReviewNote[],
  options: SaveOptions = {}
): void {
  const { seen, now = Date.now(), file = NOTES_FILE } = options
  try {
    let all = readAll(file)
    if (all === null) {
      try {
        fs.renameSync(file, `${file}.corrupt-${now}`)
      } catch {
        // best-effort
      }
      all = {}
    }

    const held = notesOf(all[rootDir])
    const byId = new Map(held.map((note) => [note.id, note]))
    // The file's copy wins an id both sides hold: druk never changes a note after creating it.
    const merged = seen
      ? [
          ...notes.map((note) => byId.get(note.id) ?? note),
          ...held.filter((note) => !seen.has(note.id)),
        ]
      : notes
    // `merged`, not `notes`: druk's own list going empty may be a clear racing an external add.
    if (merged.length === 0) {
      Reflect.deleteProperty(all, rootDir)
    } else {
      all[rootDir] = { notes: merged, touchedAt: now }
    }

    // A writer that omits touchedAt gets this save's clock: epoch zero would be trimmed first.
    const trimmed = Object.entries(all)
      .toSorted((a, b) => (b[1].touchedAt ?? now) - (a[1].touchedAt ?? now))
      .slice(0, MAX_PROJECTS)

    writeAtomic(
      file,
      `${JSON.stringify(Object.fromEntries(trimmed), null, 2)}\n`
    )
  } catch {
    // best-effort
  }
}

// The directory, not the file: a rename-based save strands a watcher bound to the old inode.
export function watchNotes(
  onChange: () => void,
  file = NOTES_FILE
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const name = basename(file)
  try {
    fs.mkdirSync(dirname(file), { recursive: true })
  } catch {
    // best-effort
  }
  const watcher = watchPath(dirname(file), {}, (_event, filename) => {
    if (filename && filename.toString() !== name) {
      return
    }
    if (timer) {
      clearTimeout(timer)
    }
    // coalesce bursts
    timer = setTimeout(onChange, 80)
  })
  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    watcher?.close()
  }
}
