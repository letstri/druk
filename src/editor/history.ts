/**
 * Undo history for one buffer.
 *
 * The native buffer has its own undo, but it steps one keystroke at a time,
 * which makes reverting a sentence a dozen presses. This records whole edit
 * bursts instead: consecutive changes collapse into a single entry until the
 * typing pauses, so one undo removes the word you just typed.
 */

export interface Snapshot {
  content: string
  /** Cursor offset before the edit, so undo puts the caret back where it was. */
  cursor: number
}

/** Edits closer together than this belong to the same undo step. */
export const BURST_MS = 400

/** Entries kept per file; older ones are dropped. */
const LIMIT = 200

export class History {
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  /** State before the burst in progress, promoted to the stack when it ends. */
  private pending: Snapshot | null = null
  private lastEditAt = 0

  constructor(private current: Snapshot) {}

  /** Record an edit. `now` is injectable so tests do not have to sleep. */
  record(next: Snapshot, now: number): void {
    if (next.content === this.current.content) return

    // A pause ends the burst: whatever was pending becomes its own undo step.
    if (this.pending && now - this.lastEditAt > BURST_MS) this.commit()
    // The step keeps the *incoming* edit's cursor, not `current`'s: `current.cursor`
    // is where the caret sat before the edit that produced it, one edit stale — and
    // for a file's first burst it is the offset the buffer was opened at, so undoing
    // a character typed at line 500 dropped the caret at the top of the file.
    if (!this.pending) this.pending = { content: this.current.content, cursor: next.cursor }

    this.current = next
    this.lastEditAt = now
    this.redoStack.length = 0
  }

  undo(): Snapshot | null {
    this.commit()
    const previous = this.undoStack.pop()
    if (!previous) return null
    this.redoStack.push(this.current)
    this.current = previous
    return previous
  }

  redo(): Snapshot | null {
    const next = this.redoStack.pop()
    if (!next) return null
    this.undoStack.push(this.current)
    this.current = next
    return next
  }

  /**
   * Adopt `snapshot` as the current state without recording a step — for text
   * that arrives from outside the editor, such as a reload from disk.
   */
  reset(snapshot: Snapshot): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.pending = null
    this.current = snapshot
  }

  private commit(): void {
    if (!this.pending) return
    this.undoStack.push(this.pending)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.pending = null
  }
}
