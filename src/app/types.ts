import type { TextEncoding } from '../core/fs'
import type { DiscardTarget, Remote, StashEntry } from '../core/git'
import type { NoteKind } from '../core/review'
import type { SearchOptions } from '../core/search'
import type { PackageManager } from '../lsp/install'
import type { FetchableInstall } from '../lsp/servers'
import type { CommitVariant } from './git'

/** Which pane owns the keyboard when no overlay is open. */
export type Focus = 'tree' | 'editor'

export interface FileBuffer {
  /** Always LF and never BOM-prefixed — see `TextEncoding` for why. */
  content: string
  dirty: boolean
  /** Disk mtime this buffer was last in sync with; used to detect outside edits. */
  mtime: number
  /** What the file was spelled as on disk, restored by every write. */
  encoding: TextEncoding
}

/** Dirty buffers a disk sync refused to touch, split by what happened to the file. */
export interface DiskSync {
  changed: string[]
  deleted: string[]
}

/** An unsaved buffer whose file also changed on disk. */
export interface Conflict {
  path: string
  disk: string
  /** How the disk version is spelled, so accepting it adopts that too. */
  encoding: TextEncoding
  /** The file is gone: there is no outside version to accept. */
  deleted: boolean
}

export type Prompt =
  | { kind: 'gotoLine' }
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; target: string }
  | { kind: 'delete'; targets: string[] }
  | { kind: 'closeDirty'; paths: string[]; names: string[] }
  | { kind: 'quitDirty'; names: string[] }
  /** `paths` null commits the index as it stands — what the panel's Space built. */
  | { kind: 'commit'; paths: string[] | null; variant: CommitVariant }
  /** Rewrite the last commit; `subject` prefills the prompt with its message. */
  | { kind: 'commitAmend'; subject: string; repo: string }
  /**
   * Nothing is staged and the box's message is ready: VS Code's "commit all
   * changes directly?" offer. The paths are resolved when the commit runs, so
   * `count` is what the confirm shows, not what it commits.
   */
  | { kind: 'commitAll'; message: string; variant: CommitVariant; repo: string; count: number }
  | { kind: 'undoCommit'; subject: string }
  /** The Stashes… picker, then what to do with the one picked. */
  | { kind: 'stashPick'; repo: string; stashes: StashEntry[] }
  | { kind: 'stashAction'; repo: string; ref: string; message: string }
  | { kind: 'stashDrop'; repo: string; ref: string; message: string }
  | { kind: 'newTag'; repo: string }
  | { kind: 'tagDelete'; repo: string; tags: string[] }
  /** Adding a remote asks the name first, then the URL — two prompts, one flow. */
  | { kind: 'remoteAddName'; repo: string }
  | { kind: 'remoteAddUrl'; repo: string; name: string }
  | { kind: 'remoteRemove'; repo: string; remotes: Remote[] }
  | { kind: 'remoteRemoveConfirm'; repo: string; name: string; url: string }
  /** The active file's commits; picking one opens it in the commit page. */
  | { kind: 'fileHistory'; repo: string; commits: { oid: string; subject: string }[] }
  | { kind: 'discardChange'; target: DiscardTarget }
  /** `from` is the branch to start at, or null for HEAD. */
  | { kind: 'newBranch'; from: string | null }
  | { kind: 'renameBranch'; from: string }
  | { kind: 'deleteBranch'; name: string; force: boolean }
  | { kind: 'mergeBranch'; name: string }
  /** A push origin refused; `hasUpstream` is what the retry after the pull needs. */
  | { kind: 'pullPush'; branch: string; hasUpstream: boolean }
  /**
   * Replace across the project. `paths` is the set the confirm approved —
   * data only, so the prompt handlers can run the apply without reaching
   * into the panel that raised it.
   */
  | {
      kind: 'replaceProject'
      query: string
      replacement: string
      options: SearchOptions
      paths: string[]
      matches: number
      files: number
      /** The active toggles, restated so the user confirms what will run. */
      flags: string
    }
  /**
   * A review note is being written. The kind is asked for first — a chooser,
   * since the four read differently to an agent — and the text second, so the
   * pair is two prompt kinds rather than one modal that does both.
   */
  | { kind: 'reviewKind'; path: string; line: number; endLine: number }
  | {
      kind: 'reviewNote'
      path: string
      line: number
      endLine: number
      noteKind: NoteKind
    }
  /**
   * An answer to a remark. `parent` is the note it hangs off — the id and not
   * the note, since the list may be rewritten by another writer while the
   * prompt is open, and the id is what survives that.
   */
  | { kind: 'reviewReply'; parent: string; heading: string }
  /** A language server is missing and druk can fetch it; `id` is the server id. */
  | {
      kind: 'installServer'
      id: string
      name: string
      install: FetchableInstall
      managers: PackageManager[]
    }
  /** Delete druk's own copy of a server. `packages` is what goes with it. */
  | { kind: 'uninstallServer'; id: string; name: string; packages: string[] }
  /**
   * A market extension is worth installing. `why` is what raised it (a file whose
   * language has no server, or a config naming a theme nothing registers), and
   * `runs` names the commands the extension would have druk spawn — the one
   * thing about a manifest that is not inert. Only ever a first install: an
   * update of something already installed applies itself without a prompt.
   */
  | {
      kind: 'installExtension'
      id: string
      name: string
      summary: string
      why: string
      runs: string[]
    }
  /**
   * Delete an installed extension. `servers` names the language servers druk
   * fetched for it, which go with it — the one part of an uninstall that reaches
   * outside the extensions folder.
   */
  | {
      kind: 'uninstallExtension'
      id: string
      name: string
      servers: { id: string; name: string }[]
    }
  | null

export type PromptKind = NonNullable<Prompt>['kind']

/** What a yes/no prompt asks and how loudly it asks it. */
export interface Confirmation {
  title: string
  message: string
  verb: string
  danger: boolean
}
