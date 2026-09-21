import type { TextEncoding } from '../core/fs'
import type { DiscardTarget, Remote, StashEntry, Worktree } from '../core/git'
import type { NoteKind } from '../core/review'
import type { SearchOptions } from '../core/search'
import type { WorkspaceEntry } from '../core/workspaces'
import type { PackageManager } from '../lsp/install'
import type { FetchableInstall } from '../lsp/servers'
import type { CommitVariant } from './git'

export type Focus = 'tree' | 'editor'

export interface FileBuffer {
  // Always LF and never BOM-prefixed — see `TextEncoding`.
  content: string
  saved: string
  dirty: boolean
  mtime: number
  encoding: TextEncoding
}

export interface DiskSync {
  changed: string[]
  deleted: string[]
}

export interface Conflict {
  path: string
  disk: string
  encoding: TextEncoding
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
  // `paths` null commits the index as it stands.
  | { kind: 'commit'; paths: string[] | null; variant: CommitVariant }
  | { kind: 'commitAmend'; subject: string; repo: string }
  | {
      kind: 'commitAll'
      message: string
      variant: CommitVariant
      repo: string
      count: number
    }
  | { kind: 'undoCommit'; subject: string }
  | { kind: 'stashPick'; repo: string; stashes: StashEntry[] }
  | { kind: 'stashAction'; repo: string; ref: string; message: string }
  | { kind: 'stashDrop'; repo: string; ref: string; message: string }
  | { kind: 'newTag'; repo: string }
  | { kind: 'tagDelete'; repo: string; tags: string[] }
  | { kind: 'remoteAddName'; repo: string }
  | { kind: 'remoteAddUrl'; repo: string; name: string }
  | { kind: 'remoteRemove'; repo: string; remotes: Remote[] }
  | { kind: 'remoteRemoveConfirm'; repo: string; name: string; url: string }
  | {
      kind: 'fileHistory'
      repo: string
      commits: { oid: string; subject: string }[]
    }
  | { kind: 'discardChange'; target: DiscardTarget }
  // `from` null starts at HEAD.
  | { kind: 'newBranch'; from: string | null }
  | { kind: 'renameBranch'; from: string }
  | { kind: 'deleteBranch'; name: string; force: boolean }
  | { kind: 'mergeBranch'; name: string }
  | { kind: 'pullPush'; branch: string; hasUpstream: boolean }
  | {
      kind: 'replaceProject'
      query: string
      replacement: string
      options: SearchOptions
      paths: string[]
      matches: number
      files: number
      flags: string
    }
  | { kind: 'reviewKind'; path: string; line: number; endLine: number }
  | { kind: 'mergeConflict'; line: number; ours: string; theirs: string }
  | {
      kind: 'reviewNote'
      path: string
      line: number
      endLine: number
      noteKind: NoteKind
    }
  | { kind: 'reviewReply'; parent: string; heading: string }
  | {
      kind: 'installServer'
      id: string
      name: string
      install: FetchableInstall
      managers: PackageManager[]
    }
  | { kind: 'uninstallServer'; id: string; name: string; packages: string[] }
  | {
      kind: 'installExtension'
      id: string
      name: string
      summary: string
      why: string
      runs: string[]
    }
  // A choice id is `theme:<id>` or `icons:<id>`; `more` counts what the modal had no rows for.
  | {
      kind: 'activateExtension'
      name: string
      choices: { id: string; label: string }[]
      more: number
    }
  | {
      kind: 'uninstallExtension'
      id: string
      name: string
      servers: { id: string; name: string }[]
    }
  | { kind: 'workspacePick'; entries: WorkspaceEntry[] }
  | { kind: 'newWorktree'; repo: string }
  // `current` is the resolved path (`resolvedPath`) of the open folder.
  | {
      kind: 'worktreePick'
      repo: string
      mode: 'switch' | 'remove'
      trees: Worktree[]
      current: string
    }
  | {
      kind: 'worktreeRemove'
      repo: string
      path: string
      branch: string | null
    }
  | { kind: 'workspaceOpen' }
  | { kind: 'workspaceDirty'; dir: string; names: string[] }
  | null

export type PromptKind = NonNullable<Prompt>['kind']

export interface Confirmation {
  title: string
  message: string
  verb: string
  danger: boolean
}
