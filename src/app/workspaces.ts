import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

import { isDirectory } from '../core/fs'
import { addWorktree, branchExists, removeWorktree, worktrees } from '../core/git'
import type { Worktree } from '../core/git'
import { resolvedPath, workspaceEntries, worktreePath } from '../core/workspaces'
import { noRepository } from './git'
import type { Git, GitOp } from './git'
import type { Status } from './status'
import type { Prompt } from './types'
import type { Workspace } from './workspace'

const expandHome = (path: string): string =>
  path === '~' || path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path

export function createWorkspaces(deps: {
  rootDir: string
  status: Status
  git: Git
  gitOp: GitOp
  workspace: Workspace
  setPrompt: (prompt: Prompt) => void
  open?: (dir: string) => void
}) {
  const { rootDir, status, git, gitOp, workspace, setPrompt, open } = deps

  const repos = () => {
    const active = git.activeRepo()
    return [...new Set([...(active ? [active] : []), ...git.repos()])]
  }

  const entries = () => workspaceEntries(rootDir, repos())

  const pick = () => {
    if (!open) return status.say('This druk cannot switch workspaces', 'warn')
    setPrompt({ kind: 'workspacePick', entries: entries() })
  }

  const openPrompt = () => {
    if (!open) return status.say('This druk cannot switch workspaces', 'warn')
    setPrompt({ kind: 'workspaceOpen' })
  }

  const switchTo = (dir: string, discardUnsaved = false) => {
    if (!open) return status.say('This druk cannot switch workspaces', 'warn')
    const at = resolve(rootDir, expandHome(dir.trim()))
    if (!isDirectory(at)) return status.say(`Not a folder: ${dir}`, 'error')
    if (resolvedPath(at) === resolvedPath(rootDir)) {
      return status.say(`${basename(at)} is already open`)
    }

    const dirty = workspace.dirtyPaths()
    if (!discardUnsaved && dirty.length > 0) {
      return setPrompt({
        kind: 'workspaceDirty',
        dir: at,
        names: dirty.map(path => basename(path)),
      })
    }
    open(at)
  }

  const trees = (repo: string): Worktree[] => worktrees(repo).filter(tree => isDirectory(tree.path))

  const pickWorktree = (mode: 'switch' | 'remove') => {
    if (!open && mode === 'switch') return status.say('This druk cannot switch workspaces', 'warn')
    const repo = git.activeRepo()
    if (repo === null) return status.say(noRepository(git), 'warn')
    const current = resolvedPath(rootDir)
    const found = trees(repo).filter(tree => resolvedPath(tree.path) !== current)
    if (found.length === 0) {
      return status.say(mode === 'switch' ? 'No other worktree to switch to' : 'No other worktree')
    }
    setPrompt({ kind: 'worktreePick', repo, mode, trees: found, current })
  }

  const newWorktree = () => {
    if (!open) return status.say('This druk cannot switch workspaces', 'warn')
    const repo = git.activeRepo()
    if (repo === null) return status.say(noRepository(git), 'warn')
    setPrompt({ kind: 'newWorktree', repo })
  }

  const createWorktree = (repo: string, branch: string) => {
    const at = worktreePath(repo, branch)
    if (isDirectory(at)) return status.say(`${basename(at)} already exists`, 'error')
    gitOp(
      'Creating worktree',
      where => addWorktree(where, at, branch, !branchExists(where, branch)),
      {
        repo,
        done: () => {
          switchTo(at)
          return `Worktree ${basename(at)}`
        },
      },
    )
  }

  const removeWorktreeAt = (repo: string, path: string) =>
    gitOp('Removing worktree', where => removeWorktree(where, path), {
      repo,
      done: () => `Removed ${basename(path)}`,
    })

  return {
    pick,
    openPrompt,
    switchTo,
    entries,
    pickWorktree,
    newWorktree,
    createWorktree,
    removeWorktreeAt,
  }
}

export type Workspaces = ReturnType<typeof createWorkspaces>
