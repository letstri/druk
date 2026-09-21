import { dirname, join, sep } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import type { Config } from '../core/config'
import { flattenVisible } from '../core/fs'
import type { TreeNode } from '../core/fs'
import { ignoredPaths } from '../core/git'
import { enclosingRepo } from '../core/repos'

export function hiddenNodes(
  rootDir: string,
  config: Pick<Config, 'showDotfiles' | 'respectGitignore'>
): ((node: TreeNode) => boolean) | null {
  const hideDots = !config.showDotfiles
  if (!hideDots && !config.respectGitignore) {
    return null
  }

  const repos = new Map<string, string | null>()
  const ignored = new Map<string, Set<string>>()
  const isIgnored = (path: string) => {
    if (!config.respectGitignore) {
      return false
    }
    // The *parent's* repository: a repository's own root is never ignored by itself.
    const repo = enclosingRepo(dirname(path), repos)
    if (repo === null) {
      return false
    }
    // From the opened folder when it sits inside the repository — see `ignoredPaths`.
    const cwd = repo.startsWith(rootDir) ? repo : rootDir
    let paths = ignored.get(cwd)
    if (!paths) {
      paths = ignoredPaths(cwd)
      ignored.set(cwd, paths)
    }
    return paths.has(path)
  }
  return (node) =>
    (hideDots && node.name.startsWith('.')) || isIgnored(node.path)
}

export function createTree(
  rootDir: string,
  initial: { expanded: string[]; selected: string | null },
  hidden?: () => ((node: TreeNode) => boolean) | null
) {
  const [expanded, setExpanded] = createSignal<Set<string>>(
    new Set(initial.expanded)
  )
  const [selectedPath, setSelectedPath] = createSignal<string | null>(
    initial.selected
  )
  const [marked, setMarked] = createSignal<string[]>([])
  const [anchor, setAnchor] = createSignal<string | null>(null)

  // Unchanged paths keep node identity: `<For>` keys rows by object and rebuilds otherwise.
  let prevNodes = new Map<string, TreeNode>()
  const nodes = createMemo(() => {
    const fresh = flattenVisible(rootDir, expanded(), hidden?.() ?? undefined)
    const next = new Map<string, TreeNode>()
    for (let i = 0; i < fresh.length; i += 1) {
      const node = fresh[i]!
      const old = prevNodes.get(node.path)
      if (
        old &&
        old.isDir === node.isDir &&
        old.depth === node.depth &&
        old.symlink === node.symlink
      ) {
        fresh[i] = old
      }
      next.set(node.path, fresh[i]!)
    }
    prevNodes = next
    return fresh
  })

  // Bump the Set identity so `nodes` recomputes and re-reads the filesystem.
  const refreshTree = () => setExpanded((prev) => new Set(prev))
  const expand = (path: string) =>
    setExpanded((prev) => new Set(prev).add(path))

  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) {
        next.add(path)
      }
      return next
    })

  const reveal = (path: string) => {
    const parts = path.startsWith(rootDir)
      ? path.slice(rootDir.length + 1).split(sep)
      : []
    if (parts.length < 2) {
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      let dir = rootDir
      for (const part of parts.slice(0, -1)) {
        dir = join(dir, part)
        next.add(dir)
      }
      // Same identity when nothing opened: `expanded` also drives the git-status effect.
      return next.size === prev.size ? prev : next
    })
  }

  const clearMarks = () => {
    setMarked([])
    setAnchor(null)
  }

  const collapseAll = () => {
    setExpanded(new Set<string>())
    clearMarks()
    const path = selectedPath()
    if (!path?.startsWith(`${rootDir}${sep}`)) {
      return
    }
    setSelectedPath(
      join(rootDir, path.slice(rootDir.length + 1).split(sep)[0]!)
    )
  }

  const moveSelection = (delta: number) => {
    const rows = nodes()
    if (rows.length === 0) {
      return
    }
    const idx = rows.findIndex((n) => n.path === selectedPath())
    const next =
      idx === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + delta))
    setSelectedPath(rows[next]!.path)
    clearMarks()
  }

  const extendSelection = (delta: number) => {
    const rows = nodes()
    const head = rows.findIndex((n) => n.path === selectedPath())
    if (rows.length === 0 || head === -1) {
      return moveSelection(delta)
    }

    const from = anchor() ?? rows[head]!.path
    if (!anchor()) {
      setAnchor(from)
    }
    const start = rows.findIndex((n) => n.path === from)
    const next = Math.max(0, Math.min(rows.length - 1, head + delta))
    const [lo, hi] = start <= next ? [start, next] : [next, start]

    setMarked(rows.slice(lo, hi + 1).map((n) => n.path))
    setSelectedPath(rows[next]!.path)
  }

  const actionTargets = (): string[] => {
    const all = marked()
    if (all.length > 0) {
      return all
    }
    const path = selectedPath()
    return path ? [path] : []
  }

  const selectedNode = () => nodes().find((n) => n.path === selectedPath())

  const targetDir = () => {
    const node = selectedNode()
    if (!node) {
      return rootDir
    }
    return node.isDir ? node.path : dirname(node.path)
  }

  const remapExpanded = (remap: (path: string) => string) =>
    setExpanded((prev) => new Set([...prev].map(remap)))

  return {
    actionTargets,
    clearMarks,
    collapseAll,
    expand,
    expanded,
    extendSelection,
    marked,
    moveSelection,
    nodes,
    refreshTree,
    remapExpanded,
    reveal,
    selectedNode,
    selectedPath,
    setSelectedPath,
    targetDir,
    toggleExpand,
  }
}

export type Tree = ReturnType<typeof createTree>
