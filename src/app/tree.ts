import { dirname, join } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import type { Config } from '../core/config'
import { flattenVisible } from '../core/fs'
import type { TreeNode } from '../core/fs'
import { ignoredPaths } from '../core/git'
import { enclosingRepo } from '../core/repos'

/**
 * The tree's row filter for the current settings, or null when nothing is hidden.
 * Reads the config store, so a memo calling this recomputes when either setting
 * flips. The ignored sets are re-read from git on every call — the callers' memo
 * already re-runs on each tree refresh, which is the same cadence `statusMap`
 * runs on, and a stale set would hide files whose ignore rules are gone.
 *
 * One set per repository, filled as a row inside that repository is tested: with
 * a folder of repositories open there is no single set to ask for, and asking
 * eagerly would spend an `ls-files` on every repository whose folder is shut.
 */
export function hiddenNodes(
  rootDir: string,
  config: Pick<Config, 'showDotfiles' | 'respectGitignore'>,
): ((node: TreeNode) => boolean) | null {
  const hideDots = !config.showDotfiles
  if (!hideDots && !config.respectGitignore) return null

  const repos = new Map<string, string | null>()
  const ignored = new Map<string, Set<string>>()
  const isIgnored = (path: string) => {
    if (!config.respectGitignore) return false
    // The repository of the row's *parent*: a repository's own root is never
    // ignored by itself, and asking would fill its set for a folder still shut.
    const repo = enclosingRepo(dirname(path), repos)
    if (repo === null) return false
    // Asked from the opened folder when that sits inside the repository, for the
    // reason `ignoredPaths` documents: from the repository root it would list —
    // and walk — every ignored entry outside the folder on screen as well.
    const cwd = repo.startsWith(rootDir) ? repo : rootDir
    let paths = ignored.get(cwd)
    if (!paths) {
      paths = ignoredPaths(cwd)
      ignored.set(cwd, paths)
    }
    return paths.has(path)
  }
  return node => (hideDots && node.name.startsWith('.')) || isIgnored(node.path)
}

/** File-tree state: which folders are open, where the cursor is, what is marked. */
export function createTree(
  rootDir: string,
  initial: { expanded: string[]; selected: string | null },
  /** Current row filter — see `hiddenNodes`. Absent means list everything. */
  hidden?: () => ((node: TreeNode) => boolean) | null,
) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set(initial.expanded))
  const [selectedPath, setSelectedPath] = createSignal<string | null>(initial.selected)
  /**
   * Rows picked out with Shift+↑/↓, in tree order. Empty for the ordinary case of
   * one row under the cursor — `actionTargets` is what reconciles the two, so no
   * action has to care which of the pair it is looking at.
   */
  const [marked, setMarked] = createSignal<string[]>([])
  /** Row the current range grows from; null when there is no range. */
  const [anchor, setAnchor] = createSignal<string | null>(null)

  /**
   * Rows an unchanged path had last time keep their object identity. The tree's
   * `<For>` keys rows by object, so handing it a fresh `TreeNode` per path on
   * every watcher refresh tore down and rebuilt every visible row — hundreds of
   * renderables per tick on a busy repository, for a list that rarely changed.
   */
  let prevNodes = new Map<string, TreeNode>()
  const nodes = createMemo(() => {
    const fresh = flattenVisible(rootDir, expanded(), hidden?.() ?? undefined)
    const next = new Map<string, TreeNode>()
    for (let i = 0; i < fresh.length; i++) {
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
  const refreshTree = () => setExpanded(prev => new Set(prev))
  const expand = (path: string) => setExpanded(prev => new Set(prev).add(path))

  const toggleExpand = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  /** Expand every folder above `path` so the tree actually has a row for it. */
  const reveal = (path: string) => {
    const parts = path.startsWith(rootDir) ? path.slice(rootDir.length + 1).split('/') : []
    if (parts.length < 2) return
    setExpanded(prev => {
      const next = new Set(prev)
      let dir = rootDir
      for (const part of parts.slice(0, -1)) {
        dir = join(dir, part)
        next.add(dir)
      }
      // Same identity when nothing opened: `expanded` also drives the git-status
      // effect, so a fresh Set here costs a whole-repo `git status` on every file
      // open and every tab switch, neither of which touches the working tree.
      return next.size === prev.size ? prev : next
    })
  }

  const clearMarks = () => {
    setMarked([])
    setAnchor(null)
  }

  /**
   * Shut every folder. The cursor is usually inside one of them, and a selection
   * with no row on screen reads as no selection at all — so it walks out to the
   * top-level entry that swallowed it.
   */
  const collapseAll = () => {
    setExpanded(new Set<string>())
    clearMarks()
    const path = selectedPath()
    if (!path?.startsWith(`${rootDir}/`)) return
    setSelectedPath(join(rootDir, path.slice(rootDir.length + 1).split('/')[0]!))
  }

  const moveSelection = (delta: number) => {
    const rows = nodes()
    if (rows.length === 0) return
    const idx = rows.findIndex(n => n.path === selectedPath())
    // From no selection, land on the first row regardless of direction.
    const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + delta))
    setSelectedPath(rows[next]!.path)
    clearMarks()
  }

  /**
   * Shift+↑/↓: move the cursor and drag a range along behind it.
   *
   * Over the rows as they are displayed, so a range is exactly what you saw between
   * the two ends — a collapsed folder counts as the one row it draws, not as the
   * files inside it. The anchor is where the range started and does not move, so
   * reversing direction shrinks the range instead of leaving a stranded end.
   */
  const extendSelection = (delta: number) => {
    const rows = nodes()
    const head = rows.findIndex(n => n.path === selectedPath())
    if (rows.length === 0 || head < 0) return moveSelection(delta)

    const from = anchor() ?? rows[head]!.path
    if (!anchor()) setAnchor(from)
    const start = rows.findIndex(n => n.path === from)
    const next = Math.max(0, Math.min(rows.length - 1, head + delta))
    const [lo, hi] = start <= next ? [start, next] : [next, start]

    setMarked(rows.slice(lo, hi + 1).map(n => n.path))
    setSelectedPath(rows[next]!.path)
  }

  /** Everything an action should apply to: the marked rows, else the cursor's row. */
  const actionTargets = (): string[] => {
    const all = marked()
    if (all.length > 0) return all
    const path = selectedPath()
    return path ? [path] : []
  }

  const selectedNode = () => nodes().find(n => n.path === selectedPath())

  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
  }

  /** Fresh Set identity, so this doubles as the tree refresh. */
  const remapExpanded = (remap: (path: string) => string) =>
    setExpanded(prev => new Set([...prev].map(remap)))

  return {
    expanded,
    selectedPath,
    setSelectedPath,
    marked,
    nodes,
    refreshTree,
    expand,
    toggleExpand,
    collapseAll,
    reveal,
    clearMarks,
    moveSelection,
    extendSelection,
    actionTargets,
    selectedNode,
    targetDir,
    remapExpanded,
  }
}

export type Tree = ReturnType<typeof createTree>
