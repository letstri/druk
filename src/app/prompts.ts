import { basename, dirname, join } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { createDir, createFile, isDirectory } from '../core/fs'
import {
  addRemote,
  commitAmend,
  createTag,
  deleteTag,
  discardChange,
  pullAndPush,
  PUSH_REJECTED,
  removeRemote,
  stashApply,
  stashDrop,
  stashPopRef,
  undoLastCommit,
} from '../core/git'
import { NOTE_KINDS, NOTE_LABELS } from '../core/review'
import { SERVER_ROOT } from '../lsp/install'
import { installHint } from '../lsp/servers'
import type { Branches } from './branches'
import type { CommitView } from './commitView'
import type { EditorBridge } from './editor'
import type { FileOps } from './fileOps'
import { noRepository, runCommit } from './git'
import type { Git, GitOp } from './git'
import type { Lsp } from './lsp'
import type { Market } from './market'
import type { Panes } from './panes'
import type { Review } from './review'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Confirmation, Prompt, PromptKind } from './types'
import type { Workspace } from './workspace'
import type { Workspaces } from './workspaces'

// An entry here is what makes a prompt a text prompt; every other kind is a confirm.
const PROMPT_TITLES: Partial<Record<PromptKind, string>> = {
  newFile: 'New file name',
  newFolder: 'New folder name',
  rename: 'Rename to',
  gotoLine: 'Go to line',
  commit: 'Commit message',
  commitAmend: 'Amend commit message',
  newTag: 'New tag name',
  remoteAddName: 'Remote name',
  remoteAddUrl: 'Remote URL',
  newBranch: 'New branch name',
  renameBranch: 'Rename branch to',
  reviewNote: 'Review note',
  reviewReply: 'Reply',
  workspaceOpen: 'Open folder',
  newWorktree: 'New worktree branch',
}

export function createPromptState() {
  const [prompt, setPrompt] = createSignal<Prompt>(null)
  return { prompt, setPrompt }
}

export type PromptState = ReturnType<typeof createPromptState>

export function createPromptHandlers(deps: {
  renderer: { destroy: () => void }
  state: PromptState
  status: Status
  tree: Tree
  panes: Panes
  editor: EditorBridge
  workspace: Workspace
  fileOps: FileOps
  git: Git
  gitOp: GitOp
  commitView: CommitView
  branches: Branches
  lsp: Lsp
  market: Market
  review: Review
  workspaces: Workspaces
}) {
  const { renderer, state, status, tree, panes, editor, workspace } = deps
  const { fileOps, git, gitOp, commitView, branches, lsp, market, review, workspaces } = deps
  const { prompt, setPrompt } = state
  const { say } = status

  const quit = (discardUnsaved = false) => {
    const dirty = workspace.dirtyPaths()
    if (!discardUnsaved && dirty.length > 0) {
      return setPrompt({ kind: 'quitDirty', names: dirty.map(path => basename(path)) })
    }
    renderer.destroy()
    process.exit(0)
  }

  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt()
    setPrompt(null)
    if (!p || !PROMPT_TITLES[p.kind]) return
    if (!name) return say('Nothing entered', 'warn')

    if (p.kind === 'gotoLine') {
      const asked = Number.parseInt(name, 10)
      if (!Number.isInteger(asked) || asked < 1) return say(`Not a line number: ${name}`, 'error')
      const total = workspace.activeBuffer()?.content.split('\n').length ?? 1
      const line = Math.min(asked, total)
      editor.requestGoto(line - 1, 0)
      panes.setFocus('editor')
      say(line === asked ? `Line ${line}` : `Line ${line} — the file ends there`)
    } else if (p.kind === 'newFile') {
      const path = join(p.dir, name)
      const err = createFile(path)
      if (err) return say(err, 'error')
      tree.expand(p.dir)
      workspace.openFile(path)
      say(`Created ${name}`)
    } else if (p.kind === 'newFolder') {
      const path = join(p.dir, name)
      const err = createDir(path)
      if (err) return say(err, 'error')
      tree.expand(path)
      tree.setSelectedPath(path)
      say(`Created ${name}/`)
    } else if (p.kind === 'rename') {
      const err = fileOps.movePath(p.target, join(dirname(p.target), name))
      if (err) return say(err, 'error')
      say(`Renamed to ${name}`)
    } else if (p.kind === 'commit') {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      runCommit(gitOp, git, {
        repo,
        message: name,
        paths: p.paths,
        variant: p.variant,
        onPushRejected: (branch, hasUpstream) =>
          setPrompt({ kind: 'pullPush', branch, hasUpstream }),
      })
    } else if (p.kind === 'commitAmend') {
      gitOp('Amending', repo => commitAmend(repo, name), {
        repo: p.repo,
        done: () => `Amended "${p.subject}"`,
      })
    } else if (p.kind === 'newTag') {
      gitOp('Creating tag', repo => createTag(repo, name), {
        repo: p.repo,
        done: () => `Tagged ${name}`,
      })
    } else if (p.kind === 'remoteAddName') {
      setPrompt({ kind: 'remoteAddUrl', repo: p.repo, name })
    } else if (p.kind === 'remoteAddUrl') {
      gitOp('Adding remote', repo => addRemote(repo, p.name, name), {
        repo: p.repo,
        done: () => `Added remote ${p.name}`,
      })
    } else if (p.kind === 'workspaceOpen') {
      workspaces.switchTo(name)
    } else if (p.kind === 'newWorktree') {
      workspaces.createWorktree(p.repo, name)
    } else if (p.kind === 'newBranch') {
      branches.create(name, p.from)
    } else if (p.kind === 'renameBranch') {
      branches.rename(p.from, name)
    } else if (p.kind === 'reviewReply') {
      // Looked up now: another writer may have deleted the note while this was typed.
      const parent = review.notes().find(note => note.id === p.parent)
      if (!parent) return say('The remark this answers is gone', 'warn')
      review.reply(parent, value.trim())
    } else if (p.kind === 'reviewNote') {
      review.add({
        path: p.path,
        line: p.line,
        endLine: p.endLine,
        kind: p.noteKind,
        body: value.trim(),
      })
    }
  }

  const chooseStash = (ref: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'stashPick') return
    const entry = p.stashes.find(candidate => candidate.ref === ref)
    if (!entry) return
    setPrompt({ kind: 'stashAction', repo: p.repo, ref: entry.ref, message: entry.message })
  }

  const chooseStashAction = (action: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'stashAction') return
    if (action === 'drop') {
      return setPrompt({ kind: 'stashDrop', repo: p.repo, ref: p.ref, message: p.message })
    }
    if (action !== 'apply' && action !== 'pop') return
    gitOp(
      action === 'apply' ? 'Applying stash' : 'Popping stash',
      repo => (action === 'apply' ? stashApply(repo, p.ref) : stashPopRef(repo, p.ref)),
      {
        repo: p.repo,
        touchesTree: { kind: 'sync' },
        done: () => `${action === 'apply' ? 'Applied' : 'Popped'} ${p.ref}`,
      },
    )
  }

  const chooseTagDelete = (name: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'tagDelete' || !p.tags.includes(name)) return
    gitOp('Deleting tag', repo => deleteTag(repo, name), {
      repo: p.repo,
      done: () => `Deleted tag ${name}`,
    })
  }

  const chooseRemoteRemove = (name: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'remoteRemove') return
    const remote = p.remotes.find(candidate => candidate.name === name)
    if (!remote) return
    setPrompt({ kind: 'remoteRemoveConfirm', repo: p.repo, name: remote.name, url: remote.url })
  }

  const chooseHistoryCommit = (oid: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'fileHistory') return
    commitView.open(p.repo, oid)
  }

  const chooseWorkspace = (dir: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'workspacePick') return
    if (p.entries.some(entry => entry.path === dir)) workspaces.switchTo(dir)
  }

  const chooseWorktree = (path: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'worktreePick') return
    const tree = p.trees.find(candidate => candidate.path === path)
    if (!tree) return
    if (p.mode === 'switch') return workspaces.switchTo(tree.path)
    setPrompt({ kind: 'worktreeRemove', repo: p.repo, path: tree.path, branch: tree.branch })
  }

  const chooseReviewKind = (kind: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'reviewKind') return
    const noteKind = NOTE_KINDS.find(candidate => candidate === kind)
    if (!noteKind) return
    setPrompt({ kind: 'reviewNote', path: p.path, line: p.line, endLine: p.endLine, noteKind })
  }

  const chooseConflictSide = (side: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'mergeConflict') return
    if (side !== 'ours' && side !== 'theirs' && side !== 'both') return
    workspace.acceptConflict(p.line, side)
  }

  const chooseInstallServer = (manager: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'installServer') return
    const chosen = p.managers.find(candidate => candidate === manager)
    if (chosen) void lsp.install(p.id, p.name, p.install, chosen)
  }

  const chooseActivation = (choice: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'activateExtension') return
    if (p.choices.some(candidate => candidate.id === choice)) market.activate(choice)
  }

  const confirmPrompt = () => {
    const p = prompt()
    setPrompt(null)
    switch (p?.kind) {
      case 'delete':
        return fileOps.deleteTargets(p.targets)
      case 'closeDirty': {
        for (const path of p.paths) workspace.closeTab(path, true)
        return say(`Discarded unsaved edits in ${p.names.join(', ')}`, 'warn')
      }
      case 'quitDirty':
        return quit(true)
      case 'workspaceDirty':
        return workspaces.switchTo(p.dir, true)
      case 'undoCommit':
        return gitOp('Undoing commit', repo => undoLastCommit(repo), {
          done: () => `Undid "${p.subject}" — its changes are staged`,
        })
      case 'stashDrop':
        return gitOp('Dropping stash', repo => stashDrop(repo, p.ref), {
          repo: p.repo,
          done: () => `Dropped ${p.ref}`,
        })
      case 'remoteRemoveConfirm':
        return gitOp('Removing remote', repo => removeRemote(repo, p.name), {
          repo: p.repo,
          done: () => `Removed remote ${p.name}`,
        })
      case 'commitAll':
        return runCommit(gitOp, git, {
          repo: p.repo,
          message: p.message,
          paths: 'all',
          variant: p.variant,
          onPushRejected: (branch, hasUpstream) =>
            setPrompt({ kind: 'pullPush', branch, hasUpstream }),
        })
      case 'discardChange':
        return gitOp('Discarding', () => discardChange(p.target), {
          repo: p.target.repo,
          touchesTree: { kind: 'followDisk', paths: p.target.affectedPaths },
          done: () => `Discarded changes in ${basename(p.target.path)}`,
        })
      case 'worktreeRemove':
        return workspaces.removeWorktreeAt(p.repo, p.path)
      case 'deleteBranch':
        return branches.remove(p.name, p.force)
      case 'mergeBranch':
        return branches.merge(p.name)
      case 'pullPush':
        return gitOp('Pulling and pushing', repo => pullAndPush(repo, p.branch, p.hasUpstream), {
          touchesTree: { kind: 'sync' },
          done: () => `Pulled and pushed ${p.branch}`,
        })
      case 'replaceProject':
        return workspace.applyProjectReplace(p.paths, p.query, p.replacement, p.options)
      // An npm server is answered by the manager choice: `confirmation` returns null for it.
      case 'installServer':
        return p.install.kind === 'download' ? void lsp.install(p.id, p.name, p.install) : undefined
      case 'uninstallServer':
        return void lsp.uninstall(p.id)
      case 'installExtension':
        return market.accept(p.id)
      case 'activateExtension':
        return market.activate(p.choices[0]!.id)
      case 'uninstallExtension': {
        // Servers first: `lsp.uninstall` reads the registry the removal reloads; one at a time.
        return void (async () => {
          for (const server of p.servers) await lsp.uninstall(server.id)
          market.remove(p.id)
        })()
      }
    }
  }

  const cancelPrompt = () => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind === 'installServer') {
      say(`LSP: ${p.name} not installed — ${installHint(p.install)}`)
    }
    if (p?.kind === 'pullPush') say(PUSH_REJECTED, 'error')
    if (p?.kind === 'installExtension') market.decline(p.id)
  }

  const promptTitle = () => {
    const p = prompt()
    if (!p) return undefined
    if (p.kind === 'newBranch' && p.from) return `New branch from ${p.from}`
    if (p.kind === 'reviewNote') {
      const span = p.endLine > p.line ? `${p.line + 1}-${p.endLine + 1}` : `${p.line + 1}`
      return `${NOTE_LABELS[p.noteKind]} · ${basename(p.path)}:${span}`
    }
    if (p.kind === 'reviewReply') return `Reply to ${p.heading}`
    if (p.kind === 'remoteAddUrl') return `URL for ${p.name}`
    return PROMPT_TITLES[p.kind]
  }
  const promptValue = () => {
    const p = prompt()
    if (p?.kind === 'rename') return basename(p.target)
    if (p?.kind === 'renameBranch') return p.from
    if (p?.kind === 'commitAmend') return p.subject
    return ''
  }
  const promptHistory = () => {
    const p = prompt()
    return p?.kind === 'commit' || p?.kind === 'commitAmend' ? git.messageHistory() : undefined
  }

  const confirmation = createMemo<Confirmation | null>(() => {
    const p = prompt()
    switch (p?.kind) {
      case 'delete': {
        const only = p.targets.length === 1 ? p.targets[0]! : null
        return {
          title: 'Delete',
          verb: 'delete',
          danger: true,
          message: only
            ? `Delete "${basename(only)}"${isDirectory(only) ? ' and its contents' : ''}?`
            : `Delete these ${p.targets.length} items and anything inside them?`,
        }
      }
      case 'closeDirty':
        return {
          title: 'Unsaved changes',
          verb: 'close without saving',
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Close anyway?`,
        }
      case 'discardChange': {
        const source = p.target.affectedPaths[1]
        return {
          title: 'Discard changes',
          verb: 'discard',
          danger: true,
          message:
            source !== undefined
              ? `Discard rename "${basename(p.target.path)}" and restore "${basename(source)}" from HEAD? Staged and working-tree changes are lost. Unsaved edits in either open buffer will also be lost.`
              : p.target.mode === 'delete'
                ? `Discard changes in "${basename(p.target.path)}" and permanently delete it? Unsaved edits in its open buffer will also be lost.`
                : `Restore "${basename(p.target.path)}" from HEAD? Staged and working-tree changes are lost. Unsaved edits in its open buffer will also be lost.`,
        }
      }
      case 'quitDirty':
        return {
          title: 'Unsaved changes',
          verb: 'quit without saving',
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Quit anyway?`,
        }
      case 'workspaceDirty':
        return {
          title: 'Unsaved changes',
          verb: 'switch without saving',
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Open ${basename(p.dir)} anyway?`,
        }
      case 'replaceProject':
        return {
          title: 'Replace in project',
          verb: 'replace',
          danger: true,
          message: `Replace ${p.matches} ${p.matches === 1 ? 'match' : 'matches'} in ${p.files} ${p.files === 1 ? 'file' : 'files'}${p.flags}? Closed files are written straight to disk.`,
        }
      case 'undoCommit':
        return {
          title: 'Undo last commit',
          verb: 'undo it',
          danger: false,
          message: `Undo "${p.subject}"? Its changes come back as staged edits.`,
        }
      case 'commitAll':
        return {
          title: 'No staged changes',
          verb: 'commit all',
          danger: false,
          message: `Nothing is staged — commit all ${p.count} changed ${p.count === 1 ? 'file' : 'files'} directly?`,
        }
      case 'stashDrop':
        return {
          title: 'Drop stash',
          verb: 'drop it',
          danger: true,
          message: `Drop ${p.ref} ("${p.message}")? Its changes are lost.`,
        }
      case 'remoteRemoveConfirm':
        return {
          title: 'Remove remote',
          verb: 'remove it',
          danger: true,
          message: `Remove remote "${p.name}" (${p.url})? Branch tracking against it is dropped.`,
        }
      case 'worktreeRemove':
        return {
          title: 'Remove worktree',
          verb: 'remove it',
          danger: true,
          message: `Delete the checkout at ${p.path}${p.branch ? ` (${p.branch})` : ''}? The branch itself stays. Git refuses if it holds uncommitted changes.`,
        }
      case 'deleteBranch':
        return {
          title: p.force ? 'Delete branch (force)' : 'Delete branch',
          verb: 'delete it',
          danger: p.force,
          message: p.force
            ? `Delete "${p.name}" even if it has commits on no other branch? They are lost.`
            : `Delete "${p.name}"? Git refuses if it has commits that are not merged.`,
        }
      case 'mergeBranch':
        return {
          title: 'Merge branch',
          verb: 'merge it',
          danger: false,
          message: `Merge "${p.name}" into the current branch? Conflicts are left in the working tree.`,
        }
      case 'pullPush':
        return {
          title: 'Push rejected',
          verb: 'pull and push',
          danger: false,
          message: `origin/${p.branch} has commits you don't. Merge them in and push again?`,
        }
      case 'uninstallServer':
        return {
          title: 'Remove language server',
          verb: 'remove it',
          danger: true,
          message: `Delete druk's copy of ${p.name} from ${SERVER_ROOT}? This removes ${p.packages.join(', ')}.`,
        }
      case 'uninstallExtension':
        return {
          title: 'Uninstall extension',
          verb: 'uninstall it',
          danger: true,
          message:
            p.servers.length > 0
              ? `Delete ${p.name} and druk's copy of ${p.servers.map(server => server.name).join(', ')}?`
              : `Delete ${p.name}? Its folder in the extensions directory goes with it.`,
        }
      case 'installServer':
        if (p.install.kind !== 'download') return null
        return {
          title: 'Language server missing',
          verb: 'download it',
          danger: false,
          message: `${p.name} is not installed. Download it into ${SERVER_ROOT}?`,
        }
      // Several appearances are a `ChoiceModal` in Overlays, hence the null.
      case 'activateExtension': {
        const only = p.choices.length === 1 ? p.choices[0]! : null
        if (!only) return null
        return {
          title: 'Extension installed',
          verb: 'use it',
          danger: false,
          message: `${p.name} is installed. Use the ${only.label}?`,
        }
      }
      case 'installExtension':
        return {
          title: 'Extension available',
          verb: 'install it',
          danger: false,
          message: [
            p.why,
            `${p.name} adds ${p.summary}.`,
            p.runs.length > 0 ? `It runs: ${p.runs.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        }
      default:
        return null
    }
  })

  return {
    quit,
    submitPrompt,
    confirmPrompt,
    chooseInstallServer,
    chooseActivation,
    chooseReviewKind,
    chooseConflictSide,
    chooseStash,
    chooseStashAction,
    chooseTagDelete,
    chooseRemoteRemove,
    chooseHistoryCommit,
    chooseWorkspace,
    chooseWorktree,
    cancelPrompt,
    promptTitle,
    promptValue,
    promptHistory,
    confirmation,
  }
}

export type PromptHandlers = ReturnType<typeof createPromptHandlers>
