import type { TextEncoding } from '../core/fs'
import type { SearchOptions } from '../core/search'
import type { FetchableInstall } from '../lsp/servers'

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
  | { kind: 'commit'; paths: string[] }
  | { kind: 'undoCommit'; subject: string }
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
  /** A language server is missing and druk can fetch it; `id` is the server id. */
  | { kind: 'installServer'; id: string; name: string; install: FetchableInstall }
  /** Delete druk's own copy of a server. `packages` is what goes with it. */
  | { kind: 'uninstallServer'; id: string; name: string; packages: string[] }
  /**
   * A market extension is worth installing. `why` is what raised it (a file whose
   * language has no server, a config naming a theme nothing registers, or an
   * update), and `runs` names the commands the extension would have druk spawn —
   * the one thing about a manifest that is not inert.
   */
  | {
      kind: 'installExtension'
      id: string
      name: string
      summary: string
      why: string
      runs: string[]
      /** The version installed now, when this is an update rather than a first install. */
      current?: string
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
