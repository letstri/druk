/**
 * Reading code with a review beside you: the draft notes dropped on lines while
 * reading, and the pull-request comments fetched from whichever forge the
 * repository is on.
 *
 * The division is the panel's usual one — this owns the list, the cursor and
 * the fold state, `ui/ReviewPanel.tsx` draws whatever `rows()` returns and
 * reports clicks, and `app/keyboard.ts` holds the keys.
 *
 * Nothing here writes to a forge: the fetch is a read and only a read.
 */
import { basename, join, relative } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { fetchComments, findPullRequest, forgeFor } from '../core/forge'
import type { ForgeComment, PullRequest } from '../core/forge'
import { remoteUrl } from '../core/git'
import { loadNotes, NOTE_LABELS, saveNotes } from '../core/review'
import type { NoteKind, ReviewNote } from '../core/review'
import type { Git } from './git'
import type { Panes } from './panes'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Workspace } from './workspace'

/** A comment with the absolute path it belongs to, once one could be worked out. */
export interface AnchoredComment {
  comment: ForgeComment
  /** Absolute path, or null for a remark on the change as a whole. */
  path: string | null
}

export type ReviewRow =
  /** A file heading, or the one that holds the comments belonging to no file. */
  | { kind: 'file'; id: string; rel: string; count: number; collapsed: boolean }
  | { kind: 'note'; id: string; note: ReviewNote; label: string; text: string }
  | { kind: 'comment'; id: string; entry: AnchoredComment; label: string; text: string }
  /** An inert line — what there is to do when there is nothing in the list yet. */
  | { kind: 'hint'; id: string; label: string }

/** Comments that name no file are grouped under this heading. */
const GENERAL = 'On the pull request'

/** One line of a remark, for a row that has one line to draw it in. */
const oneLine = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

export function createReview(deps: {
  rootDir: string
  status: Status
  settings: Settings
  workspace: Workspace
  git: Git
  panes: Panes
}) {
  const { rootDir, status, settings, workspace, git, panes } = deps
  const { say } = status
  const { config } = settings

  const [notes, setNotes] = createSignal<ReviewNote[]>(loadNotes(rootDir))
  const [comments, setComments] = createSignal<AnchoredComment[]>([])
  const [pull, setPull] = createSignal<PullRequest | null>(null)
  const [fetching, setFetching] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = createSignal(0)

  /** Notes are the one thing here that outlives the session, so every write persists. */
  const writeNotes = (next: ReviewNote[]) => {
    setNotes(next)
    saveNotes(rootDir, next)
  }

  /** Ids only have to be unique within this list; the clock plus a counter is that. */
  let counter = 0
  const nextId = () => `${Date.now().toString(36)}-${counter++}`

  const add = (note: Omit<ReviewNote, 'id' | 'at'>) => {
    const full: ReviewNote = { ...note, id: nextId(), at: Date.now() }
    writeNotes([...notes(), full])
    const where = `${basename(note.path)}:${note.line + 1}`
    say(`${NOTE_LABELS[note.kind]} noted on ${where} — ${notes().length} in this review`)
  }

  const removeNote = (id: string) => {
    const held = notes().find(note => note.id === id)
    if (!held) return
    writeNotes(notes().filter(note => note.id !== id))
    say(`Removed the ${NOTE_LABELS[held.kind].toLowerCase()} on ${basename(held.path)}`)
  }

  const clear = () => {
    if (notes().length === 0) return say('No review notes to clear')
    const gone = notes().length
    writeNotes([])
    say(`Cleared ${gone} review note${gone === 1 ? '' : 's'}`)
  }

  /** Draft notes of one file, by line — the gutter marks and the inline text. */
  const notesFor = (path: string) => notes().filter(note => note.path === path)

  /** Fetched comments of one file, by line, for the same two. */
  const commentsFor = (path: string) =>
    comments().filter(entry => entry.path === path && entry.comment.line !== null)

  /**
   * What the editor draws beside a line: the draft notes and the fetched
   * comments of the open file, worst-case one per line. A line carrying both
   * shows the draft — it is this session's own remark, and the one still being
   * worked on.
   */
  const marks = createMemo(() => {
    const path = workspace.activePath()
    const byLine = new Map<number, { draft: boolean; label: string; text: string }>()
    if (!path) return byLine
    for (const entry of commentsFor(path)) {
      byLine.set(entry.comment.line!, {
        draft: false,
        label: `@${entry.comment.author || 'reviewer'}`,
        text: oneLine(entry.comment.body),
      })
    }
    for (const note of notesFor(path)) {
      byLine.set(note.line, {
        draft: true,
        label: NOTE_LABELS[note.kind],
        text: oneLine(note.body),
      })
    }
    return byLine
  })

  /** Everything in the review, grouped by file, files in path order. */
  const grouped = createMemo(() => {
    const groups = new Map<
      string,
      { rel: string; notes: ReviewNote[]; comments: AnchoredComment[] }
    >()
    const group = (path: string | null) => {
      const rel = path ? relative(rootDir, path) || basename(path) : GENERAL
      const held = groups.get(rel)
      if (held) return held
      const made = { rel, notes: [], comments: [] }
      groups.set(rel, made)
      return made
    }
    for (const note of notes()) group(note.path).notes.push(note)
    for (const entry of comments()) group(entry.path).comments.push(entry)
    return [...groups.values()].toSorted((a, b) =>
      // The general heading last: it is the only one that is not a file.
      a.rel === GENERAL ? 1 : b.rel === GENERAL ? -1 : a.rel.localeCompare(b.rel),
    )
  })

  const rows = createMemo<ReviewRow[]>(() => {
    const out: ReviewRow[] = []
    for (const entry of grouped()) {
      const shut = collapsed().has(entry.rel)
      out.push({
        kind: 'file',
        id: `file:${entry.rel}`,
        rel: entry.rel,
        count: entry.notes.length + entry.comments.length,
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
      }
      for (const held of entry.comments) {
        const line = held.comment.line
        out.push({
          kind: 'comment',
          id: held.comment.url || `${entry.rel}:${line}:${held.comment.body.slice(0, 16)}`,
          entry: held,
          label: `@${held.comment.author || 'reviewer'}${line === null ? '' : ` ${line + 1}`}`,
          text: oneLine(held.comment.body),
        })
      }
    }
    if (out.length === 0) {
      out.push({ kind: 'hint', id: 'empty', label: 'No notes yet — Ctrl+Opt+A on a line' })
      out.push({ kind: 'hint', id: 'fetch', label: 'f fetches the pull request' })
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

  /** The line one remark is about, or nothing for a comment on no file at all. */
  const placeOf = (remark: ReviewNote | AnchoredComment) =>
    'kind' in remark
      ? { path: remark.path, line: remark.line }
      : remark.path && remark.comment.line !== null
        ? { path: remark.path, line: remark.comment.line }
        : null

  /**
   * The remark the row at `index` speaks for, which is what both the editor
   * that follows the cursor and the card under the line are about.
   *
   * A heading answers with the first remark of its file rather than with
   * nothing: it is the row the cursor lands on when the panel opens, and a
   * review that shows no code until the second keypress is the thing this is
   * for. A collapsed group still answers — the remarks are hidden, not gone.
   */
  const remarkOf = (index = at()): ReviewNote | AnchoredComment | null => {
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current || current.kind === 'hint') return null
    if (current.kind === 'note') return current.note
    if (current.kind === 'comment') return current.entry
    const group = grouped().find(entry => entry.rel === current.rel)
    const held = [...(group?.notes ?? []), ...(group?.comments ?? [])]
    return held.find(remark => placeOf(remark)) ?? null
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
    if (!place || place.path !== path) return null
    return 'kind' in remark
      ? {
          line: place.line,
          draft: true,
          heading: NOTE_LABELS[remark.kind],
          body: remark.body,
        }
      : {
          line: place.line,
          draft: false,
          heading: `@${remark.comment.author || 'reviewer'}`,
          body: remark.comment.body,
        }
  })

  /** Enter: fold a heading, or land on the line the remark is about. */
  const activate = (index = at(), open?: (path: string, line: number) => void) => {
    moveTo(index)
    const current = row()
    if (!current || current.kind === 'hint') return
    if (current.kind === 'file') return toggleFile(current.rel)
    if (current.kind === 'note') return open?.(current.note.path, current.note.line)
    const { path, comment } = current.entry
    if (path && comment.line !== null) return open?.(path, comment.line)
    say(comment.url || 'This comment is about the whole pull request')
  }

  /** Backspace: drop a draft. A fetched comment is not druk's to remove. */
  const remove = () => {
    const current = row()
    if (current?.kind === 'comment') return say('That comment is on the forge, not here', 'warn')
    if (current?.kind !== 'note') return
    removeNote(current.note.id)
  }

  /**
   * The pull request open for this branch, and everything said on it.
   *
   * Every step reports what stopped it: no remote, a host druk cannot place, a
   * private repository, no open change for this branch. "Nothing happened" is
   * the one outcome a fetch the user asked for must never have — so `quiet`
   * silences exactly the outcomes that are facts about the checkout rather than
   * about this attempt, and never an error. It is what the fetch on opening the
   * panel uses: a repository with no pull request would otherwise say so every
   * time the sidebar changed view.
   */
  const fetchPullRequest = async (quiet = false) => {
    const absent = (message: string) => {
      if (!quiet) say(message, 'warn')
    }
    if (fetching()) return absent('Already fetching')
    const repo = git.activeRepo()
    if (!repo) return absent('Not a git repository')
    const branch = git.branch()
    if (!branch) return absent('No branch — a detached HEAD has no pull request')
    const url = remoteUrl(repo, config.reviewRemote)
    if (!url) return absent(`No "${config.reviewRemote}" remote to ask`)
    const target = forgeFor(url, config.reviewForge)
    if (!target.ok) return say(target.error, 'error')

    setFetching(true)
    if (!quiet) say(`Looking for ${branch} on ${target.value.host}…`)
    try {
      const found = await findPullRequest(target.value, branch)
      if (!found.ok) return say(found.error, 'error')
      if (!found.value) {
        if (!quiet) say(`No open pull request for ${branch}`)
        return
      }
      setPull(found.value)
      const said = await fetchComments(target.value, found.value)
      if (!said.ok) return say(said.error, 'error')
      // A forge reports paths from the repository root, which is not always the
      // folder druk was opened in.
      setComments(
        said.value.map(comment => ({
          comment,
          path: comment.path ? join(repo, comment.path) : null,
        })),
      )
      // Not while quiet: the panel is already up, and the fetch is slow enough
      // that the user may have tabbed into the editor — `showView` would take
      // the keyboard back from under them.
      if (!quiet) panes.showView('review')
      const count = said.value.length
      if (count > 0) say(`#${found.value.number}: ${count} comment${count === 1 ? '' : 's'}`)
      else if (!quiet) say(`#${found.value.number} "${found.value.title}" — no comments yet`)
    } finally {
      setFetching(false)
    }
  }

  /**
   * The fetch an opened panel makes for itself, which is what `reviewAutoFetch`
   * turns off: four unauthenticated requests land on GitHub's sixty an hour, and
   * a panel toggled often enough would spend them.
   */
  const autoFetch = () => {
    if (config.reviewAutoFetch) void fetchPullRequest(true)
  }

  return {
    notes,
    comments,
    pull,
    fetching,
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
    removeNote,
    clear,
    fetchPullRequest: () => void fetchPullRequest(),
    autoFetch,
    /** The header's count, which no fold narrows. */
    count: () => notes().length + comments().length,
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
