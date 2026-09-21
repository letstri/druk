export interface Snapshot {
  content: string
  // Cursor offset before the edit.
  cursor: number
}

export const BURST_MS = 400

const LIMIT = 200

export class History {
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  private pending: Snapshot | null = null
  private lastEditAt = 0
  private current: Snapshot

  constructor(current: Snapshot) {
    this.current = current
  }

  record(next: Snapshot, now: number): void {
    if (next.content === this.current.content) {
      return
    }

    if (this.pending && now - this.lastEditAt > BURST_MS) {
      this.commit()
    }
    // The incoming edit's cursor, not `current`'s: that one is an edit stale.
    if (!this.pending) {
      this.pending = { content: this.current.content, cursor: next.cursor }
    }

    this.current = next
    this.lastEditAt = now
    this.redoStack.length = 0
  }

  undo(): Snapshot | null {
    this.commit()
    const previous = this.undoStack.pop()
    if (!previous) {
      return null
    }
    this.redoStack.push(this.current)
    this.current = previous
    return previous
  }

  redo(): Snapshot | null {
    const next = this.redoStack.pop()
    if (!next) {
      return null
    }
    this.undoStack.push(this.current)
    this.current = next
    return next
  }

  reset(snapshot: Snapshot): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.pending = null
    this.current = snapshot
  }

  private commit(): void {
    if (!this.pending) {
      return
    }
    this.undoStack.push(this.pending)
    if (this.undoStack.length > LIMIT) {
      this.undoStack.shift()
    }
    this.pending = null
  }
}
