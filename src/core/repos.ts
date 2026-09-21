import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

import { listDir } from './fs'

export const DEFAULT_SCAN_DEPTH = 3

const MAX_REPOS = 64

const MAX_SCAN_DIRS = 2000

const SKIPPED = new Set([
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  'out',
])

export function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

export function enclosingRepo(
  dir: string,
  cache?: Map<string, string | null>
): string | null {
  const cached = cache?.get(dir)
  if (cached !== undefined) {
    return cached
  }
  const parent = dirname(dir)
  // dirname('/') is '/': the root is where the walk has to stop.
  const found = isRepoRoot(dir)
    ? dir
    : parent === dir
      ? null
      : enclosingRepo(parent, cache)
  cache?.set(dir, found)
  return found
}

// A root inside a checkout answers with itself, so every query runs in the folder opened.
export function discoverRepos(
  root: string,
  depth = DEFAULT_SCAN_DEPTH
): string[] {
  if (enclosingRepo(root)) {
    return [root]
  }
  const found: string[] = []
  let read = 0
  let level = [root]
  for (
    let below = 0;
    below < depth && level.length > 0 && found.length < MAX_REPOS;
    below += 1
  ) {
    const next: string[] = []
    for (const dir of level) {
      read += 1
      if (read > MAX_SCAN_DIRS) {
        return found
      }
      for (const node of listDir(dir)) {
        // A symlinked directory is skipped: git refuses to answer about paths reached through it.
        if (!node.isDir || node.symlink || node.name.startsWith('.')) {
          continue
        }
        if (SKIPPED.has(node.name)) {
          continue
        }
        if (isRepoRoot(node.path)) {
          found.push(node.path)
        } else {
          next.push(node.path)
        }
        if (found.length >= MAX_REPOS) {
          return found
        }
      }
    }
    level = next
  }
  return found
}

export function repoOf(path: string, repos: readonly string[]): string | null {
  let best: string | null = null
  for (const repo of repos) {
    if (path !== repo && !path.startsWith(`${repo}${sep}`)) {
      continue
    }
    if (best === null || repo.length > best.length) {
      best = repo
    }
  }
  return best
}

// A repository's own root is left out: it is never ignored by itself.
export function groupByRepo(
  paths: readonly string[],
  repos: readonly string[]
) {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const repo = repoOf(path, repos)
    if (repo === null || repo === path) {
      continue
    }
    const group = groups.get(repo)
    if (group) {
      group.push(path)
    } else {
      groups.set(repo, [path])
    }
  }
  return groups
}
