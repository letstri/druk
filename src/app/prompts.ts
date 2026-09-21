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
  stashPop,
  undoLastCommit,
} from '../core/git'
import { NOTE_KINDS, NOTE_LABELS } from '../core/review'
import { SERVER_ROOT } from '../lsp/install'
import { installHint } from '../lsp/servers'
import { symbolHits } from '../lsp/symbols'
import type { Branches } from './branches'
import type { CommitView } from './commitView'
import type { EditorBridge } from './editor'
import type { FileOps } from './fileOps'
import { noRepository, runCommit } from './git'
import type { Git, GitOp } from './git'
import type { Lsp } from './lsp'
import type { Market } from './market'
import type { Navigation } from './navigation'
import type { Panes } from './panes'
import type { Review } from './review'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Confirmation, Prompt, PromptKind } from './types'
import type { Workspace } from './workspace'
import type { Workspaces } from './workspaces'

// An entry here is what makes a prompt a text prompt; every other kind is a confirm.
const PROMPT_TITLES: Partial<Record<PromptKind, string>> = {
  commit: 'Commit message',
  commitAmend: 'Amend commit message',
  gotoLine: 'Go to line',
  newBranch: 'New branch name',
  newFile: 'New file name',
  newFolder: 'New folder name',
  newTag: 'New tag name',
  newWorktree: 'New worktree branch',
  remoteAddName: 'Remote name',
  remoteAddUrl: 'Remote URL',
  rename: 'Rename to',
  renameBranch: 'Rename branch to',
  reviewNote: 'Review note',
  reviewReply: 'Reply',
  workspaceOpen: 'Open folder',
  workspaceSymbol: 'Workspace symbol',
}

export function createPromptState() {
  const [prompt, setPrompt] = createSignal<Prompt>(null)
  return { prompt, setPrompt }
}

export type PromptState = ReturnType<typeof createPromptState>

export function createPromptHandlers(deps: {
  rootDir: string
  renderer: { destroy: () => void }
  state: PromptState
  status: Status
  tree: Tree
  panes: Panes
  editor: EditorBridge
  workspace: Workspace
  navigation: Navigation
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
  const { renderer, rootDir, state, status, tree, panes, editor, workspace } =
    deps
  const {
    fileOps,
    git,
    gitOp,
    commitView,
    branches,
    lsp,
    market,
    navigation,
    review,
    workspaces,
  } = deps
  const { prompt, setPrompt } = state
  const { say } = status

  const quit = (discardUnsaved = false) => {
    const dirty = workspace.dirtyPaths()
    if (!discardUnsaved && dirty.length > 0) {
      return setPrompt({
        kind: 'quitDirty',
        names: dirty.map((path) => basename(path)),
      })
    }
    renderer.destroy()
    process.exit(0)
  }

  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt()
    setPrompt(null)
    if (!p || !PROMPT_TITLES[p.kind]) {
      return
    }
    if (!name) {
      return say('Nothing entered', 'warn')
    }

    if (p.kind === 'gotoLine') {
      const asked = Number(name)
      if (!Number.isInteger(asked) || asked < 1) {
        return say(`Not a line number: ${name}`, 'error')
      }
      const total = workspace.activeBuffer()?.content.split('\n').length ?? 1
      const line = Math.min(asked, total)
      editor.requestGoto(line - 1, 0)
      panes.setFocus('editor')
      say(
        line === asked ? `Line ${line}` : `Line ${line} — the file ends there`
      )
    } else if (p.kind === 'newFile') {
      const path = join(p.dir, name)
      const err = createFile(path)
      if (err) {
        return say(err, 'error')
      }
      tree.expand(p.dir)
      workspace.openFile(path)
      say(`Created ${name}`)
    } else if (p.kind === 'newFolder') {
      const path = join(p.dir, name)
      const err = createDir(path)
      if (err) {
        return say(err, 'error')
      }
      tree.expand(path)
      tree.setSelectedPath(path)
      say(`Created ${name}/`)
    } else if (p.kind === 'rename') {
      const err = fileOps.movePath(p.target, join(dirname(p.target), name))
      if (err) {
        return say(err, 'error')
      }
      say(`Renamed to ${name}`)
    } else if (p.kind === 'commit') {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      runCommit(gitOp, git, {
        message: name,
        onPushRejected: (branch, hasUpstream) =>
          setPrompt({ branch, hasUpstream, kind: 'pullPush' }),
        paths: p.paths,
        repo,
        variant: p.variant,
      })
    } else if (p.kind === 'commitAmend') {
      gitOp('Amending', (repo) => commitAmend(repo, name), {
        done: () => `Amended "${p.subject}"`,
        repo: p.repo,
      })
    } else if (p.kind === 'newTag') {
      gitOp('Creating tag', (repo) => createTag(repo, name), {
        done: () => `Tagged ${name}`,
        repo: p.repo,
      })
    } else if (p.kind === 'remoteAddName') {
      setPrompt({ kind: 'remoteAddUrl', name, repo: p.repo })
    } else if (p.kind === 'remoteAddUrl') {
      gitOp('Adding remote', (repo) => addRemote(repo, p.name, name), {
        done: () => `Added remote ${p.name}`,
        repo: p.repo,
      })
    } else if (p.kind === 'workspaceSymbol') {
      void (async () => {
        const hits = symbolHits(
          await lsp.symbols(p.path, name),
          p.path,
          rootDir
        )
        if (hits.length === 0) {
          return say(`No symbol matches "${name}"`)
        }
        // The request may outlive the keyboard: whatever the user opened meanwhile wins.
        if (prompt()) {
          return
        }
        setPrompt({ hits, kind: 'lspLocations', title: `Symbols · ${name}` })
      })()
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
      const parent = review.notes().find((note) => note.id === p.parent)
      if (!parent) {
        return say('The remark this answers is gone', 'warn')
      }
      review.reply(parent, value.trim())
    } else if (p.kind === 'reviewNote') {
      review.add({
        body: value.trim(),
        endLine: p.endLine,
        kind: p.noteKind,
        line: p.line,
        path: p.path,
      })
    }
  }

  // Every chooser takes an id off a list it put up: the prompt closes, and the pick is
  // honoured only while that same prompt is still the one asking.
  const choosing =
    <K extends NonNullable<Prompt>['kind']>(
      kind: K,
      take: (ask: Extract<Prompt, { kind: K }>, id: string) => void
    ) =>
    (id: string) => {
      const ask = prompt()
      setPrompt(null)
      if (ask?.kind === kind) {
        take(ask as Extract<Prompt, { kind: K }>, id)
      }
    }

  const chooseStash = choosing('stashPick', (p, ref) => {
    const entry = p.stashes.find((candidate) => candidate.ref === ref)
    if (!entry) {
      return
    }
    setPrompt({
      kind: 'stashAction',
      message: entry.message,
      ref: entry.ref,
      repo: p.repo,
    })
  })

  const chooseStashAction = choosing('stashAction', (p, action) => {
    if (action === 'drop') {
      return setPrompt({
        kind: 'stashDrop',
        message: p.message,
        ref: p.ref,
        repo: p.repo,
      })
    }
    if (action !== 'apply' && action !== 'pop') {
      return
    }
    gitOp(
      action === 'apply' ? 'Applying stash' : 'Popping stash',
      (repo) =>
        action === 'apply' ? stashApply(repo, p.ref) : stashPop(repo, p.ref),
      {
        done: () => `${action === 'apply' ? 'Applied' : 'Popped'} ${p.ref}`,
        repo: p.repo,
        touchesTree: { kind: 'sync' },
      }
    )
  })

  const chooseTagDelete = choosing('tagDelete', (p, name) => {
    if (!p.tags.includes(name)) {
      return
    }
    gitOp('Deleting tag', (repo) => deleteTag(repo, name), {
      done: () => `Deleted tag ${name}`,
      repo: p.repo,
    })
  })

  const chooseRemoteRemove = choosing('remoteRemove', (p, name) => {
    const remote = p.remotes.find((candidate) => candidate.name === name)
    if (!remote) {
      return
    }
    setPrompt({
      kind: 'remoteRemoveConfirm',
      name: remote.name,
      repo: p.repo,
      url: remote.url,
    })
  })

  const chooseLocation = choosing('lspLocations', (p, index) => {
    const hit = p.hits[Number(index)]
    if (hit) {
      navigation.open(hit.path, hit.line, hit.col)
    }
  })

  const chooseHistoryCommit = choosing('fileHistory', (p, oid) => {
    commitView.open(p.repo, oid)
  })

  const chooseWorkspace = choosing('workspacePick', (p, dir) => {
    if (p.entries.some((entry) => entry.path === dir)) {
      workspaces.switchTo(dir)
    }
  })

  const chooseWorktree = choosing('worktreePick', (p, path) => {
    const worktree = p.trees.find((candidate) => candidate.path === path)
    if (!worktree) {
      return
    }
    if (p.mode === 'switch') {
      return workspaces.switchTo(worktree.path)
    }
    setPrompt({
      branch: worktree.branch,
      kind: 'worktreeRemove',
      path: worktree.path,
      repo: p.repo,
    })
  })

  const chooseReviewKind = choosing('reviewKind', (p, kind) => {
    const noteKind = NOTE_KINDS.find((candidate) => candidate === kind)
    if (!noteKind) {
      return
    }
    setPrompt({
      endLine: p.endLine,
      kind: 'reviewNote',
      line: p.line,
      noteKind,
      path: p.path,
    })
  })

  const chooseConflictSide = choosing('mergeConflict', (p, side) => {
    if (side !== 'ours' && side !== 'theirs' && side !== 'both') {
      return
    }
    workspace.acceptConflict(p.line, side)
  })

  const chooseInstallServer = choosing('installServer', (p, manager) => {
    const chosen = p.managers.find((candidate) => candidate === manager)
    if (chosen) {
      void lsp.install(p.id, p.name, p.install, chosen)
    }
  })

  const chooseActivation = choosing('activateExtension', (p, choice) => {
    if (p.choices.some((candidate) => candidate.id === choice)) {
      market.activate(choice)
    }
  })

  const confirmPrompt = () => {
    const p = prompt()
    setPrompt(null)
    switch (p?.kind) {
      case 'delete': {
        return fileOps.deleteTargets(p.targets)
      }
      case 'closeDirty': {
        for (const path of p.paths) {
          workspace.closeTab(path, true)
        }
        return say(`Discarded unsaved edits in ${p.names.join(', ')}`, 'warn')
      }
      case 'quitDirty': {
        return quit(true)
      }
      case 'workspaceDirty': {
        return workspaces.switchTo(p.dir, true)
      }
      case 'undoCommit': {
        return gitOp('Undoing commit', (repo) => undoLastCommit(repo), {
          done: () => `Undid "${p.subject}" — its changes are staged`,
        })
      }
      case 'stashDrop': {
        return gitOp('Dropping stash', (repo) => stashDrop(repo, p.ref), {
          done: () => `Dropped ${p.ref}`,
          repo: p.repo,
        })
      }
      case 'remoteRemoveConfirm': {
        return gitOp('Removing remote', (repo) => removeRemote(repo, p.name), {
          done: () => `Removed remote ${p.name}`,
          repo: p.repo,
        })
      }
      case 'commitAll': {
        return runCommit(gitOp, git, {
          message: p.message,
          onPushRejected: (branch, hasUpstream) =>
            setPrompt({ branch, hasUpstream, kind: 'pullPush' }),
          paths: 'all',
          repo: p.repo,
          variant: p.variant,
        })
      }
      case 'discardChange': {
        return gitOp('Discarding', () => discardChange(p.target), {
          done: () => `Discarded changes in ${basename(p.target.path)}`,
          repo: p.target.repo,
          touchesTree: { kind: 'followDisk', paths: p.target.affectedPaths },
        })
      }
      case 'worktreeRemove': {
        return workspaces.removeWorktreeAt(p.repo, p.path)
      }
      case 'deleteBranch': {
        return branches.remove(p.name, p.force)
      }
      case 'mergeBranch': {
        return branches.merge(p.name)
      }
      case 'pullPush': {
        return gitOp(
          'Pulling and pushing',
          (repo) => pullAndPush(repo, p.branch, p.hasUpstream),
          {
            done: () => `Pulled and pushed ${p.branch}`,
            touchesTree: { kind: 'sync' },
          }
        )
      }
      case 'replaceProject': {
        return workspace.applyProjectReplace(
          p.paths,
          p.query,
          p.replacement,
          p.options
        )
      }
      // An npm server is answered by the manager choice: `confirmation` returns null for it.
      case 'installServer': {
        if (p.install.kind === 'download') {
          lsp.install(p.id, p.name, p.install)
        }
        return
      }
      case 'uninstallServer': {
        lsp.uninstall(p.id)
        return
      }
      case 'installExtension': {
        return market.accept(p.id)
      }
      case 'activateExtension': {
        return market.activate(p.choices[0]!.id)
      }
      case 'uninstallExtension': {
        // Servers first: `lsp.uninstall` reads the registry the removal reloads; one at a time.
        ;(async () => {
          for (const server of p.servers) {
            await lsp.uninstall(server.id)
          }
          market.remove(p.id)
        })()
        break
      }
      default: {
        break
      }
    }
  }

  const cancelPrompt = () => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind === 'installServer') {
      say(`LSP: ${p.name} not installed — ${installHint(p.install)}`)
    }
    if (p?.kind === 'pullPush') {
      say(PUSH_REJECTED, 'error')
    }
    if (p?.kind === 'installExtension') {
      market.decline(p.id)
    }
  }

  const promptTitle = () => {
    const p = prompt()
    if (!p) {
      return
    }
    if (p.kind === 'newBranch' && p.from) {
      return `New branch from ${p.from}`
    }
    if (p.kind === 'reviewNote') {
      const span =
        p.endLine > p.line ? `${p.line + 1}-${p.endLine + 1}` : `${p.line + 1}`
      return `${NOTE_LABELS[p.noteKind]} · ${basename(p.path)}:${span}`
    }
    if (p.kind === 'reviewReply') {
      return `Reply to ${p.heading}`
    }
    if (p.kind === 'remoteAddUrl') {
      return `URL for ${p.name}`
    }
    return PROMPT_TITLES[p.kind]
  }
  const promptValue = () => {
    const p = prompt()
    if (p?.kind === 'rename') {
      return basename(p.target)
    }
    if (p?.kind === 'renameBranch') {
      return p.from
    }
    if (p?.kind === 'commitAmend') {
      return p.subject
    }
    return ''
  }
  const promptHistory = () => {
    const p = prompt()
    return p?.kind === 'commit' || p?.kind === 'commitAmend'
      ? git.messageHistory()
      : undefined
  }

  const confirmation = createMemo<Confirmation | null>(() => {
    const p = prompt()
    switch (p?.kind) {
      case 'delete': {
        const only = p.targets.length === 1 ? p.targets[0]! : null
        return {
          danger: true,
          message: only
            ? `Delete "${basename(only)}"${isDirectory(only) ? ' and its contents' : ''}?`
            : `Delete these ${p.targets.length} items and anything inside them?`,
          title: 'Delete',
          verb: 'delete',
        }
      }
      case 'closeDirty': {
        return {
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Close anyway?`,
          title: 'Unsaved changes',
          verb: 'close without saving',
        }
      }
      case 'discardChange': {
        const [, source] = p.target.affectedPaths
        return {
          danger: true,
          message:
            source === undefined
              ? p.target.mode === 'delete'
                ? `Discard changes in "${basename(p.target.path)}" and permanently delete it? Unsaved edits in its open buffer will also be lost.`
                : `Restore "${basename(p.target.path)}" from HEAD? Staged and working-tree changes are lost. Unsaved edits in its open buffer will also be lost.`
              : `Discard rename "${basename(p.target.path)}" and restore "${basename(source)}" from HEAD? Staged and working-tree changes are lost. Unsaved edits in either open buffer will also be lost.`,
          title: 'Discard changes',
          verb: 'discard',
        }
      }
      case 'quitDirty': {
        return {
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Quit anyway?`,
          title: 'Unsaved changes',
          verb: 'quit without saving',
        }
      }
      case 'workspaceDirty': {
        return {
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Open ${basename(p.dir)} anyway?`,
          title: 'Unsaved changes',
          verb: 'switch without saving',
        }
      }
      case 'replaceProject': {
        return {
          danger: true,
          message: `Replace ${p.matches} ${p.matches === 1 ? 'match' : 'matches'} in ${p.files} ${p.files === 1 ? 'file' : 'files'}${p.flags}? Closed files are written straight to disk.`,
          title: 'Replace in project',
          verb: 'replace',
        }
      }
      case 'undoCommit': {
        return {
          danger: false,
          message: `Undo "${p.subject}"? Its changes come back as staged edits.`,
          title: 'Undo last commit',
          verb: 'undo it',
        }
      }
      case 'commitAll': {
        return {
          danger: false,
          message: `Nothing is staged — commit all ${p.count} changed ${p.count === 1 ? 'file' : 'files'} directly?`,
          title: 'No staged changes',
          verb: 'commit all',
        }
      }
      case 'stashDrop': {
        return {
          danger: true,
          message: `Drop ${p.ref} ("${p.message}")? Its changes are lost.`,
          title: 'Drop stash',
          verb: 'drop it',
        }
      }
      case 'remoteRemoveConfirm': {
        return {
          danger: true,
          message: `Remove remote "${p.name}" (${p.url})? Branch tracking against it is dropped.`,
          title: 'Remove remote',
          verb: 'remove it',
        }
      }
      case 'worktreeRemove': {
        return {
          danger: true,
          message: `Delete the checkout at ${p.path}${p.branch ? ` (${p.branch})` : ''}? The branch itself stays. Git refuses if it holds uncommitted changes.`,
          title: 'Remove worktree',
          verb: 'remove it',
        }
      }
      case 'deleteBranch': {
        return {
          danger: p.force,
          message: p.force
            ? `Delete "${p.name}" even if it has commits on no other branch? They are lost.`
            : `Delete "${p.name}"? Git refuses if it has commits that are not merged.`,
          title: p.force ? 'Delete branch (force)' : 'Delete branch',
          verb: 'delete it',
        }
      }
      case 'mergeBranch': {
        return {
          danger: false,
          message: `Merge "${p.name}" into the current branch? Conflicts are left in the working tree.`,
          title: 'Merge branch',
          verb: 'merge it',
        }
      }
      case 'pullPush': {
        return {
          danger: false,
          message: `origin/${p.branch} has commits you don't. Merge them in and push again?`,
          title: 'Push rejected',
          verb: 'pull and push',
        }
      }
      case 'uninstallServer': {
        return {
          danger: true,
          message: `Delete druk's copy of ${p.name} from ${SERVER_ROOT}? This removes ${p.packages.join(', ')}.`,
          title: 'Remove language server',
          verb: 'remove it',
        }
      }
      case 'uninstallExtension': {
        return {
          danger: true,
          message:
            p.servers.length > 0
              ? `Delete ${p.name} and druk's copy of ${p.servers.map((server) => server.name).join(', ')}?`
              : `Delete ${p.name}? Its folder in the extensions directory goes with it.`,
          title: 'Uninstall extension',
          verb: 'uninstall it',
        }
      }
      case 'installServer': {
        if (p.install.kind !== 'download') {
          return null
        }
        return {
          danger: false,
          message: `${p.name} is not installed. Download it into ${SERVER_ROOT}?`,
          title: 'Language server missing',
          verb: 'download it',
        }
      }
      // Several appearances are a `ChoiceModal` in Overlays, hence the null.
      case 'activateExtension': {
        const only = p.choices.length === 1 ? p.choices[0]! : null
        if (!only) {
          return null
        }
        return {
          danger: false,
          message: `${p.name} is installed. Use the ${only.label}?`,
          title: 'Extension installed',
          verb: 'use it',
        }
      }
      case 'installExtension': {
        return {
          danger: false,
          message: [
            p.why,
            `${p.name} adds ${p.summary}.`,
            p.runs.length > 0 ? `It runs: ${p.runs.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join(' '),
          title: 'Extension available',
          verb: 'install it',
        }
      }
      default: {
        return null
      }
    }
  })

  return {
    cancelPrompt,
    chooseActivation,
    chooseConflictSide,
    chooseHistoryCommit,
    chooseInstallServer,
    chooseLocation,
    chooseRemoteRemove,
    chooseReviewKind,
    chooseStash,
    chooseStashAction,
    chooseTagDelete,
    chooseWorkspace,
    chooseWorktree,
    confirmPrompt,
    confirmation,
    promptHistory,
    promptTitle,
    promptValue,
    quit,
    submitPrompt,
  }
}

export type PromptHandlers = ReturnType<typeof createPromptHandlers>
