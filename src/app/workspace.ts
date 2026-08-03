import { basename } from 'node:path'

import { createEffect, createSignal, on } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

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
import { isPdfPath } from '../core/pdf'
import { replaceMatch, replaceProject } from '../core/search'
import type { Match, SearchOptions } from '../core/search'
import { loadSession, saveSession } from '../core/session'
import { trimTrailing } from '../editor/lines'
import type { DiffFile } from '../ui/DiffView'
import type { EditorBridge } from './editor'
import type { Git } from './git'
import type { Panes } from './panes'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Conflict, DiskSync, FileBuffer, Prompt } from './types'

/**
 * Prefixes of the watcher's clash warnings, so it can recognise its own message and
 * clear it again. A deleted file is not a changed one — saying "changed" for a file
 * that is gone sends the user looking for a diff that does not exist.
 */
export const CLASH_CHANGED = 'Changed on disk with unsaved edits: '
export const CLASH_DELETED = 'Deleted on disk with unsaved edits: '

const isViewerPath = (path: string) => isImagePath(path) || isPdfPath(path)

const unreadableReason = (e: unknown) =>
  e instanceof BinaryFileError
    ? 'It is binary, or uses an encoding druk cannot read.'
    : (e as Error).message

/** A clean buffer for a file on disk. Throws whatever reading it throws. */
const loadBuffer = (path: string): FileBuffer => {
  const { text, encoding } = readTextFile(path)
  return { content: text, dirty: false, mtime: mtimeOf(path), encoding }
}

/**
 * What the editor mounts with. Restored synchronously: the editor must mount with
 * its buffers already in place, otherwise it renders an empty document and marks
 * it modified.
 */
export function restoreWorkspace(rootDir: string, single: string | null) {
  // Asked for one file, so that is what opens: no saved tabs, no expanded folders,
  // and the sidebar out of the way. The session is neither read nor written — the
  // folder's own layout is not this invocation's to inherit or to overwrite.
  if (single) {
    try {
      // A viewer opens with no buffer, so nothing can write it back.
      const buffers: Record<string, FileBuffer> = isViewerPath(single)
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
      // Unreadable or not text. The editor still starts — with nothing open, and
      // the reason on the status bar once there is a status bar to put it on.
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
    if (isViewerPath(path)) continue // a viewer tab has no buffer to restore
    try {
      buffers[path] = loadBuffer(path)
    } catch {
      // unreadable since last time — the tab is dropped below
    }
  }
  const tabs = saved.tabs.filter(path => buffers[path] || (isViewerPath(path) && exists(path)))
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

export type RestoredWorkspace = ReturnType<typeof restoreWorkspace>

/** Open buffers and tabs: opening, closing, saving, and staying true to the disk. */
export function createWorkspace(deps: {
  rootDir: string
  /** `druk file.ts`: single-file mode leaves the folder's saved session alone. */
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
  const [tabs, setTabs] = createSignal<string[]>(restored.tabs)
  const [activePath, setActivePath] = createSignal<string | null>(restored.activePath)
  // Preview tab (VS Code style): opened from the tree, reused by the next
  // preview, and promoted to a permanent tab on click, double-click or edit.
  const [previewPath, setPreviewPath] = createSignal<string | null>(null)
  /**
   * Markdown tabs reading as the rendered document rather than as their text.
   * Per path, not one flag for the editor: a file switched away from and back to
   * comes back the way it was left. Both halves are the one buffer — this says
   * which of the two the editor slot is showing, nothing more.
   */
  const [renderedPaths, setRenderedPaths] = createSignal<string[]>([])
  /**
   * The diff tab: its two texts as they read when it was opened, or null for no
   * such tab. It is a tab like any other — the strip shows it, Ctrl+←/→ walks onto
   * it — so opening a file switches away from it without closing it, and only
   * `setDiff(null)` (Ctrl+W, Esc, or the change going away) takes it off the strip.
   */
  const [diffTab, setDiffTab] = createSignal<DiffFile | null>(null)
  /** Whether the diff tab is the one on screen, rather than the active file. */
  const [diffShown, setDiffShown] = createSignal(false)
  /**
   * The diff covering the editor slot, or null when a file is showing. Two states
   * rather than one because the tab outlives its turn on screen; readers that ask
   * "what is the editor slot showing" want this one.
   */
  const diff = () => (diffShown() ? diffTab() : null)
  /** Open the diff tab and show it, or take it off the strip for null. */
  const setDiff = (file: DiffFile | null) => {
    setDiffTab(file)
    setDiffShown(file !== null)
  }
  /** The full-slot pages — settings, LSP status — which cover the editor the
   * same way the diff does. One at a time: each is a view of the editor slot. */
  const [page, setPage] = createSignal<'settings' | 'lspStatus' | null>(null)
  /** A file that would not open, shown over the editor until the next keypress. */
  const [notice, setNotice] = createSignal<{ name: string; reason: string } | null>(null)
  const [conflict, setConflict] = createSignal<Conflict | null>(null)
  /** Paths of closed tabs, oldest first, for "reopen closed tab". */
  const [recentlyClosed, setRecentlyClosed] = createSignal<string[]>([])

  const activeBuffer = () => {
    const path = activePath()
    return path ? buffers[path] : undefined
  }

  const dirtyPaths = () => Object.keys(unwrap(buffers)).filter(path => buffers[path]?.dirty)

  const discardBuffer = (path: string) => setBuffers(produce(draft => void delete draft[path]))

  const openFile = (path: string, preview = false) => {
    setNotice(null)
    // The file is what the editor slot shows now. The diff tab stays on the strip,
    // as a file tab would — it is switched away from, not closed.
    setDiffShown(false)
    setPage(null)
    // Images and PDFs get a viewer tab and no buffer — the door stays shut to a
    // FileBuffer for anything that is not text, which is what keeps "never written
    // back" structural. The tab itself uses the same preview/pin/session logic.
    if (!buffers[path] && !isViewerPath(path)) {
      try {
        setBuffers(path, loadBuffer(path))
      } catch (e) {
        // Nothing druk can show, so no tab and no buffer — which is what keeps a file
        // like this from ever being written back. The refusal goes over the editor
        // rather than into the status bar: down there it reads as a footnote to the
        // file still on screen, and the answer to "open this" was no.
        setNotice({ name: basename(path), reason: unreadableReason(e) })
        return
      }
    }
    setTabs(prev => {
      if (prev.includes(path)) return prev
      // A preview tab takes the previous preview's slot instead of stacking up.
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
    setActivePath(path)
    panes.setFocus('editor')
  }

  /** Promote the preview tab to a permanent one (click, double-click, edit). */
  const pinTab = (path: string) => {
    if (previewPath() === path) setPreviewPath(null)
  }

  const activateNode = (node: TreeNode) => {
    tree.setSelectedPath(node.path)
    if (node.isDir) tree.toggleExpand(node.path)
    else openFile(node.path, true)
  }

  /**
   * Closing drops the buffer, and sessions persist only paths — so unsaved edits
   * are gone for good. `discardUnsaved` is the caller promising that is intended.
   */
  const closeTab = (path: string, discardUnsaved = false) => {
    if (!discardUnsaved && buffers[path]?.dirty) {
      return setPrompt({ kind: 'closeDirty', paths: [path], names: [basename(path)] })
    }
    const idx = tabs().indexOf(path)
    const next = tabs().filter(p => p !== path)
    setTabs(next)
    if (activePath() === path) {
      const fallback = next[idx] ?? next[idx - 1] ?? null
      setActivePath(fallback)
      if (!fallback && panes.sidebar()) panes.focusTree()
    }
    if (previewPath() === path) setPreviewPath(null)
    setRenderedPaths(prev => prev.filter(p => p !== path))
    discardBuffer(path)
    setRecentlyClosed(prev => [...prev.filter(p => p !== path), path])
  }

  /** Bring back the most recently closed tab whose file still exists. */
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

  /** Close a batch, asking once if any of them has unsaved edits. */
  const closeTabs = (paths: string[], done: string) => {
    const dirty = paths.filter(path => buffers[path]?.dirty)
    if (dirty.length > 0) {
      return setPrompt({ kind: 'closeDirty', paths, names: dirty.map(path => basename(path)) })
    }
    for (const path of paths) closeTab(path, true)
    say(done)
  }

  /**
   * The path the editor slot should render as markdown, or null for the text.
   * The diff and the pages sit above this one, so it answers only for a file tab.
   */
  const renderedPath = () => {
    const path = activePath()
    return path && isMarkdownPath(path) && renderedPaths().includes(path) ? path : null
  }

  /** Swap the active markdown tab between the rendered document and its text. */
  const toggleRendered = () => {
    const path = activePath()
    if (!path || !isMarkdownPath(path)) {
      return say('Not a markdown file — the rendered view is for .md', 'warn')
    }
    const rendered = !renderedPaths().includes(path)
    setRenderedPaths(prev => (rendered ? [...prev, path] : prev.filter(p => p !== path)))
    // The editor keeps the keyboard while its own text is up; taking focus back
    // is what lets the reader scroll without clicking first.
    panes.setFocus('editor')
    say(rendered ? `Rendering ${basename(path)}` : `Source of ${basename(path)}`)
  }

  /** The diff tab's id in the strip. Not a path: a file and its diff are two tabs
   * naming one file. */
  const diffTabId = () => (diffTab() ? `diff:${diffTab()!.path}` : null)

  /** Every tab in strip order, the diff among them — what Ctrl+←/→ walks. */
  const views = () => {
    const id = diffTabId()
    return id ? [...tabs(), id] : tabs()
  }

  /** Which tab is on screen. */
  const activeView = () => (diffShown() ? diffTabId() : activePath())

  /** True for the diff tab's id: the strip labels it, and closing it is not a
   * file being closed. */
  const isDiffView = (id: string) => id === diffTabId()

  /** Show the tab `id` names — a path, or the diff tab, which is already built. */
  const showView = (id: string) => {
    if (isDiffView(id)) {
      setDiffShown(true)
      setPage(null)
      return panes.setFocus('editor')
    }
    openFile(id)
  }

  /** Close the tab `id` names, page or file. */
  const closeView = (id: string) => (isDiffView(id) ? setDiff(null) : closeTab(id))

  const switchTab = (delta: number) => {
    const list = views()
    if (list.length === 0) return
    const at = activeView() ? list.indexOf(activeView()!) : 0
    showView(list[(at + delta + list.length) % list.length]!)
  }

  const onEditorChange = (text: string) => {
    const path = activePath()
    // No buffer means a viewer tab — creating one here would hand its bytes to the
    // save path. The editor is blocked while a viewer is up, but this is the guard
    // that makes the invariant hold rather than depend on that.
    if (!path || !buffers[path] || buffers[path].content === text) return
    pinTab(path)
    setBuffers(path, { content: text, dirty: true })
  }

  /** Put replaced text into the buffer. The tab is pinned first: an edited preview
   * tab must never be recycled out from under the edit. */
  const applyReplacement = (path: string, next: string) => {
    pinTab(path)
    setBuffers(path, { content: next, dirty: true })
    editor.pushEdit(next)
  }

  /**
   * The buffers a project search or replace must read instead of the disk:
   * dirty ones, whose edits the disk does not have, and the active one, whose
   * undo history is the one place a replace can stay reversible. A clean
   * non-active buffer is deliberately absent — its disk copy says the same
   * thing, and the disk route leaves no unsaved tab behind.
   */
  const replaceOverlay = (): Map<string, string> => {
    const overlay = new Map<string, string>()
    const active = activePath()
    for (const [path, buffer] of Object.entries(buffers)) {
      if (buffer && (buffer.dirty || path === active)) overlay.set(path, buffer.content)
    }
    return overlay
  }

  /**
   * Save-then-format: the formatter rewrites the file in place, and the result
   * comes back into the buffer only if nothing typed over it while the tool ran
   * — a keystroke during the run wins, and the next save reformats anyway. The
   * mtime is re-synced in every branch, so the formatter's own write is never
   * mistaken for an outside edit by the next save's conflict check.
   */
  const formatAfterSave = (path: string, saved: string, command: string[]) => {
    void runFormatter(command, path, rootDir).then(error => {
      if (error) return say(`Format failed: ${error}`, 'error')
      if (!buffers[path]) return // closed while the formatter ran
      let written: FileBuffer
      try {
        // The formatter's own spelling wins: prettier writes LF by default, and a
        // buffer still claiming CRLF would convert its work back on the next save.
        written = loadBuffer(path)
      } catch {
        return // unreadable now — the watcher's sync will report it
      }
      const disk = written.content
      const buffer = buffers[path]!
      // A keystroke while the tool ran wins; the next save reformats anyway.
      if (buffer.dirty) return setBuffers(path, 'mtime', mtimeOf(path))
      if (disk === buffer.content) {
        // Nothing to pull in: the formatter changed nothing, or the watcher's
        // sync raced this callback and already applied its write.
        setBuffers(path, { mtime: written.mtime, encoding: written.encoding })
        if (disk !== saved) say(`Formatted ${basename(path)}`)
        return
      }
      setBuffers(path, written)
      if (path === activePath()) editor.pushEdit(disk)
      git.bump()
      say(`Formatted ${basename(path)}`)
    })
  }

  /** Write the buffer to disk unconditionally and re-sync its mtime. */
  const writeBuffer = (path: string, content: string): boolean => {
    const final = config.trimOnSave ? trimTrailing(content) : content
    // The file goes back spelled the way it was read: a CRLF working tree or a
    // BOM the user never touched must not turn into a whole-file diff.
    const encoding = buffers[path]?.encoding ?? DEFAULT_ENCODING
    const err = writeFile(path, final, encoding)
    if (err) {
      say(`Save failed: ${err}`, 'error')
      return false
    }
    setBuffers(path, { content: final, dirty: false, mtime: mtimeOf(path) })
    // Spawned before anything else this save does: the formatter is the longest
    // thing on the path between Ctrl+S and the reformatted text, and every line
    // below it — the editor push, the git refresh — is work that can happen while
    // the child runs. Started after them, it waits for all of it first.
    if (config.formatOnSave) {
      const command = formatterFor(path, config.formatters)
      if (command) formatAfterSave(path, final, command)
    }
    // The trim changed the text on disk; the editor has to show the same thing —
    // and as an undoable step, not a history-wiping reload.
    if (final !== content && path === activePath()) editor.pushEdit(final)
    git.bump()
    say(`Saved ${basename(path)}`)
    return true
  }

  const saveActive = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return
    // Someone else touched the file since we loaded it — ask before clobbering.
    if (mtimeOf(path) !== buffer.mtime) {
      if (!exists(path)) {
        setConflict({ path, disk: '', encoding: buffer.encoding, deleted: true })
        return
      }
      let disk = ''
      let encoding = buffer.encoding
      try {
        ;({ text: disk, encoding } = readTextFile(path))
      } catch {
        // unreadable (binary now) — treat as empty
      }
      if (disk !== buffer.content) {
        setConflict({ path, disk, encoding, deleted: false })
        return
      }
    }
    writeBuffer(path, buffer.content)
  }

  /**
   * Auto-save is deliberately quieter than Ctrl+S: a buffer whose file changed on
   * disk is skipped with a warning instead of opening the conflict modal — the
   * user has just switched away and is not there to answer it.
   */
  const autoSave = (path: string): 'saved' | 'skipped' | 'failed' => {
    const buffer = buffers[path]!
    if (mtimeOf(path) !== buffer.mtime) return 'skipped'
    return writeBuffer(path, buffer.content) ? 'saved' : 'failed'
  }

  const saveDirtyOnBlur = () => {
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
    // One file keeps writeBuffer's own message; several get a count instead.
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
      setBuffers(c.path, {
        content: c.disk,
        dirty: false,
        mtime: mtimeOf(c.path),
        encoding: c.encoding,
      })
      editor.bumpReload()
      say(`Reloaded ${basename(c.path)} from disk`)
    }
  }

  /**
   * Pull disk changes into open buffers — used by the watcher and after a checkout.
   * Returns the dirty buffers it refused to touch, for the caller to report: every
   * caller follows this with its own `say`, which would bury a warning said here.
   */
  const syncFromDisk = (): DiskSync => {
    const updates: [string, FileBuffer][] = []
    const changed: string[] = []
    const deleted: string[] = []
    const vanished: string[] = []
    for (const path of Object.keys(buffers)) {
      const buffer = buffers[path]!
      // The file is gone — deleted here, removed by a checkout, or cleaned up
      // outside. A clean buffer has nothing left to show, so its tab goes with it.
      // A dirty one keeps the tab: saving recreates the file, which is exactly what
      // the deleted-on-disk conflict prompt offers.
      if (!exists(path)) {
        if (buffer.dirty) deleted.push(basename(path))
        else vanished.push(path)
        continue
      }
      let fresh: FileBuffer
      try {
        fresh = loadBuffer(path)
      } catch {
        continue // unreadable, or binary now — the tree refresh below reflects it
      }
      if (fresh.content === buffer.content) {
        // Same text, spelled differently: something outside converted the endings
        // or dropped the BOM. Nothing to repaint, but the next save has to follow
        // suit rather than convert the file back.
        if (
          fresh.encoding.eol !== buffer.encoding.eol ||
          fresh.encoding.bom !== buffer.encoding.bom
        )
          setBuffers(path, 'encoding', fresh.encoding)
        continue
      }
      // Unsaved edits stay untouched; the user is warned and asked on save.
      if (buffer.dirty) changed.push(basename(path))
      else updates.push([path, fresh])
    }
    // Viewer tabs have no buffer, so the walk above never sees them; a deleted
    // image or PDF has nothing to show and its tab goes the way of a clean buffer's.
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

  /**
   * Replace the one match a panel row points at, wherever its file is: the
   * overlay's text for buffered paths, a fresh encoding-preserving read for the
   * rest. The drift guard runs against whichever text the apply would touch.
   */
  const applyMatchReplace = (match: Match, replacement: string) => {
    const open = replaceOverlay().get(match.path)
    if (open != null) {
      const next = replaceMatch(open, match, replacement)
      if (next === null) return say('That match is gone', 'warn')
      pinTab(match.path)
      setBuffers(match.path, { content: next, dirty: true })
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

  /**
   * Replace across the planned `paths`. Reported counts are what the pass did,
   * not what the confirm promised — the two drift whenever the tree moves while
   * the modal is up.
   */
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
      setBuffers(file.path, { content: file.content, dirty: true })
      // Any other buffer is updated in the store alone: pushEdit targets the
      // active editor, and would paint this file's text over the one on screen.
      if (file.path === active) editor.pushEdit(file.content)
      pending++
    }
    if (wroteDisk) {
      // The watcher would get there in a debounce anyway; syncing now means the
      // reloaded clean buffers and the git marks never lag the status message.
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

  /** The watcher's warning for a sync, or null when nothing clashed. */
  const clashWarning = (sync: DiskSync): string | null => {
    const parts: string[] = []
    if (sync.changed.length > 0) parts.push(`${CLASH_CHANGED}${sync.changed.join(', ')}`)
    if (sync.deleted.length > 0) parts.push(`${CLASH_DELETED}${sync.deleted.join(', ')}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  /** Point every open tab, buffer and the active/preview slots at moved paths. */
  const remapPaths = (remap: (path: string) => string) => {
    setTabs(prev => prev.map(remap))
    // Snapshotted first: moving a buffer writes to the store being walked.
    for (const path of Object.keys(unwrap(buffers))) {
      const next = remap(path)
      if (next === path) continue
      setBuffers(next, { ...buffers[path]! })
      discardBuffer(path)
    }
    const active = activePath()
    if (active) setActivePath(remap(active))
    const preview = previewPath()
    if (preview) setPreviewPath(remap(preview))
    setRenderedPaths(prev => prev.map(remap))
  }

  createEffect(
    on(
      activePath,
      (_next, prev) => {
        if (!prev || !config.autoSaveOnBlur) return
        // A closing tab lands here too — by now it is gone from tabs() and its
        // edits were saved or knowingly discarded; it must not be resurrected.
        if (!tabs().includes(prev)) return
        if (!buffers[prev]?.dirty) return
        if (autoSave(prev) === 'skipped') say(`${CLASH_CHANGED}${basename(prev)}`, 'warn')
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [tabs(), activePath(), tree.expanded(), panes.sidebar()] as const,
      ([openTabs, active, folders, showTree]) => {
        // Single-file mode leaves no trace: `druk one.ts` would otherwise save a
        // one-tab, sidebar-hidden layout over whatever the folder had.
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
    activeBuffer,
    dirtyPaths,
    diff,
    diffTab,
    setDiff,
    page,
    setPage,
    views,
    activeView,
    showView,
    isDiffView,
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
    saveDirtyOnBlur,
    resolveConflict,
    syncFromDisk,
    clashWarning,
    remapPaths,
  }
}

export type Workspace = ReturnType<typeof createWorkspace>
