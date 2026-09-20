import { basename } from 'node:path'

import { createEffect, createMemo, createSignal, on } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { parseConflicts, resolveConflict as keepSide } from '../core/conflicts'
import type { ConflictSide, MergeConflict } from '../core/conflicts'
import { formatterFor, runFormatter } from '../core/format'
import {
  BinaryFileError,
  DEFAULT_ENCODING,
  exists,
  mtimeOf,
  readTextFile,
  writeFile,
} from '../core/fs'
import type { TextEncoding, TreeNode } from '../core/fs'
import { isImagePath } from '../core/image'
import { isMarkdownPath } from '../core/markdown'
import { replaceMatch, replaceProject } from '../core/search'
import type { Match, SearchOptions } from '../core/search'
import { loadSession, saveSession } from '../core/session'
import { trimTrailing } from '../editor/lines'
import type { EditorBridge } from './editor'
import type { Git } from './git'
import type { Panes } from './panes'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Conflict, DiskSync, FileBuffer, Prompt } from './types'

// App.tsx matches these prefixes to clear the watcher's own warning.
export const CLASH_CHANGED = 'Changed on disk with unsaved edits: '
export const CLASH_DELETED = 'Deleted on disk with unsaved edits: '

export type PageKind = 'settings' | 'lspStatus' | 'allChanges' | 'commit' | 'compare'

// A scheme no path can carry is what keeps page ids apart from file paths.
const PAGE_PREFIX = 'druk://'

const pageId = (kind: PageKind) => `${PAGE_PREFIX}${kind}`

export const pageKindOf = (id: string): PageKind | null =>
  id.startsWith(PAGE_PREFIX) ? (id.slice(PAGE_PREFIX.length) as PageKind) : null

export const PAGE_TITLES: Record<PageKind, string> = {
  settings: 'Settings',
  lspStatus: 'Language servers',
  allChanges: 'Changes',
  commit: 'Commit',
  compare: 'Comparison',
}

const unreadableReason = (e: unknown) =>
  e instanceof BinaryFileError
    ? 'It is binary, or uses an encoding druk cannot read.'
    : (e as Error).message

const loadBuffer = (path: string): FileBuffer => {
  const { text, encoding } = readTextFile(path)
  return { content: text, saved: text, dirty: false, mtime: mtimeOf(path), encoding }
}

// Synchronous on purpose: the editor mounts with these buffers, or it renders an empty document.
export function restoreWorkspace(rootDir: string, single: string | null) {
  if (single) {
    try {
      const buffers: Record<string, FileBuffer> = isImagePath(single)
        ? {}
        : { [single]: loadBuffer(single) }
      return {
        buffers,
        tabs: [single],
        activePath: single as string | null,
        expanded: [] as string[],
        sidebar: false,
        failed: null as string | null,
      }
    } catch (e) {
      return {
        buffers: {},
        tabs: [],
        activePath: null,
        expanded: [] as string[],
        sidebar: false,
        failed: unreadableReason(e),
      }
    }
  }
  const saved = loadSession(rootDir)
  const buffers: Record<string, FileBuffer> = {}
  for (const path of saved.tabs) {
    if (isImagePath(path)) continue
    try {
      buffers[path] = loadBuffer(path)
    } catch {
      // unreadable since last time — the tab is dropped below
    }
  }
  const tabs = saved.tabs.filter(path => buffers[path] || (isImagePath(path) && exists(path)))
  const activePath =
    saved.activePath && tabs.includes(saved.activePath) ? saved.activePath : (tabs[0] ?? null)
  return {
    buffers,
    tabs,
    activePath,
    expanded: saved.expanded,
    sidebar: saved.sidebar,
    failed: null as string | null,
  }
}

type RestoredWorkspace = ReturnType<typeof restoreWorkspace>

export function createWorkspace(deps: {
  rootDir: string
  single: string | null
  restored: RestoredWorkspace
  settings: Settings
  status: Status
  tree: Tree
  panes: Panes
  editor: EditorBridge
  git: Git
  setPrompt: (prompt: Prompt) => void
}) {
  const { rootDir, single, restored, settings, status, tree, panes, editor, git, setPrompt } = deps
  const { say } = status
  const { config } = settings

  const [buffers, setBuffers] = createStore<Record<string, FileBuffer>>(restored.buffers)
  const [views, setViews] = createSignal<string[]>(restored.tabs)
  const [activeView, setActiveView] = createSignal<string | null>(restored.activePath)
  const tabs = () => views().filter(id => !pageKindOf(id))
  const [lastFile, setLastFile] = createSignal<string | null>(restored.activePath)
  // A memo, not an accessor: an `on(activePath)` effect would blur-autosave on landing on a page tab.
  const activePath = createMemo(() => {
    const view = activeView()
    if (view && !pageKindOf(view)) return view
    const file = lastFile()
    return file && views().includes(file) ? file : null
  })
  const [previewPath, setPreviewPath] = createSignal<string | null>(null)
  const [renderedPaths, setRenderedPaths] = createSignal<string[]>([])
  const page = () => {
    const view = activeView()
    return view ? pageKindOf(view) : null
  }
  const pageOpen = (kind: PageKind) => views().includes(pageId(kind))
  const pageClosers = new Map<PageKind, () => void>()
  const onPageClose = (kind: PageKind, close: () => void) => void pageClosers.set(kind, close)
  const [notice, setNotice] = createSignal<{ name: string; reason: string } | null>(null)
  const [conflict, setConflict] = createSignal<Conflict | null>(null)
  const [recentlyClosed, setRecentlyClosed] = createSignal<string[]>([])

  const activeBuffer = () => {
    const path = activePath()
    return path ? buffers[path] : undefined
  }

  const dirtyPaths = () => Object.keys(unwrap(buffers)).filter(path => buffers[path]?.dirty)

  // The abort kills the child, so Save without formatting cannot lose to a later flush.
  const formatEpoch: Record<string, number> = {}
  const formatAbort: Record<string, AbortController> = {}
  const formatWait: Record<string, Promise<void>> = {}
  // Cleared by id: content equality would drop a newer hold carrying the same bytes.
  const holdDisk: Record<string, { content: string; id: number }> = {}
  let holdSeq = 0

  const discardBuffer = (path: string) => {
    // Epoch, holdDisk and formatWait stay: a pending reassertAfterFormat still rewrites disk.
    formatAbort[path]?.abort()
    delete formatAbort[path]
    setBuffers(produce(draft => void delete draft[path]))
  }

  const openFile = (path: string, preview = false) => {
    setNotice(null)
    // An image gets a tab and no buffer: nothing without a buffer is written back.
    if (!buffers[path] && !isImagePath(path)) {
      try {
        setBuffers(path, loadBuffer(path))
      } catch (e) {
        setNotice({ name: basename(path), reason: unreadableReason(e) })
        return
      }
    }
    setViews(prev => {
      if (prev.includes(path)) return prev
      const slot = previewPath() ? prev.indexOf(previewPath()!) : -1
      if (preview && slot >= 0) return prev.map((p, i) => (i === slot ? path : p))
      return [...prev, path]
    })
    if (preview) {
      const previous = previewPath()
      if (previous && previous !== path) discardBuffer(previous)
      setPreviewPath(path)
    } else if (previewPath() === path) {
      setPreviewPath(null)
    }
    tree.reveal(path)
    tree.setSelectedPath(path)
    setActiveView(path)
    setLastFile(path)
    panes.setFocus('editor')
  }

  const pinTab = (path: string) => {
    if (previewPath() === path) setPreviewPath(null)
  }

  const activateNode = (node: TreeNode) => {
    tree.setSelectedPath(node.path)
    if (node.isDir) tree.toggleExpand(node.path)
    else openFile(node.path, true)
  }

  const closeTab = (path: string, discardUnsaved = false) => {
    if (!discardUnsaved && buffers[path]?.dirty) {
      return setPrompt({ kind: 'closeDirty', paths: [path], names: [basename(path)] })
    }
    const idx = views().indexOf(path)
    if (idx < 0) return
    const next = views().filter(p => p !== path)
    setViews(next)
    if (activeView() === path) {
      const fallback = next[idx] ?? next[idx - 1] ?? null
      setActiveView(fallback)
      if (!fallback && panes.sidebar()) panes.focusTree()
    }
    const kind = pageKindOf(path)
    if (kind) return void pageClosers.get(kind)?.()
    if (previewPath() === path) setPreviewPath(null)
    setRenderedPaths(prev => prev.filter(p => p !== path))
    discardBuffer(path)
    setRecentlyClosed(prev => [...prev.filter(p => p !== path), path])
  }

  const openPage = (kind: PageKind) => {
    const id = pageId(kind)
    setViews(prev => (prev.includes(id) ? prev : [...prev, id]))
    setActiveView(id)
  }

  const closePage = (kind?: PageKind) => {
    const target = kind ?? page()
    if (!target || !pageOpen(target)) return
    closeTab(pageId(target), true)
  }

  const reopenTab = () => {
    const stack = [...recentlyClosed()]
    while (stack.length > 0) {
      const path = stack.pop()!
      if (exists(path)) {
        setRecentlyClosed(stack)
        return openFile(path)
      }
    }
    setRecentlyClosed([])
    say('No closed tab to reopen', 'warn')
  }

  const closeTabs = (paths: string[], done: string) => {
    const dirty = paths.filter(path => buffers[path]?.dirty)
    if (dirty.length > 0) {
      return setPrompt({ kind: 'closeDirty', paths, names: dirty.map(path => basename(path)) })
    }
    for (const path of paths) closeTab(path, true)
    say(done)
  }

  const renderedPath = () => {
    const path = activePath()
    return path && isMarkdownPath(path) && renderedPaths().includes(path) ? path : null
  }

  const toggleRendered = () => {
    const path = activePath()
    if (!path || !isMarkdownPath(path)) {
      return say('Not a markdown file — the rendered view is for .md', 'warn')
    }
    const rendered = !renderedPaths().includes(path)
    setRenderedPaths(prev => (rendered ? [...prev, path] : prev.filter(p => p !== path)))
    panes.setFocus('editor')
    say(rendered ? `Rendering ${basename(path)}` : `Source of ${basename(path)}`)
  }

  const showView = (id: string) => {
    const kind = pageKindOf(id)
    if (!kind) return openFile(id)
    openPage(kind)
    panes.setFocus('editor')
  }

  const closeView = (id: string) => closeTab(id)

  const switchTab = (delta: number) => {
    const list = views()
    if (list.length === 0) return
    const at = activeView() ? list.indexOf(activeView()!) : 0
    showView(list[(at + delta + list.length) % list.length]!)
  }

  // Dirty is `content !== saved`, never a flag: undoing back to the loaded text clears it.
  const setContent = (path: string, text: string) => {
    setBuffers(path, { content: text, dirty: text !== buffers[path]!.saved })
  }

  const onEditorChange = (text: string) => {
    const path = activePath()
    if (!path || !buffers[path] || buffers[path].content === text) return
    pinTab(path)
    setContent(path, text)
  }

  // Pinned first: an edited preview tab must not be recycled out from under the edit.
  const applyReplacement = (path: string, next: string) => {
    pinTab(path)
    setContent(path, next)
    editor.pushEdit(next)
  }

  const mergeConflicts = createMemo<MergeConflict[]>(() =>
    parseConflicts(activeBuffer()?.content ?? ''),
  )

  const SIDE_LABELS: Record<ConflictSide, string> = {
    ours: 'current change',
    theirs: 'incoming change',
    both: 'both changes',
  }

  const acceptConflict = (line: number, side: ConflictSide) => {
    const path = activePath()
    const buffer = path ? buffers[path] : undefined
    if (!path || !buffer) return say('No file open', 'warn')
    const conflict = mergeConflicts().find(one => line >= one.start && line <= one.end)
    if (!conflict) return say('No merge conflict on this line', 'warn')
    applyReplacement(path, keepSide(buffer.content, conflict, side))
    editor.requestGoto(conflict.start, 0)
    const left = mergeConflicts().length
    const rest = left > 0 ? ` — ${left} conflict${left === 1 ? '' : 's'} left` : ''
    say(`Kept the ${SIDE_LABELS[side]}${rest}`)
  }

  const replaceOverlay = (): Map<string, string> => {
    const overlay = new Map<string, string>()
    const active = activePath()
    for (const [path, buffer] of Object.entries(buffers)) {
      if (buffer && (buffer.dirty || path === active)) overlay.set(path, buffer.content)
    }
    return overlay
  }

  const setHold = (path: string, content: string): number => {
    const id = ++holdSeq
    holdDisk[path] = { content, id }
    return id
  }

  const clearHold = (path: string, id: number) => {
    if (holdDisk[path]?.id === id) delete holdDisk[path]
  }

  const beginFormat = (
    path: string,
  ): { epoch: number; signal: AbortSignal; prior: Promise<void> | undefined } => {
    formatAbort[path]?.abort()
    const prior = formatWait[path]
    const ac = new AbortController()
    formatAbort[path] = ac
    const epoch = (formatEpoch[path] ?? 0) + 1
    formatEpoch[path] = epoch
    return { epoch, signal: ac.signal, prior }
  }

  const invalidateFormat = (path: string): number => {
    formatAbort[path]?.abort()
    delete formatAbort[path]
    const epoch = (formatEpoch[path] ?? 0) + 1
    formatEpoch[path] = epoch
    return epoch
  }

  const clearFormatState = (path: string) => {
    invalidateFormat(path)
    delete holdDisk[path]
    delete formatWait[path]
  }

  // SIGKILL is async: put `content` back once the child exits, or a late flush reaches a clean buffer.
  const reassertAfterFormat = (
    path: string,
    content: string,
    encoding: TextEncoding,
    epoch: number,
    hold: number,
  ) => {
    const pending = formatWait[path]
    if (!pending) {
      clearHold(path, hold)
      return
    }
    void pending.then(() => {
      if (formatEpoch[path] !== epoch) {
        clearHold(path, hold)
        return
      }
      // A move remapped this buffer; writing would recreate the file at the old path.
      if (!buffers[path] && !exists(path)) {
        clearHold(path, hold)
        return
      }
      writeFile(path, content, encoding)
      const buffer = buffers[path]
      if (buffer) {
        if (buffer.dirty) {
          setBuffers(path, 'mtime', mtimeOf(path))
        } else {
          setBuffers(path, {
            content,
            saved: content,
            dirty: false,
            mtime: mtimeOf(path),
            encoding,
          })
          if (path === activePath()) editor.pushEdit(content)
        }
      }
      clearHold(path, hold)
    })
  }

  const applyFormat = async (
    path: string,
    saved: string,
    command: string[],
    epoch: number,
    signal: AbortSignal,
    announce = true,
  ): Promise<'formatted' | 'noop' | 'busy' | 'superseded' | { failed: string }> => {
    const error = await runFormatter(command, path, rootDir, signal)
    if (formatEpoch[path] !== epoch || signal.aborted) return 'superseded'
    if (error) {
      if (announce) say(`Format failed: ${error}`, 'error')
      return { failed: error }
    }
    if (!buffers[path]) return 'noop'
    let written: FileBuffer
    try {
      // The formatter's own encoding wins, or a buffer claiming CRLF converts its work back.
      written = loadBuffer(path)
    } catch {
      return 'noop'
    }
    const disk = written.content
    const buffer = buffers[path]!
    if (buffer.dirty) {
      setBuffers(path, 'mtime', mtimeOf(path))
      return 'busy'
    }
    if (disk === buffer.content) {
      setBuffers(path, { mtime: written.mtime, encoding: written.encoding })
      return disk !== saved ? 'formatted' : 'noop'
    }
    setBuffers(path, written)
    if (path === activePath()) editor.pushEdit(disk)
    git.bump()
    return 'formatted'
  }

  const formatAfterSave = (path: string, saved: string, command: string[]) => {
    const { epoch, signal, prior } = beginFormat(path)
    // A late flush from the killed `prior` child must not reach the buffer before `saved` is on disk.
    const hold = setHold(path, saved)
    const task = (async () => {
      if (prior) await prior
      if (formatEpoch[path] !== epoch) {
        clearHold(path, hold)
        return
      }
      const buffer = buffers[path]
      if (buffer && !buffer.dirty && buffer.content === saved) {
        writeFile(path, saved, buffer.encoding)
        setBuffers(path, 'mtime', mtimeOf(path))
      }
      if (formatEpoch[path] !== epoch) {
        clearHold(path, hold)
        return
      }
      const result = await applyFormat(path, saved, command, epoch, signal)
      if (formatEpoch[path] !== epoch) {
        clearHold(path, hold)
        return
      }
      if (result === 'formatted') say(`Formatted ${basename(path)}`)
      clearHold(path, hold)
    })()
    formatWait[path] = task.then(
      () => undefined,
      () => undefined,
    )
  }

  const writeBuffer = (
    path: string,
    content: string,
    opts?: { runFormat?: boolean; quiet?: boolean },
  ): boolean => {
    const final = config.trimOnSave ? trimTrailing(content) : content
    // Written back as read: a CRLF tree or a BOM must not become a whole-file diff.
    const encoding = buffers[path]?.encoding ?? DEFAULT_ENCODING
    const err = writeFile(path, final, encoding)
    if (err) {
      say(`Save failed: ${err}`, 'error')
      return false
    }
    setBuffers(path, { content: final, saved: final, dirty: false, mtime: mtimeOf(path) })
    const runFormat = opts?.runFormat ?? config.formatOnSave
    // Spawned first: the formatter is the slow half, and everything below runs while the child does.
    if (runFormat) {
      const command = formatterFor(path, config.formatters)
      if (command) formatAfterSave(path, final, command)
      else {
        const epoch = invalidateFormat(path)
        const hold = setHold(path, final)
        reassertAfterFormat(path, final, encoding, epoch, hold)
      }
    } else {
      // A plain save must not lose to a formatter that flushes after the write.
      const epoch = invalidateFormat(path)
      const hold = setHold(path, final)
      reassertAfterFormat(path, final, encoding, epoch, hold)
    }
    if (final !== content && path === activePath()) editor.pushEdit(final)
    git.bump()
    if (!opts?.quiet) say(`Saved ${basename(path)}`)
    return true
  }

  // mtime alone is not enough, and a late formatter flush under a hold is not a clash.
  const clashes = (path: string, buffer: FileBuffer): boolean => {
    if (mtimeOf(path) === buffer.mtime) return false
    const hold = holdDisk[path]
    if (hold && buffer.content === hold.content) return false
    if (!exists(path)) return true
    try {
      return readTextFile(path).text !== buffer.content
    } catch {
      return true
    }
  }

  const prepareSave = (path: string, buffer: FileBuffer): boolean => {
    if (mtimeOf(path) === buffer.mtime) return true
    const hold = holdDisk[path]
    if (hold && buffer.content === hold.content) return true
    if (!exists(path)) {
      setConflict({ path, disk: '', encoding: buffer.encoding, deleted: true })
      return false
    }
    let disk = ''
    let encoding = buffer.encoding
    try {
      ;({ text: disk, encoding } = readTextFile(path))
    } catch {
      // unreadable (binary now) — treat as empty
    }
    if (disk === buffer.content) return true
    setConflict({ path, disk, encoding, deleted: false })
    return false
  }

  const saveActive = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return
    if (!prepareSave(path, buffer)) return
    writeBuffer(path, buffer.content)
  }

  const saveWithoutFormatting = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return
    if (!prepareSave(path, buffer)) return
    writeBuffer(path, buffer.content, { runFormat: false })
  }

  const formatPath = (path: string): boolean => {
    const buffer = buffers[path]
    if (!buffer) return false
    const command = formatterFor(path, config.formatters)
    if (!command) return false
    // Clean tabs too: an in-place formatter reads disk and would fold an outside edit into the buffer.
    if (!prepareSave(path, buffer)) return false
    if (buffer.dirty) {
      if (!writeBuffer(path, buffer.content, { runFormat: false, quiet: true })) return false
    }
    formatAfterSave(path, buffers[path]!.content, command)
    return true
  }

  const formatActive = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return say('No file open', 'warn')
    if (!formatterFor(path, config.formatters)) {
      return say('No formatter for this file — add one in Settings → Formatters', 'warn')
    }
    formatPath(path)
  }

  const formatOpen = () => {
    const paths = tabs().filter(path => buffers[path] && formatterFor(path, config.formatters))
    if (paths.length === 0) return say('Nothing to format')

    void (async () => {
      const done: string[] = []
      let unchanged = 0
      let failed = 0
      let skipped = 0
      let interrupted = 0
      const failNotes: string[] = []
      // Sequential: parallel formatters would race the status bar and overlapping writes.
      for (const path of paths) {
        const buffer = buffers[path]
        if (!buffer) continue
        const command = formatterFor(path, config.formatters)
        if (!command) continue
        if (clashes(path, buffer)) {
          skipped++
          continue
        }
        if (buffer.dirty) {
          if (!writeBuffer(path, buffer.content, { runFormat: false, quiet: true })) {
            failed++
            continue
          }
        }
        const { epoch, signal, prior } = beginFormat(path)
        const saved = buffers[path]!.content
        const hold = setHold(path, saved)
        const task = (async () => {
          if (prior) await prior
          if (formatEpoch[path] !== epoch) {
            clearHold(path, hold)
            return 'superseded' as const
          }
          const current = buffers[path]
          if (current && !current.dirty && current.content === saved) {
            writeFile(path, saved, current.encoding)
            setBuffers(path, 'mtime', mtimeOf(path))
          }
          if (formatEpoch[path] !== epoch) {
            clearHold(path, hold)
            return 'superseded' as const
          }
          const result = await applyFormat(path, saved, command, epoch, signal, false)
          clearHold(path, hold)
          return result
        })()
        formatWait[path] = task.then(
          () => undefined,
          () => undefined,
        )
        // eslint-disable-next-line no-await-in-loop -- one formatter at a time, on purpose
        const result = await task
        if (result === 'formatted') done.push(path)
        else if (typeof result === 'object') {
          failed++
          failNotes.push(`${basename(path)}: ${result.failed}`)
        } else if (formatEpoch[path] !== epoch || result === 'superseded' || result === 'busy') {
          clearHold(path, hold)
          interrupted++
        } else if (result === 'noop') unchanged++
        else {
          clearHold(path, hold)
          interrupted++
        }
      }
      const bits: string[] = []
      if (done.length === 1) bits.push(`Formatted ${basename(done[0]!)}`)
      else if (done.length > 1) bits.push(`Formatted ${done.length} files`)
      else if (unchanged > 0) bits.push('No formatting changes')
      if (interrupted > 0) {
        bits.push(bits.length === 0 ? 'Formatting interrupted' : `${interrupted} interrupted`)
      }
      if (skipped > 0) {
        bits.push(
          bits.length === 0
            ? 'Skipped files changed on disk'
            : `${skipped} skipped — changed on disk`,
        )
      }
      if (failed > 0) {
        bits.push(failNotes.length === 1 ? failNotes[0]! : `${failed} failed`)
      }
      if (bits.length === 0) say('Nothing to format')
      else {
        const tone = failed > 0 ? 'error' : skipped > 0 || interrupted > 0 ? 'warn' : 'info'
        say(bits.join('; '), tone)
      }
    })()
  }

  const autoSave = (path: string): 'saved' | 'skipped' | 'failed' => {
    const buffer = buffers[path]!
    if (mtimeOf(path) !== buffer.mtime) return 'skipped'
    return writeBuffer(path, buffer.content) ? 'saved' : 'failed'
  }

  const saveDirty = () => {
    const skipped: string[] = []
    const failed: string[] = []
    let saved = 0
    for (const path of Object.keys(buffers)) {
      if (!buffers[path]!.dirty) continue
      const result = autoSave(path)
      if (result === 'saved') saved++
      else if (result === 'skipped') skipped.push(basename(path))
      else failed.push(basename(path))
    }
    return { saved, skipped, failed }
  }

  const saveDirtyOnBlur = () => {
    const { saved, skipped, failed } = saveDirty()
    if (saved > 1) say(`Saved ${saved} files`)
    if (skipped.length > 0) say(`${CLASH_CHANGED}${skipped.join(', ')}`, 'warn')
    if (failed.length > 0) say(`Save failed: ${failed.join(', ')}`, 'error')
  }

  const saveAll = () => {
    const { saved, skipped, failed } = saveDirty()
    if (saved === 0 && skipped.length === 0 && failed.length === 0) return say('Nothing to save')
    if (saved > 1) say(`Saved ${saved} files`)
    if (skipped.length > 0) say(`${CLASH_CHANGED}${skipped.join(', ')}`, 'warn')
    if (failed.length > 0) say(`Save failed: ${failed.join(', ')}`, 'error')
  }

  const resolveConflict = (choice: string) => {
    const c = conflict()
    setConflict(null)
    if (!c) return
    if (choice === 'overwrite' && buffers[c.path]) {
      writeBuffer(c.path, buffers[c.path]!.content)
    } else if (choice === 'reload') {
      clearFormatState(c.path)
      setBuffers(c.path, {
        content: c.disk,
        saved: c.disk,
        dirty: false,
        mtime: mtimeOf(c.path),
        encoding: c.encoding,
      })
      editor.bumpReload()
      say(`Reloaded ${basename(c.path)} from disk`)
    }
  }

  const syncFromDisk = (): DiskSync => {
    const updates: [string, FileBuffer][] = []
    const changed: string[] = []
    const deleted: string[] = []
    const vanished: string[] = []
    for (const path of Object.keys(buffers)) {
      const buffer = buffers[path]!
      if (!exists(path)) {
        if (buffer.dirty) deleted.push(basename(path))
        else vanished.push(path)
        continue
      }
      let fresh: FileBuffer
      try {
        fresh = loadBuffer(path)
      } catch {
        continue
      }
      if (fresh.content === buffer.content) {
        // Same text, other encoding: the next save must follow suit, not convert back.
        if (
          fresh.encoding.eol !== buffer.encoding.eol ||
          fresh.encoding.bom !== buffer.encoding.bom
        )
          setBuffers(path, 'encoding', fresh.encoding)
        // holdDisk is not cleared here: only the hold id's owner may drop it.
        continue
      }
      // An aborted formatter may still flush: the hold blocks clean pulls until reassert rewrites disk.
      if (holdDisk[path] !== undefined) {
        if (buffer.dirty) changed.push(basename(path))
        continue
      }
      if (buffer.dirty) changed.push(basename(path))
      else updates.push([path, fresh])
    }
    // Viewer tabs have no buffer, so the walk above never sees them.
    for (const path of tabs()) {
      if (!buffers[path] && !exists(path)) vanished.push(path)
    }
    // After the walk: closing a tab mutates the store being iterated.
    for (const path of vanished) closeTab(path, true)
    if (updates.length > 0) {
      setBuffers(
        produce(draft => {
          for (const [path, buffer] of updates) draft[path] = buffer
        }),
      )
      editor.bumpReload()
    }
    tree.refreshTree()
    return { changed, deleted }
  }

  const followDisk = (path: string) => {
    clearFormatState(path)
    if (conflict()?.path === path) setConflict(null)
    if (!exists(path)) {
      if (tabs().includes(path)) closeTab(path, true)
    } else if (buffers[path]) {
      try {
        setBuffers(path, loadBuffer(path))
        if (path === activePath()) editor.bumpReload()
      } catch {
        closeTab(path, true)
      }
    }
    tree.refreshTree()
  }

  const applyMatchReplace = (match: Match, replacement: string) => {
    const open = replaceOverlay().get(match.path)
    if (open != null) {
      const next = replaceMatch(open, match, replacement)
      if (next === null) return say('That match is gone', 'warn')
      pinTab(match.path)
      setContent(match.path, next)
      if (match.path === activePath()) editor.pushEdit(next)
      return
    }
    let read: { text: string; encoding: TextEncoding }
    try {
      read = readTextFile(match.path)
    } catch {
      return say('That match is gone', 'warn')
    }
    const next = replaceMatch(read.text, match, replacement)
    if (next === null) return say('That match is gone', 'warn')
    const error = writeFile(match.path, next, read.encoding)
    if (error) return say(`Replace failed: ${error}`, 'error')
    syncFromDisk()
    git.bump()
  }

  const applyProjectReplace = (
    paths: readonly string[],
    query: string,
    replacement: string,
    options: SearchOptions,
  ) => {
    const overlay = replaceOverlay()
    const result = replaceProject(paths, query, replacement, options, overlay)

    let pending = 0
    let wroteDisk = false
    const active = activePath()
    for (const file of result.replaced) {
      if (file.content == null) {
        wroteDisk = true
        continue
      }
      pinTab(file.path)
      setContent(file.path, file.content)
      // pushEdit targets the active editor; another file's text would paint over it.
      if (file.path === active) editor.pushEdit(file.content)
      pending++
    }
    if (wroteDisk) {
      syncFromDisk()
      git.bump()
    }

    const files = result.replaced.length
    if (result.matches === 0 && result.failed.length === 0) return say('Nothing to replace')
    const counts = `Replaced ${result.matches} ${result.matches === 1 ? 'match' : 'matches'} in ${files} ${files === 1 ? 'file' : 'files'}`
    const tail = pending > 0 ? ` — ${pending} in open tabs, unsaved` : ''
    if (result.failed.length > 0) {
      const names = result.failed.map(entry => basename(entry.split(' — ')[0]!)).join(', ')
      say(`${counts}${tail}; failed: ${names}`, 'warn')
    } else {
      say(`${counts}${tail}`)
    }
  }

  const clashWarning = (sync: DiskSync): string | null => {
    const parts: string[] = []
    if (sync.changed.length > 0) parts.push(`${CLASH_CHANGED}${sync.changed.join(', ')}`)
    if (sync.deleted.length > 0) parts.push(`${CLASH_DELETED}${sync.deleted.join(', ')}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  const remapPaths = (remap: (path: string) => string) => {
    setViews(prev => prev.map(remap))
    // Snapshotted first: moving a buffer writes to the store being walked.
    for (const path of Object.keys(unwrap(buffers))) {
      const next = remap(path)
      if (next === path) continue
      setBuffers(next, { ...buffers[path]! })
      // discardBuffer keeps a pending reassertAfterFormat, which recreates the file at the old path.
      clearFormatState(path)
      discardBuffer(path)
    }
    const active = lastFile()
    if (active) setLastFile(remap(active))
    const view = activeView()
    if (view) setActiveView(remap(view))
    const preview = previewPath()
    if (preview) setPreviewPath(remap(preview))
    setRenderedPaths(prev => prev.map(remap))
  }

  const autoSaveLeft = (path: string) => {
    if (!config.autoSaveOnBlur) return
    if (!tabs().includes(path)) return
    if (!buffers[path]?.dirty) return
    if (autoSave(path) === 'skipped') say(`${CLASH_CHANGED}${basename(path)}`, 'warn')
  }

  createEffect(
    on(
      activePath,
      (_next, prev) => {
        if (prev) autoSaveLeft(prev)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      panes.focus,
      (next, prev) => {
        if (next === 'editor' || prev !== 'editor') return
        const path = activePath()
        if (path) autoSaveLeft(path)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [tabs(), activePath(), tree.expanded(), panes.sidebar()] as const,
      ([openTabs, active, folders, showTree]) => {
        // `druk one.ts` must not save a one-tab layout over the folder's session.
        if (single) return
        saveSession(rootDir, {
          tabs: openTabs,
          activePath: active,
          expanded: [...folders],
          sidebar: showTree,
        })
      },
    ),
  )

  return {
    buffers,
    tabs,
    activePath,
    previewPath,
    renderedPath,
    toggleRendered,
    notice,
    setNotice,
    conflict,
    setConflict,
    mergeConflicts,
    acceptConflict,
    activeBuffer,
    dirtyPaths,
    page,
    pageOpen,
    openPage,
    closePage,
    onPageClose,
    views,
    activeView,
    showView,
    closeView,
    openFile,
    pinTab,
    activateNode,
    closeTab,
    closeTabs,
    reopenTab,
    switchTab,
    onEditorChange,
    applyReplacement,
    replaceOverlay,
    applyMatchReplace,
    applyProjectReplace,
    writeBuffer,
    saveActive,
    saveWithoutFormatting,
    saveAll,
    formatActive,
    formatOpen,
    saveDirtyOnBlur,
    resolveConflict,
    syncFromDisk,
    followDisk,
    clashWarning,
    remapPaths,
  }
}

export type Workspace = ReturnType<typeof createWorkspace>
