import { basename, dirname, join } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { createDir, createFile, isDirectory } from '../core/fs'
import { commitPaths, pullAndPush, PUSH_REJECTED, undoLastCommit } from '../core/git'
import { SERVER_ROOT } from '../lsp/install'
import { installHint } from '../lsp/servers'
import type { Branches } from './branches'
import type { EditorBridge } from './editor'
import type { FileOps } from './fileOps'
import type { GitOp } from './git'
import type { Lsp } from './lsp'
import type { Market } from './market'
import type { Panes } from './panes'
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
  newBranch: 'New branch name',
  renameBranch: 'Rename branch to',
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
  rootDir: string
  renderer: { destroy: () => void }
  state: PromptState
  status: Status
  tree: Tree
  panes: Panes
  editor: EditorBridge
  workspace: Workspace
  fileOps: FileOps
  gitOp: GitOp
  branches: Branches
  lsp: Lsp
  market: Market
}) {
  const { rootDir, renderer, state, status, tree, panes, editor, workspace } = deps
  const { fileOps, gitOp, branches, lsp, market } = deps
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
      gitOp('Committing', () => commitPaths(rootDir, name, p.paths))
    } else if (p.kind === 'newBranch') {
      branches.create(name, p.from)
    } else if (p.kind === 'renameBranch') {
      branches.rename(p.from, name)
    }
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
        return gitOp('Undoing commit', () => undoLastCommit(rootDir), {
          done: () => `Undid "${p.subject}" — its changes are staged`,
        })
      case 'deleteBranch':
        return branches.remove(p.name, p.force)
      case 'mergeBranch':
        return branches.merge(p.name)
      case 'pullPush':
        // touchesTree: the pull half rewrites files under open buffers.
        return gitOp('Pulling and pushing', () => pullAndPush(rootDir, p.branch, p.hasUpstream), {
          touchesTree: true,
          done: () => `Pulled and pushed ${p.branch}`,
        })
      case 'replaceProject':
        return workspace.applyProjectReplace(p.paths, p.query, p.replacement, p.options)
      case 'installServer':
        return void lsp.install(p.id, p.name, p.install)
      case 'uninstallServer':
        return void lsp.uninstall(p.id)
      case 'installExtension':
        return market.accept(p.id)
      case 'uninstallExtension': {
        // The servers go first: removing the extension reloads the manifests,
        // and `lsp.uninstall` reads the spec it is about out of that registry —
        // after the reload there is nothing left to tell it what to delete.
        return void (async () => {
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
    return PROMPT_TITLES[p.kind]
  }
  const promptValue = () => {
    const p = prompt()
    if (p?.kind === 'rename') return basename(p.target)
    // Renaming usually adjusts a name rather than replacing it.
    if (p?.kind === 'renameBranch') return p.from
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
        return {
          title: 'Language server missing',
          verb: 'install it',
          danger: false,
          // Where it lands is the part worth showing: nothing global is touched,
          // and deleting that one directory undoes the whole thing.
          message:
            p.install.kind === 'npm'
              ? `${p.name} is not installed. Fetch it with npm into ${SERVER_ROOT}?`
              : `${p.name} is not installed. Download it into ${SERVER_ROOT}?`,
        }
      case 'installExtension':
        return {
          title: p.current ? 'Extension update' : 'Extension available',
          verb: p.current ? 'update it' : 'install it',
          danger: false,
          // The commands are the part worth reading before agreeing: a manifest
          // is data and installing it runs nothing, but a language server is a
          // program druk will spawn the next time a matching file opens.
          message: [
            p.why,
            `${p.name} adds ${p.summary}${p.current ? ` (${p.current} installed)` : ''}.`,
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
    cancelPrompt,
    promptTitle,
    promptValue,
    confirmation,
  }
}

export type PromptHandlers = ReturnType<typeof createPromptHandlers>
