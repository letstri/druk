import { basename, dirname, join, relative, sep } from 'node:path'

import { createSignal } from 'solid-js'

import { copyAll, moveAll, removeAll } from '../core/bulk'
import { copyToClipboard } from '../core/clipboard'
import { exists, freePath, rename } from '../core/fs'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

export function createFileOps(deps: {
  rootDir: string
  status: Status
  tree: Tree
  workspace: Workspace
  renderer: { copyToClipboardOSC52: (text: string) => void }
}) {
  const { rootDir, status, tree, workspace, renderer } = deps
  const { say, setBusy, whileFree } = status

  const [clipboard, setClipboard] = createSignal<{ paths: string[]; mode: 'cut' | 'copy' }>({
    paths: [],
    mode: 'cut',
  })
  const cut = () => (clipboard().mode === 'cut' ? clipboard().paths : [])

  // Paths *under* `from` move too: a buffer left on the old path saves the folder back.
  const adoptMove = (from: string, to: string) => {
    const inside = `${from}/`
    const remap = (path: string) =>
      path === from ? to : path.startsWith(inside) ? to + path.slice(from.length) : path

    workspace.remapPaths(remap)
    tree.setSelectedPath(to)
    tree.remapExpanded(remap)
  }

  const movePath = (from: string, to: string): string | null => {
    const err = rename(from, to)
    if (err) return err
    adoptMove(from, to)
    return null
  }

  const within = (dir: string, path: string) => dir === path || dir.startsWith(`${path}/`)

  const whyNotMove = (path: string, dir: string): string | null => {
    if (dirname(path) === dir) return `${basename(path)} is already there`
    if (within(dir, path)) return `Cannot move ${basename(path)} into itself`
    return null
  }

  const moveInto = (path: string, dir: string) => {
    const refused = whyNotMove(path, dir)
    if (refused) return say(refused, 'warn')
    const err = movePath(path, join(dir, basename(path)))
    if (err) return say(err, 'error')
    tree.expand(dir)
    say(`Moved ${basename(path)} to ${relative(rootDir, dir) || basename(rootDir)}/`)
  }

  const moveAllInto = (paths: string[], dir: string) => {
    if (paths.length === 1) return moveInto(paths[0]!, dir)
    const refused: string[] = []
    const movable = paths.filter(path => {
      if (!whyNotMove(path, dir)) return true
      refused.push(basename(path))
      return false
    })
    tree.clearMarks()

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Moving', done: 0, total: movable.length })
          const { done, failed, moved } = await moveAll(
            movable,
            dir,
            (into, base) => join(into, base),
            progress => setBusy({ label: 'Moving', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          for (const { from, to } of moved) adoptMove(from, to)
          if (done > 0) tree.expand(dir)
          tree.refreshTree()
          const where = relative(rootDir, dir) || basename(rootDir)
          const left = [...refused, ...failed]
          if (left.length === 0) return say(`Moved ${done} items to ${where}/`)
          say(`Moved ${done} to ${where}/ — left ${left.join(', ')}`, 'warn')
        })(),
    )
  }

  const copyAllInto = (paths: string[], dir: string) => {
    // A folder copied into itself would walk the copy it is writing.
    const refused: string[] = []
    const copyable = paths.filter(path => {
      if (!within(dir, path)) return true
      refused.push(basename(path))
      return false
    })
    tree.clearMarks()
    if (copyable.length === 0) {
      return say(`Cannot copy ${refused.join(', ')} into itself`, 'warn')
    }

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Copying', done: 0, total: copyable.length })
          const { done, failed } = await copyAll(copyable, dir, freePath, progress =>
            setBusy({ label: 'Copying', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          if (done === 0) return
          tree.expand(dir)
          tree.refreshTree()
          const where = relative(rootDir, dir) || basename(rootDir)
          const what = done === 1 ? basename(copyable[0]!) : `${done} items`
          const left = [...refused, ...failed]
          if (left.length > 0) return say(`Copied ${what} — left ${left.join(', ')}`, 'warn')
          say(`Copied ${what} to ${where}/`)
        })(),
    )
  }

  const takeForPaste = (mode: 'cut' | 'copy') => {
    const targets = tree.actionTargets()
    if (targets.length === 0) return say('Nothing selected', 'warn')
    setClipboard({ paths: targets, mode })
    tree.clearMarks()
    const what = targets.length === 1 ? basename(targets[0]!) : `${targets.length} items`
    const verb = mode === 'cut' ? 'Cut' : 'Copied'
    say(`${verb} ${what} — press p on the folder to ${mode === 'cut' ? 'move' : 'copy'} into`)
  }

  const paste = () => {
    const { paths, mode } = clipboard()
    if (paths.length === 0) {
      return say('Nothing taken — press x or c on a file or folder first', 'warn')
    }
    const from = paths.filter(path => exists(path))
    if (mode === 'cut') setClipboard({ paths: [], mode: 'cut' })
    if (from.length === 0) return say(`What was ${mode} is gone`, 'warn')
    if (mode === 'cut') moveAllInto(from, tree.targetDir())
    else copyAllInto(from, tree.targetDir())
  }

  const copyPath = (path: string, kind: 'absolute' | 'relative') => {
    const rel = relative(rootDir, path)
    // Not a bare `startsWith('..')`: a project file may be named `..rc`.
    const outside = rel === '..' || rel.startsWith(`..${sep}`)
    const text = kind === 'relative' && !outside ? rel : path

    copyToClipboard(text)
    // Both routes: the subprocess reaches this machine, OSC 52 the terminal the user sits at.
    renderer.copyToClipboardOSC52(text)
    if (kind === 'relative' && outside) return say(`Copied ${text} — outside the project`, 'warn')
    say(`Copied ${text}`)
  }

  // Both routes, as copyPath does: OSC 52 is what reaches the machine an SSH session is really on.
  const copyLink = (url: string) => {
    copyToClipboard(url)
    renderer.copyToClipboardOSC52(url)
  }

  const cancelTake = () => {
    const cancelled = clipboard().mode === 'cut' ? 'Move' : 'Copy'
    setClipboard({ paths: [], mode: 'cut' })
    say(`${cancelled} cancelled`)
  }

  const deleteTargets = (targets: string[]) => {
    for (const target of targets) {
      if (workspace.tabs().includes(target)) workspace.closeTab(target, true)
    }
    const gone = tree.selectedPath()
    const wasAt = gone && targets.includes(gone) ? tree.nodes().findIndex(n => n.path === gone) : -1
    tree.clearMarks()

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Deleting', done: 0, total: 0 })
          const { failed } = await removeAll(targets, progress =>
            setBusy({ label: 'Deleting', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          tree.refreshTree()
          if (wasAt >= 0) {
            const rows = tree.nodes()
            tree.setSelectedPath(rows[Math.min(wasAt, rows.length - 1)]?.path ?? null)
          }
          if (failed.length > 0) return say(`Could not delete ${failed.join(', ')}`, 'error')
          say(
            targets.length === 1
              ? `Deleted ${basename(targets[0]!)}`
              : `Deleted ${targets.length} items`,
          )
        })(),
    )
  }

  return {
    clipboard,
    cut,
    movePath,
    moveInto,
    moveAllInto,
    copyAllInto,
    takeForPaste,
    copyPath,
    copyLink,
    paste,
    cancelTake,
    deleteTargets,
  }
}

export type FileOps = ReturnType<typeof createFileOps>
