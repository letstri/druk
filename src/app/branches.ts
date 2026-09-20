import { createSignal } from 'solid-js'

import {
  createBranch,
  deleteBranch,
  listBranches,
  localBranchName,
  mergeBranch,
  renameBranch,
  switchBranch,
} from '../core/git'
import type { Branch } from '../core/git'
import { noRepository } from './git'
import type { Git, GitOp } from './git'
import type { PromptState } from './prompts'
import type { Status } from './status'

export type BranchMode =
  | 'switch'
  | 'from'
  | 'merge'
  | 'rename'
  | 'delete'
  | 'deleteForce'
  | 'diffBase'

interface PickerSpec {
  title: string
  keep: (branch: Branch) => boolean
  empty: string
}

const PICKERS: Record<BranchMode, PickerSpec> = {
  switch: {
    title: 'Switch to branch',
    keep: branch => !branch.current,
    empty: 'No other branch to switch to',
  },
  from: { title: 'New branch from', keep: () => true, empty: 'No branch to start from' },
  merge: {
    title: 'Merge into the current branch',
    keep: branch => !branch.current,
    empty: 'No other branch to merge',
  },
  rename: {
    title: 'Rename branch',
    keep: branch => !branch.remote,
    empty: 'No local branch to rename',
  },
  delete: {
    title: 'Delete branch',
    keep: branch => !branch.remote && !branch.current,
    empty: 'No other local branch to delete',
  },
  deleteForce: {
    title: 'Delete branch (force)',
    keep: branch => !branch.remote && !branch.current,
    empty: 'No other local branch to delete',
  },
  diffBase: {
    title: 'Compare against branch',
    keep: () => true,
    empty: 'No branch to compare against',
  },
}

export function createBranches(deps: {
  status: Status
  git: Git
  gitOp: GitOp
  prompts: PromptState
}) {
  const { status, git, gitOp, prompts } = deps

  const [pick, setPick] = createSignal<{ mode: BranchMode; branches: Branch[] } | null>(null)

  const pickTitle = () => {
    const open = pick()
    return open ? PICKERS[open.mode].title : ''
  }

  const open = (mode: BranchMode) => {
    const repo = git.activeRepo()
    if (repo === null) return status.say(noRepository(git), 'warn')
    const spec = PICKERS[mode]
    const branches = listBranches(repo).filter(spec.keep)
    if (branches.length === 0) return status.say(spec.empty)
    setPick({ mode, branches })
  }

  const create = (name: string, from: string | null) =>
    gitOp('Creating branch', repo => createBranch(repo, name, from), {
      touchesTree: { kind: 'sync' },
      done: () => `On ${name}`,
    })

  const newBranch = () => {
    if (git.activeRepo() === null) return status.say(noRepository(git), 'warn')
    prompts.setPrompt({ kind: 'newBranch', from: null })
  }

  const choose = (branch: Branch) => {
    const mode = pick()?.mode
    setPick(null)
    switch (mode) {
      case 'switch':
        return gitOp('Switching branch', repo => switchBranch(repo, branch.name, branch.remote), {
          touchesTree: { kind: 'sync' },
          done: () => `On ${localBranchName(branch.name)}`,
        })
      case 'from':
        return prompts.setPrompt({ kind: 'newBranch', from: branch.name })
      case 'merge':
        return prompts.setPrompt({ kind: 'mergeBranch', name: branch.name })
      case 'rename':
        return prompts.setPrompt({ kind: 'renameBranch', from: branch.name })
      case 'diffBase':
        git.setDiffBase(branch.name)
        return status.say(`Comparing against ${branch.name}`)
      case 'delete':
      case 'deleteForce':
        return prompts.setPrompt({
          kind: 'deleteBranch',
          name: branch.name,
          force: mode === 'deleteForce',
        })
    }
  }

  const rename = (from: string, to: string) =>
    gitOp('Renaming branch', repo => renameBranch(repo, from, to), {
      done: () => `Renamed ${from} to ${to}`,
    })

  const remove = (name: string, force: boolean) =>
    gitOp('Deleting branch', repo => deleteBranch(repo, name, force), {
      done: () => `Deleted ${name}`,
    })

  const merge = (name: string) =>
    gitOp('Merging', repo => mergeBranch(repo, name), {
      touchesTree: { kind: 'sync' },
      done: result => result.detail || `Merged ${name}`,
    })

  return { pick, setPick, pickTitle, open, newBranch, choose, create, rename, remove, merge }
}

export type Branches = ReturnType<typeof createBranches>
