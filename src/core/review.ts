/**
 * Review notes: the remarks made while reading code, and where they are kept.
 *
 * A note is a line, a kind and a sentence — nothing else, because the whole
 * point is that writing one costs a keystroke and a line of typing. They are
 * kept beside the config rather than in the project, keyed by project path, as
 * `sessions.json` is: a draft remark is personal scratch, and a `.druk/` file
 * would land in somebody's commit the first time they staged everything.
 *
 * druk is not the file's only writer: the kinds are documented by what each
 * means to an agent, and an agent holding up its end edits `review.json` while
 * druk has it open. Everything below is shaped by that — writes land by
 * rename, an unreadable file is set aside rather than rewritten from nothing,
 * and a save merges with what another writer put there instead of clobbering
 * it.
 */
import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { CONFIG_FILE } from './config'

const NOTES_FILE = join(dirname(CONFIG_FILE), 'review.json')

/** Projects remembered before the least recently touched are dropped. */
const MAX_PROJECTS = 20

/**
 * What a remark is. The four are the ones a reviewer actually separates: a
 * defect, a change worth considering, a question, and a plain observation —
 * and an agent reading the export treats each differently.
 */
export const NOTE_KINDS = ['issue', 'suggestion', 'question', 'note'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_LABELS: Record<NoteKind, string> = {
  issue: 'ISSUE',
  suggestion: 'SUGGESTION',
  question: 'QUESTION',
  note: 'NOTE',
}

export interface ReviewNote {
  /** Stable across a rewrite of the list — what a delete addresses. */
  id: string
  /** Absolute path, so a note survives the tree being reopened elsewhere. */
  path: string
  /** 0-based, as every line number in druk is. */
  line: number
  /** Last line of the span; equal to `line` for a note on one line. */
  endLine: number
  kind: NoteKind
  body: string
  /** Epoch ms — the order notes were written in, which is the order they read in. */
  at: number
}

const isKind = (raw: unknown): raw is NoteKind => NOTE_KINDS.includes(raw as NoteKind)

function parseNote(raw: unknown): ReviewNote | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const note = raw as Record<string, unknown>
  if (typeof note.id !== 'string' || typeof note.path !== 'string') return null
  if (typeof note.line !== 'number' || typeof note.body !== 'string') return null
  if (!isKind(note.kind)) return null
  const line = Math.max(0, Math.floor(note.line))
  const endLine = typeof note.endLine === 'number' ? Math.max(line, Math.floor(note.endLine)) : line
  return {
    id: note.id,
    path: note.path,
    line,
    endLine,
    kind: note.kind,
    body: note.body,
    at: typeof note.at === 'number' ? note.at : 0,
  }
}

type NotesFile = Record<string, { notes: unknown; touchedAt?: number }>

/**
 * The whole file: `{}` for a missing one, `null` for one that exists but does
 * not read as an object. The two must stay apart — treating an unreadable
 * file as empty means rewriting it from nothing, which wipes every project's
 * notes the moment a torn or foreign write is caught mid-read.
 */
function readAll(file: string): NotesFile | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as NotesFile)
      : null
  } catch {
    return null
  }
}

const notesOf = (entry: NotesFile[string] | undefined): ReviewNote[] =>
  entry && Array.isArray(entry.notes)
    ? entry.notes.map(parseNote).filter((note): note is ReviewNote => note !== null)
    : []

/**
 * This project's notes, or `null` for a file that exists but cannot be read.
 * The caller decides what that means: "no notes" at startup, "not now" on a
 * reload that may have caught another writer mid-file.
 */
export function readNotes(rootDir: string, file = NOTES_FILE): ReviewNote[] | null {
  const all = readAll(file)
  return all === null ? null : notesOf(all[rootDir])
}

/** This project's notes. Anything unreadable means "no notes", never an error. */
export function loadNotes(rootDir: string, file = NOTES_FILE): ReviewNote[] {
  return readNotes(rootDir, file) ?? []
}

export interface SaveOptions {
  /**
   * Ids this session has accounted for — loaded at startup, created here, or
   * adopted from a watch event. A file-side note outside the set was written
   * by another process while this one held its stale copy, so it is kept; one
   * inside the set but absent from `notes` was removed here, and stays gone.
   * Every id in `notes` must already be in the set, or a save can double it.
   */
  seen?: ReadonlySet<string>
  now?: number
  file?: string
}

export function saveNotes(rootDir: string, notes: ReviewNote[], options: SaveOptions = {}): void {
  const { seen, now = Date.now(), file = NOTES_FILE } = options
  try {
    let all = readAll(file)
    if (all === null) {
      // Somebody's data either way — set it aside where a human can recover
      // it, and only then start fresh.
      try {
        fs.renameSync(file, `${file}.corrupt-${now}`)
      } catch {
        // the rename failing leaves only writing over it
      }
      all = {}
    }

    const held = notesOf(all[rootDir])
    const byId = new Map(held.map(note => [note.id, note]))
    // The file's copy wins for an id both sides hold: druk never changes a
    // note after creating it, so any difference is another writer's newer
    // intent. The entry goes only when the *merged* list is empty — druk's
    // list alone being empty may just be a clear racing an external add.
    const merged = seen
      ? [
          ...notes.map(note => byId.get(note.id) ?? note),
          ...held.filter(note => !seen.has(note.id)),
        ]
      : notes
    if (merged.length === 0) delete all[rootDir]
    else all[rootDir] = { notes: merged, touchedAt: now }

    // A writer that omits touchedAt gets this save's clock, not epoch zero —
    // sorting it to the bottom would make it the trim's first casualty.
    const trimmed = Object.entries(all)
      .toSorted((a, b) => (b[1].touchedAt ?? now) - (a[1].touchedAt ?? now))
      .slice(0, MAX_PROJECTS)

    fs.mkdirSync(dirname(file), { recursive: true })
    // Written beside and renamed into place, so a reader in another process
    // can never catch half a file.
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(trimmed), null, 2)}\n`)
    try {
      fs.renameSync(tmp, file)
    } catch (error) {
      try {
        fs.unlinkSync(tmp)
      } catch {
        // the temp file outliving the failure is noise, not damage
      }
      throw error
    }
  } catch {
    // best-effort — losing a draft note is never worth interrupting the editor
  }
}

/**
 * Report writes to the notes file. The watch is on the directory, not the
 * file: saves land by rename, which strands a watcher bound to the replaced
 * file's inode, and only the directory sees the file's first-ever creation.
 * Returns a stop function; best-effort, as every watcher here is.
 */
export function watchNotes(onChange: () => void, file = NOTES_FILE): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: fs.FSWatcher | null = null
  const name = basename(file)
  try {
    fs.mkdirSync(dirname(file), { recursive: true })
    watcher = fs.watch(dirname(file), (_event, filename) => {
      if (filename && filename.toString() !== name) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 80) // coalesce bursts, as watchTree does
    })
  } catch {
    // best-effort: the notes just go unwatched
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
