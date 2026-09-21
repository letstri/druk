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
  delete: {
    empty: 'No other local branch to delete',
    keep: (branch) => !branch.remote && !branch.current,
    title: 'Delete branch',
  },
  deleteForce: {
    empty: 'No other local branch to delete',
    keep: (branch) => !branch.remote && !branch.current,
    title: 'Delete branch (force)',
  },
  diffBase: {
    empty: 'No branch to compare against',
    keep: () => true,
    title: 'Compare against branch',
  },
  from: {
    empty: 'No branch to start from',
    keep: () => true,
    title: 'New branch from',
  },
  merge: {
    empty: 'No other branch to merge',
    keep: (branch) => !branch.current,
    title: 'Merge into the current branch',
  },
  rename: {
    empty: 'No local branch to rename',
    keep: (branch) => !branch.remote,
    title: 'Rename branch',
  },
  switch: {
    empty: 'No other branch to switch to',
    keep: (branch) => !branch.current,
    title: 'Switch to branch',
  },
}

export function createBranches(deps: {
  status: Status
  git: Git
  gitOp: GitOp
  prompts: PromptState
}) {
  const { status, git, gitOp, prompts } = deps

  const [pick, setPick] = createSignal<{
    mode: BranchMode
    branches: Branch[]
  } | null>(null)

  const pickTitle = () => {
    const open = pick()
    return open ? PICKERS[open.mode].title : ''
  }

  const open = (mode: BranchMode) => {
    const repo = git.activeRepo()
    if (repo === null) {
      return status.say(noRepository(git), 'warn')
    }
    const spec = PICKERS[mode]
    const branches = listBranches(repo).filter(spec.keep)
    if (branches.length === 0) {
      return status.say(spec.empty)
    }
    setPick({ branches, mode })
  }

  const create = (name: string, from: string | null) =>
    gitOp('Creating branch', (repo) => createBranch(repo, name, from), {
      done: () => `On ${name}`,
      touchesTree: { kind: 'sync' },
    })

  const newBranch = () => {
    if (git.activeRepo() === null) {
      return status.say(noRepository(git), 'warn')
    }
    prompts.setPrompt({ from: null, kind: 'newBranch' })
  }

  const choose = (branch: Branch) => {
    const mode = pick()?.mode
    setPick(null)
    switch (mode) {
      case 'switch': {
        return gitOp(
          'Switching branch',
          (repo) => switchBranch(repo, branch.name, branch.remote),
          {
            done: () => `On ${localBranchName(branch.name)}`,
            touchesTree: { kind: 'sync' },
          }
        )
      }
      case 'from': {
        return prompts.setPrompt({ from: branch.name, kind: 'newBranch' })
      }
      case 'merge': {
        return prompts.setPrompt({ kind: 'mergeBranch', name: branch.name })
      }
      case 'rename': {
        return prompts.setPrompt({ from: branch.name, kind: 'renameBranch' })
      }
      case 'diffBase': {
        git.setDiffBase(branch.name)
        return status.say(`Comparing against ${branch.name}`)
      }
      case 'delete':
      case 'deleteForce': {
        return prompts.setPrompt({
          force: mode === 'deleteForce',
          kind: 'deleteBranch',
          name: branch.name,
        })
      }
      default: {
        break
      }
    }
  }

  const rename = (from: string, to: string) =>
    gitOp('Renaming branch', (repo) => renameBranch(repo, from, to), {
      done: () => `Renamed ${from} to ${to}`,
    })

  const remove = (name: string, force: boolean) =>
    gitOp('Deleting branch', (repo) => deleteBranch(repo, name, force), {
      done: () => `Deleted ${name}`,
    })

  const merge = (name: string) =>
    gitOp('Merging', (repo) => mergeBranch(repo, name), {
      done: (result) => result.detail || `Merged ${name}`,
      touchesTree: { kind: 'sync' },
    })

  return {
    choose,
    create,
    merge,
    newBranch,
    open,
    pick,
    pickTitle,
    remove,
    rename,
    setPick,
  }
}

export type Branches = ReturnType<typeof createBranches>
