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

/**
 * Prompts answered with text, and the title their input box carries. Having a
 * title here is what makes a prompt a text prompt — every other kind is a
 * yes/no confirm, so the two sets can never fall out of step.
 */
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
}

/**
 * The prompt signal alone, created before the controllers so that any of them can
 * open a prompt — the handlers below need those same controllers to answer one.
 */
export function createPromptState() {
  const [prompt, setPrompt] = createSignal<Prompt>(null)
  return { prompt, setPrompt }
}

export type PromptState = ReturnType<typeof createPromptState>

/** Answering prompts: what each one asks, and what saying yes actually does. */
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
}) {
  const { renderer, state, status, tree, panes, editor, workspace } = deps
  const { fileOps, git, gitOp, commitView, branches, lsp, market, review } = deps
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
    } else if (p.kind === 'newBranch') {
      branches.create(name, p.from)
    } else if (p.kind === 'renameBranch') {
      branches.rename(p.from, name)
    } else if (p.kind === 'reviewReply') {
      // Looked up now rather than held from when the prompt opened: an agent may
      // have struck the note off while the answer was being typed, and a reply
      // to a note that is gone is a remark hanging off nothing.
      const parent = review.notes().find(note => note.id === p.parent)
      if (!parent) return say('The remark this answers is gone', 'warn')
      review.reply(parent, value.trim())
    } else if (p.kind === 'reviewNote') {
      // `value`, not the trimmed `name`: a remark is prose, and the only thing
      // trimming it can do is lose an intended line break at the end of one.
      review.add({
        path: p.path,
        line: p.line,
        endLine: p.endLine,
        kind: p.noteKind,
        body: value.trim(),
      })
    }
  }

  /** A stash picked from the list: ask what to do with it. */
  const chooseStash = (ref: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'stashPick') return
    const entry = p.stashes.find(candidate => candidate.ref === ref)
    if (!entry) return
    setPrompt({ kind: 'stashAction', repo: p.repo, ref: entry.ref, message: entry.message })
  }

  /** Apply, pop or drop the stash the picker chose. */
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

  /** A remote picked for removal: it holds config, so a confirm stands before it. */
  const chooseRemoteRemove = (name: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'remoteRemove') return
    const remote = p.remotes.find(candidate => candidate.name === name)
    if (!remote) return
    setPrompt({ kind: 'remoteRemoveConfirm', repo: p.repo, name: remote.name, url: remote.url })
  }

  /** A commit picked from the file's history: open it over the editor slot. */
  const chooseHistoryCommit = (oid: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'fileHistory') return
    // The page sits above this one; leaving it up would hide the commit.
    workspace.setPage(null)
    commitView.open(p.repo, oid)
  }

  /** The kind chosen: the same prompt again, now asking for the words. */
  const chooseReviewKind = (kind: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'reviewKind') return
    const noteKind = NOTE_KINDS.find(candidate => candidate === kind)
    if (!noteKind) return
    setPrompt({ kind: 'reviewNote', path: p.path, line: p.line, endLine: p.endLine, noteKind })
  }

  /** The side chosen: the buffer keeps it and the markers go. */
  const chooseConflictSide = (side: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'mergeConflict') return
    if (side !== 'ours' && side !== 'theirs' && side !== 'both') return
    workspace.acceptConflict(p.line, side)
  }

  /**
   * Install a missing server with the manager picked from the choice modal.
   * Takes the id as the string the modal deals in and narrows it here, so the
   * row a `ChoiceModal` hands back needs no cast on the way through.
   */
  const chooseInstallServer = (manager: string) => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind !== 'installServer') return
    const chosen = p.managers.find(candidate => candidate === manager)
    if (chosen) void lsp.install(p.id, p.name, p.install, chosen)
  }

  /** Carry out whatever the open confirm prompt was asking about. */
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
      case 'deleteBranch':
        return branches.remove(p.name, p.force)
      case 'mergeBranch':
        return branches.merge(p.name)
      case 'pullPush':
        // touchesTree: the pull half rewrites files under open buffers.
        return gitOp('Pulling and pushing', repo => pullAndPush(repo, p.branch, p.hasUpstream), {
          touchesTree: { kind: 'sync' },
          done: () => `Pulled and pushed ${p.branch}`,
        })
      case 'replaceProject':
        return workspace.applyProjectReplace(p.paths, p.query, p.replacement, p.options)
      // An npm server is answered by the manager choice instead, and never
      // reaches this modal — `confirmation` returns null for it.
      case 'installServer':
        return p.install.kind === 'download' ? void lsp.install(p.id, p.name, p.install) : undefined
      case 'uninstallServer':
        return void lsp.uninstall(p.id)
      case 'installExtension':
        return market.accept(p.id)
      case 'uninstallExtension': {
        // The servers go first: removing the extension reloads the manifests,
        // and `lsp.uninstall` reads the spec it is about out of that registry —
        // after the reload there is nothing left to tell it what to delete.
        return void (async () => {
          // One at a time: the servers share one prefix, and two runs of a
          // package manager writing that tree at once is one neither can read.
          for (const server of p.servers) await lsp.uninstall(server.id)
          market.remove(p.id)
        })()
      }
    }
  }

  /**
   * Closing a confirm without going through with it. Most kinds simply vanish —
   * the two offers below are what have something left to say, since declining an
   * offer to fix something is not the same as the thing not being broken.
   */
  const cancelPrompt = () => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind === 'installServer') {
      say(`LSP: ${p.name} not installed — ${installHint(p.install)}`)
    }
    if (p?.kind === 'pullPush') say(PUSH_REJECTED, 'error')
    // Nothing to say — the offer was druk's idea — but the fetched manifest has
    // to be dropped, and the decline remembered for the session.
    if (p?.kind === 'installExtension') market.decline(p.id)
  }

  const promptTitle = () => {
    const p = prompt()
    if (!p) return undefined
    // The start point is the whole point of "New branch from…", so it belongs in
    // the title; the entry in PROMPT_TITLES is still what makes this a text prompt.
    if (p.kind === 'newBranch' && p.from) return `New branch from ${p.from}`
    // Which of the four, and which line — a note written against the wrong line
    // is worse than no note, and this is the last moment to notice.
    if (p.kind === 'reviewNote') {
      const span = p.endLine > p.line ? `${p.line + 1}-${p.endLine + 1}` : `${p.line + 1}`
      return `${NOTE_LABELS[p.noteKind]} · ${basename(p.path)}:${span}`
    }
    // Which remark is being answered — a thread is only a thread if the answer
    // is to the thing on screen, and this is the last moment to notice it is not.
    if (p.kind === 'reviewReply') return `Reply to ${p.heading}`
    // Which remote the URL is for — the name was the previous prompt's answer.
    if (p.kind === 'remoteAddUrl') return `URL for ${p.name}`
    return PROMPT_TITLES[p.kind]
  }
  const promptValue = () => {
    const p = prompt()
    if (p?.kind === 'rename') return basename(p.target)
    // Renaming usually adjusts a name rather than replacing it.
    if (p?.kind === 'renameBranch') return p.from
    // Amending usually adjusts the message rather than replacing it.
    if (p?.kind === 'commitAmend') return p.subject
    return ''
  }

  /**
   * What the confirm modal asks, per prompt kind. Narrowing on `p.kind` is what
   * types the payload fields here, so the JSX needs no casts.
   */
  const confirmation = createMemo<Confirmation | null>(() => {
    const p = prompt()
    switch (p?.kind) {
      case 'delete': {
        const only = p.targets.length === 1 ? p.targets[0]! : null
        return {
          title: 'Delete',
          verb: 'delete',
          danger: true,
          // Naming several files would run past the modal; the count is the thing
          // worth checking before agreeing to this one.
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
          // Naming the packages is the point: an npm server is a tree of them,
          // and `npm uninstall` takes what came with it as well.
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
      case 'installExtension':
        return {
          title: 'Extension available',
          verb: 'install it',
          danger: false,
          // The commands are the part worth reading before agreeing: a manifest
          // is data and installing it runs nothing, but a language server is a
          // program druk will spawn the next time a matching file opens.
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
    chooseReviewKind,
    chooseConflictSide,
    chooseStash,
    chooseStashAction,
    chooseTagDelete,
    chooseRemoteRemove,
    chooseHistoryCommit,
    cancelPrompt,
    promptTitle,
    promptValue,
    confirmation,
  }
}

export type PromptHandlers = ReturnType<typeof createPromptHandlers>
