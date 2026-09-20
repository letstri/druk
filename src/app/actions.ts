import { basename, dirname, relative } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { ancestorDirs, changesFor, rowArea, rowRel } from '../core/changeTree'
import type { Change, CommitGroup } from '../core/changeTree'
import { conflictFrom, parseConflicts } from '../core/conflicts'
import type { ConflictSide } from '../core/conflicts'
import { readFile } from '../core/fs'
import type { TreeNode } from '../core/fs'
import {
  blobTexts,
  discardTarget,
  fetchRemote,
  fileHistory,
  lastCommitSubject,
  listRemotes,
  listTags,
  pull,
  pullAndPush,
  push,
  PUSH_REJECTED,
  stagedPaths,
  stagePaths,
  stashList,
  stashPop,
  stashPush,
  statusMap,
  unstagePaths,
} from '../core/git'
import type { ChangeArea, FileStatus } from '../core/git'
import { pathTokenAt, resolveImportPath } from '../core/imports'
import { NOTE_LABELS } from '../core/review'
import type { NoteKind } from '../core/review'
import type { ChangeSection, ChangesMeta } from '../ui/ChangesView'
import { firstChangedLine } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'
import { keyTip } from '../ui/keys'
import { rowSlotKey, slotKey, takeChangeSections } from './changeSections'
import { buildCommands, withKeymap } from './commands'
import type { Command } from './commands'
import type { AppContext } from './context'
import { noRepository, runCommit } from './git'
import type { CommitVariant } from './git'
import { problemFrom, problemsOn } from './lsp'

export function createCommands(ctx: AppContext) {
  const {
    rootDir,
    status,
    settings,
    tree,
    panes,
    editor,
    git,
    gitOp,
    comparison,
    workspace,
    fileOps,
  } = ctx
  const { say } = status
  const { config } = settings

  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = tree.selectedNode()
    if (node) run(node)
    else say('Select a file in the tree first', 'warn')
  }

  // The git and extensions panels borrow the tree's focus slot with no file under the cursor.
  const withCopyTarget = (run: (path: string) => void) => {
    const onTree = panes.focus() === 'tree' && panes.view() === 'files'
    const path = onTree
      ? (tree.selectedPath() ?? workspace.activePath())
      : (workspace.activePath() ?? tree.selectedPath())
    if (path) run(path)
    else say('No file to copy the path of', 'warn')
  }

  // A hit returns the *same object*: the page downstream skips its recomputation on identity.
  interface DiffFileSlot {
    revision: number
    reloadKey: number
    base: string | null
    buffer: string | undefined
    status: FileStatus
    area: ChangeArea
    file: DiffFile | null
  }
  const diffFileCache = new Map<string, DiffFileSlot>()
  const DIFF_FILE_CACHE_LIMIT = 4

  // Keyed `<repo>\0<spec>`; the whole map goes when git moves — a blob is whatever `revision` says.
  const blobs = new Map<string, string | null>()
  let blobRevision = -1
  /** ponytail: FIFO cap on whole file texts; a byte budget if a repo needs one. */
  const BLOB_CACHE_LIMIT = 256
  const blobKey = (repo: string, spec: string) => `${repo}\0${spec}`
  const freshBlobs = () => {
    const revision = git.revision()
    if (revision === blobRevision) return
    blobs.clear()
    blobRevision = revision
  }
  const rememberBlobs = (repo: string, texts: Map<string, string | null>) => {
    for (const [spec, text] of texts) blobs.set(blobKey(repo, spec), text)
    while (blobs.size > BLOB_CACHE_LIMIT) blobs.delete(blobs.keys().next().value!)
  }
  const blobText = (repo: string, spec: string): string | null => {
    freshBlobs()
    const key = blobKey(repo, spec)
    const hit = blobs.get(key)
    if (hit !== undefined) return hit
    rememberBlobs(repo, blobTexts(repo, [spec]))
    return blobs.get(key) ?? null
  }

  // The specs mirror `diffFileFor`'s below; drift costs a batched read, never an answer.
  const prefetchBlobs = (changes: Change[]) => {
    freshBlobs()
    const ref = git.diffBase() ?? 'HEAD'
    const wanted = new Map<string, Set<string>>()
    for (const change of changes) {
      if (change.status === 'untracked') continue
      const repo = git.repoFor(change.path)
      if (repo === null) continue
      const rel = relative(repo, change.path)
      const staged = git.statusEntries().get(change.path)?.staged != null
      const specs = wanted.get(repo) ?? new Set<string>()
      if (staged) specs.add(`:./${rel}`)
      if (change.area === 'staged' || !staged) specs.add(`${ref}:./${rel}`)
      wanted.set(repo, specs)
    }
    for (const [repo, specs] of wanted) {
      const missing = [...specs].filter(spec => !blobs.has(blobKey(repo, spec)))
      if (missing.length > 0) rememberBlobs(repo, blobTexts(repo, missing))
    }
  }

  // Null for a file that cannot be read; `area` is what the diff is between (staged: HEAD vs index).
  const diffFileFor = (
    path: string,
    fileStatus: FileStatus,
    area: ChangeArea = 'unstaged',
  ): DiffFile | null => {
    const revision = git.revision()
    const reloadKey = editor.reloadKey()
    const base = git.diffBase()
    const buffer = workspace.buffers[path]?.content
    const key = slotKey(path, area)
    const hit = diffFileCache.get(key)
    if (
      hit &&
      hit.revision === revision &&
      hit.reloadKey === reloadKey &&
      hit.base === base &&
      hit.buffer === buffer &&
      hit.status === fileStatus &&
      hit.area === area
    ) {
      return hit.file
    }

    // `rel` is from the opened folder, `repoRel` from the repository: with several repos they differ.
    const repo = git.repoFor(path)
    const rel = relative(rootDir, path)
    const repoRel = repo === null ? null : relative(repo, path)
    const staged =
      repo === null || repoRel === null || !git.statusEntries().get(path)?.staged
        ? null
        : blobText(repo, `:./${repoRel}`)
    const oldText =
      fileStatus === 'untracked' || repo === null || repoRel === null
        ? ''
        : area === 'staged'
          ? (blobText(repo, `${base ?? 'HEAD'}:./${repoRel}`) ?? '')
          : // As `git diff` measures it: the index when something is staged, else HEAD.
            (staged ?? blobText(repo, `${base ?? 'HEAD'}:./${repoRel}`) ?? '')
    let newText = ''
    if (fileStatus !== 'deleted') {
      if (area === 'staged') {
        newText = staged ?? ''
      } else if (buffer !== undefined) {
        newText = buffer
      } else {
        try {
          newText = readFile(path)
        } catch {
          return null
        }
      }
    }
    const file: DiffFile = { path, rel, status: fileStatus, oldText, newText }
    diffFileCache.delete(key)
    diffFileCache.set(key, { revision, reloadKey, base, buffer, status: fileStatus, area, file })
    // The all-changes page *is* that walk, and `rebuildAllChanges` prunes it instead.
    while (diffFileCache.size > DIFF_FILE_CACHE_LIMIT && !workspace.pageOpen('allChanges')) {
      diffFileCache.delete(diffFileCache.keys().next().value!)
    }
    return file
  }

  const [allChanges, setAllChanges] = createSignal<ChangeSection[]>([])
  const [allChangesMeta, setAllChangesMeta] = createSignal<ChangesMeta>({
    total: 0,
    adds: 0,
    dels: 0,
  })

  // The file under the panel cursor is kept past the cap, or arrows land on an omitted row.
  const rebuildAllChanges = () => {
    const changes = git.changes()
    const prev = new Map(allChanges().map(section => [section.key, section]))
    // Panel order, but every file: a folded folder's files are not in `rows`.
    const ordered = (['merge', 'staged', 'unstaged'] as const).flatMap(area =>
      changes.filter(entry => entry.area === area),
    )
    prefetchBlobs(ordered)
    const { sections, adds, dels, keep } = takeChangeSections(
      ordered,
      change => diffFileFor(change.path, change.status, change.area),
      prev,
      rowSlotKey(git.cursorRow()),
    )
    setAllChanges(sections)
    setAllChangesMeta({ total: changes.length, adds, dels })
    for (const cached of diffFileCache.keys()) {
      if (!keep.has(cached)) diffFileCache.delete(cached)
    }
  }

  // Every caller moves the panel's cursor first and calls this second, or the arrows have nowhere to go.
  const showChanges = () => {
    // Page first, so `diffFileFor` keeps the batch instead of pruning to four.
    ctx.workspace.openPage('allChanges')
    rebuildAllChanges()
  }

  // Rebuilds when the file was past the row cap, so the page and the cursor cannot disagree.
  const gitMoveTo = (row: number) => {
    const rows = git.rows()
    const at = Math.max(0, Math.min(row, rows.length - 1))
    const target = rows[at]
    if (!target) return
    git.setGitCursor(at)
    if (target.kind !== 'file') return
    if (workspace.page() !== 'allChanges') return showChanges()
    const key = slotKey(target.change.path, target.change.area)
    if (!allChanges().some(section => section.key === key)) rebuildAllChanges()
  }

  // Not `gitMoveTo`: that would throw a diff up for a fold.
  const gitCollapseAll = () => {
    const row = git.cursorRow()
    const rel = row ? rowRel(row) : null
    const area = row ? rowArea(row) : null
    git.collapseAll()
    const rows = git.rows()
    const top = rel ? (ancestorDirs(rel)[0] ?? rel) : null
    const at = rows.findIndex(r => rowArea(r) === area && rowRel(r) === top)
    git.setGitCursor(at >= 0 ? at : Math.min(git.gitCursor(), Math.max(0, rows.length - 1)))
  }

  const stageChanges = (area: ChangeArea | CommitGroup, targets: Change[]) => {
    if (comparison.active()) return say('Staging is unavailable while comparing branches', 'warn')
    if (!git.staging())
      return say('Staging compares against HEAD — reset the comparison base', 'warn')
    if (targets.length === 0) return say('Nothing to stage', 'warn')
    // One repository's paths per call: a folder of checkouts can put two under one heading.
    const repo = git.repoFor(targets[0]!.path)
    if (repo === null) return say(noRepository(git), 'warn')
    const paths = [...new Set(targets.filter(c => git.repoFor(c.path) === repo).map(c => c.path))]
    const what = paths.length === 1 ? relative(rootDir, paths[0]!) : `${paths.length} files`
    if (area === 'staged') {
      gitOp(
        'Unstaging',
        r =>
          unstagePaths(
            r,
            paths.map(p => relative(r, p)),
          ),
        {
          repo,
          done: () => `Unstaged ${what}`,
        },
      )
    } else {
      gitOp(
        'Staging',
        r =>
          stagePaths(
            r,
            paths.map(p => relative(r, p)),
          ),
        {
          repo,
          done: () => `Staged ${what}`,
        },
      )
    }
  }

  const gitToggleStage = (at?: number) => {
    const row = at != null ? git.rows()[at] : git.cursorRow()
    if (!row) return say('Nothing to stage', 'warn')
    stageChanges(rowArea(row), changesFor(git.changes(), row))
  }

  // A folded folder keeps its files out of `rows`, so the page names a section, not a row.
  const gitToggleStageKey = (key: string) => {
    const at = key.indexOf(':')
    const area = key.slice(0, at) as ChangeArea
    const path = key.slice(at + 1)
    stageChanges(
      area,
      git.changes().filter(change => change.path === path && change.area === area),
    )
  }

  const offerDiscard = () => {
    if (comparison.active()) return say('Discard is unavailable while comparing branches', 'warn')
    if (git.gitBusy()) return say('A git command is already running — let it finish', 'warn')
    if (panes.view() !== 'git') {
      return say('Open the Git panel and select a changed file', 'warn')
    }
    const row = git.cursorRow()
    if (row && row.kind !== 'file') return say('Select a changed file, not a folder', 'warn')
    const path = row?.kind === 'file' ? row.change.path : null
    const repo = path ? git.repoFor(path) : null
    if (!path || !repo) return say('Select a changed file in the Git panel', 'warn')
    const target = discardTarget(repo, path)
    if (!target) return say('That change is stale — refresh and select it again', 'warn')
    ctx.prompts.setPrompt({ kind: 'discardChange', target })
  }

  const pullPushOffer = (branch: string, hasUpstream: boolean) =>
    ctx.prompts.setPrompt({ kind: 'pullPush', branch, hasUpstream })

  const startCommit = (variant: CommitVariant) => {
    const repo = git.activeRepo()
    if (repo === null) return say(noRepository(git), 'warn')
    void git.loadMessageHistory()
    const staged = stagedPaths(repo)
    if (staged.size > 0) return ctx.prompts.setPrompt({ kind: 'commit', paths: null, variant })
    // `statusMap`, not the diff base: the index is built against HEAD whatever is being reviewed.
    const changes = [...statusMap(repo)]
      .map(([path, fileStatus]) => ({
        path,
        rel: relative(rootDir, path),
        status: fileStatus,
        checked: true,
      }))
      .toSorted((a, b) => a.rel.localeCompare(b.rel))
    if (changes.length === 0) return say('Nothing to commit — working tree clean')
    git.setCommitVariant(variant)
    git.setCommitPick(changes)
  }

  const openCommitRow = (oid: string) => {
    const repo = git.activeRepo()
    if (repo === null) return say(noRepository(git), 'warn')
    ctx.commitView.open(repo, oid)
  }

  const gitActivateRow = (row: number) => {
    gitMoveTo(row)
    const target = git.rows()[git.gitCursor()]
    if (!target) return
    if (target.kind === 'commit') return openCommitRow(target.oid)
    if (target.kind !== 'file') git.toggleCollapsed(rowArea(target), rowRel(target))
  }

  const gitOpenRow = (row: number) => {
    const rows = git.rows()
    const at = Math.max(0, Math.min(row, rows.length - 1))
    const target = rows[at]
    if (!target) return
    git.setGitCursor(at)
    if (target.kind === 'commit') return openCommitRow(target.oid)
    if (target.kind !== 'file') return git.toggleCollapsed(rowArea(target), rowRel(target))
    if (target.change.status === 'deleted') return say('File was deleted', 'warn')
    workspace.openFile(target.change.path)
    if (target.change.area === 'merge') {
      const content = workspace.buffers[target.change.path]?.content
      const first = parseConflicts(content ?? '')[0]
      if (first) {
        editor.requestGoto(first.start, 0)
        panes.setFocus('editor')
      }
    }
  }

  // A file that would not open leaves the goto unsent, or it would aim at the file on screen.
  const openAt = (path: string, line: number, col: number) => {
    // A jump inside the open file changes no tab, so nothing else records where it started.
    if (path === workspace.activeView()) ctx.navigation.mark()
    if (path !== workspace.activePath()) workspace.openFile(path)
    if (workspace.activePath() !== path) return
    editor.requestGoto(line, col)
    panes.setFocus('editor')
  }

  // The changes page names a section (`${area}:${path}`), not a row: a folded folder has no row.
  const openChangeKey = (key: string, line: number | null) => {
    const section = allChanges().find(entry => entry.key === key)
    if (!section) return
    if (section.status === 'deleted') return say('File was deleted', 'warn')
    const path = key.slice(key.indexOf(':') + 1)
    openAt(path, line ?? (section.file ? firstChangedLine(section.file) : 0), 0)
  }

  const cursorLine = (path: string): string => {
    const at = editor.cursor()
    return workspace.buffers[path]?.content.split('\n')[at.line] ?? ''
  }

  const noteTarget = (run: (target: { path: string; line: number; endLine: number }) => void) => {
    const path = workspace.activePath()
    if (!path) return say('Open a file to note a line in it', 'warn')
    const span = editor.selection()
    const line = span ? span.from : editor.cursor().line
    run({ path, line, endLine: span ? span.to : line })
  }

  const openNote = (path: string, line: number) => openAt(path, line, 0)

  const showNote = () => {
    const target = ctx.review.targetOf()
    if (!target) return
    if (target.path !== workspace.activePath()) {
      // `openFile` hands the keyboard to the editor, which would stop the arrows and drop the card.
      const had = panes.focus()
      workspace.openFile(target.path, true)
      panes.setFocus(had)
    }
    if (workspace.activePath() !== target.path) return
    editor.requestGoto(target.line, 0)
  }

  const jumpProblem = (direction: 1 | -1) => {
    const path = workspace.activePath()
    const list = path ? ctx.lsp.problems[path] : undefined
    const cursor = editor.cursor()
    const target = list ? problemFrom(list, cursor.line, cursor.col, direction) : null
    if (!target) return say('No problems in this file')
    editor.requestGoto(target.line, target.col)
    const tone =
      target.severity === 'error' ? 'error' : target.severity === 'warning' ? 'warn' : 'info'
    say(target.message.replaceAll(/\s+/g, ' '), tone)
  }

  const jumpConflict = (direction: 1 | -1) => {
    const conflicts = workspace.mergeConflicts()
    const target = conflictFrom(conflicts, editor.cursor().line, direction)
    if (!target) return say('No merge conflicts in this file')
    editor.requestGoto(target.start, 0)
    panes.setFocus('editor')
    const at = conflicts.indexOf(target) + 1
    say(
      `Conflict ${at} of ${conflicts.length} — ${target.ours || 'ours'} vs ${target.theirs || 'theirs'}`,
    )
  }

  const actions = {
    save: workspace.saveActive,
    saveAll: workspace.saveAll,
    saveWithoutFormatting: workspace.saveWithoutFormatting,
    formatDocument: workspace.formatActive,
    formatOpenFiles: workspace.formatOpen,
    openFile: () => ctx.overlays.setPicker('files'),
    switchTab: () => ctx.overlays.setPicker('tabs'),
    closeOthers: () => {
      const keep = workspace.activeView()
      if (keep)
        workspace.closeTabs(
          workspace.views().filter(id => id !== keep),
          'Closed other tabs',
        )
    },
    closeAll: () => workspace.closeTabs(workspace.views(), 'Closed all tabs'),
    gotoLine: () => ctx.prompts.setPrompt({ kind: 'gotoLine' }),
    undo: () => editor.requestHistory('undo'),
    redo: () => editor.requestHistory('redo'),
    gotoDefinition: () => {
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      if (!config.lsp) return say('LSP is off — go to definition needs a language server', 'warn')
      const at = editor.cursor()
      void ctx.lsp.definition(path, at.line, at.col).then(target => {
        if (!target) return say('No definition found')
        openAt(target.path, target.line, target.col)
      })
    },
    // Disk first, then the server, which is what places a bare package or an alias.
    openFileUnderCursor: () => {
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      const at = editor.cursor()
      const token = pathTokenAt(cursorLine(path), at.col)
      if (!token) return say('No path under the cursor', 'warn')
      const found = resolveImportPath(token, dirname(path), rootDir)
      if (found) return openAt(found, 0, 0)
      void ctx.lsp.definition(path, at.line, at.col).then(target => {
        if (!target) return say(`Cannot find "${token}"`, 'warn')
        openAt(target.path, target.line, target.col)
      })
    },
    findInFile: () => ctx.overlays.setSearch({ scope: 'file' }),
    findInProject: () => ctx.overlays.setSearch({ scope: 'project' }),
    replaceInFile: () => ctx.overlays.setSearch({ scope: 'file', replacing: true }),
    replaceInProject: () => ctx.overlays.setSearch({ scope: 'project', replacing: true }),
    newFile: () => ctx.prompts.setPrompt({ kind: 'newFile', dir: tree.targetDir() }),
    newFolder: () => ctx.prompts.setPrompt({ kind: 'newFolder', dir: tree.targetDir() }),
    rename: withNode(n => ctx.prompts.setPrompt({ kind: 'rename', target: n.path })),
    remove: () => {
      const targets = tree.actionTargets()
      if (targets.length === 0) return say('Nothing selected', 'warn')
      ctx.prompts.setPrompt({ kind: 'delete', targets })
    },
    cutForMove: () => fileOps.takeForPaste('cut'),
    copyForPaste: () => fileOps.takeForPaste('copy'),
    copyPath: () => withCopyTarget(path => fileOps.copyPath(path, 'absolute')),
    copyRelativePath: () => withCopyTarget(path => fileOps.copyPath(path, 'relative')),
    paste: fileOps.paste,
    closeTab: () => void (workspace.activePath() && workspace.closeTab(workspace.activePath()!)),
    reopenTab: workspace.reopenTab,
    nextTab: () => workspace.switchTab(1),
    prevTab: () => workspace.switchTab(-1),
    navBack: ctx.navigation.back,
    navForward: ctx.navigation.forward,
    toggleFocus: () => (panes.focus() === 'tree' ? panes.setFocus('editor') : panes.focusTree()),
    toggleSidebar: panes.toggleSidebar,
    collapseSidebar: () => {
      if (panes.view() === 'git') return gitCollapseAll()
      if (panes.view() === 'review') return ctx.review.collapseAll()
      tree.collapseAll()
    },
    gitCollapseAll,
    toggleGitView: () => panes.toggleView('git'),
    togglePreview: () => {
      if (ctx.preview.on()) {
        ctx.preview.close()
        return say('Preview off')
      }
      panes.showView('files')
      ctx.preview.open()
      say('Preview on — ↑↓ walks the tree, Enter opens, Space closes')
    },
    toggleMarkdown: workspace.toggleRendered,
    setTheme: settings.applyTheme,
    previewTheme: settings.previewTheme,
    restoreTheme: settings.restoreTheme,
    setIconTheme: settings.applyIconTheme,
    previewIcons: settings.previewIcons,
    restoreIcons: settings.restoreIcons,
    toggleWrap: settings.toggleWrap,
    toggleDiffLayout: settings.toggleDiffView,
    toggleSidebarPosition: settings.toggleSidebarPosition,
    lineOp: editor.requestLineOp,
    lineHome: editor.requestLineHome,
    foldOp: editor.requestFoldOp,
    triggerCompletion: editor.requestCompletion,
    switchWorkspace: ctx.workspaces.pick,
    openWorkspace: ctx.workspaces.openPrompt,
    newWorktree: ctx.workspaces.newWorktree,
    switchWorktree: () => ctx.workspaces.pickWorktree('switch'),
    removeWorktree: () => ctx.workspaces.pickWorktree('remove'),
    openSettings: () => {
      settings.setScope('user')
      ctx.workspace.openPage('settings')
      panes.setFocus('editor')
    },
    openProjectSettings: () => {
      settings.setScope('project')
      ctx.workspace.openPage('settings')
      panes.setFocus('editor')
    },
    lspStatus: () => {
      ctx.workspace.openPage('lspStatus')
      panes.setFocus('editor')
    },
    problemsList: () => {
      const any = workspace.tabs().some(path => (ctx.lsp.problems[path] ?? []).length > 0)
      if (!any) return say('No problems')
      ctx.overlays.setProblemsOpen('all')
    },
    problemsAtCursor: () => {
      const path = workspace.activePath()
      const list = path ? ctx.lsp.problems[path] : undefined
      if (!list || problemsOn(list, editor.cursor().line).length === 0)
        return say('No problem on this line')
      ctx.overlays.setProblemsOpen('cursor')
    },
    problemsNext: () => jumpProblem(1),
    problemsPrev: () => jumpProblem(-1),
    uninstallServer: (id: string) => {
      const target = ctx.lsp.removable(id)
      if (!target) return say(`${id}: druk did not install it — nothing to remove`, 'warn')
      ctx.prompts.setPrompt({
        kind: 'uninstallServer',
        id,
        name: target.name,
        packages: target.packages,
      })
    },
    restartLsp: () => {
      if (!settings.config.lsp) return say('LSP is off', 'warn')
      ctx.lsp.restart()
      say('Restarted language servers')
    },
    gitCompareBranches: () => {
      panes.showView('git')
      comparison.open()
    },
    gitMoveTo,
    gitActivateRow,
    gitOpenRow,
    gitDiscard: () => offerDiscard(),
    gitToggleStage,
    gitToggleStageKey,
    openChangeKey,
    gitLandOnFile: () => {
      const row = git.cursorRow()
      if (row?.kind === 'file') return
      const at = git.rows().findIndex(entry => entry.kind === 'file')
      // The cursor alone, not `gitMoveTo`: showing the sidebar must not throw a diff up.
      if (at >= 0) git.setGitCursor(at)
    },
    conflictNext: () => jumpConflict(1),
    conflictPrev: () => jumpConflict(-1),
    conflictResolve: () => {
      const at = workspace
        .mergeConflicts()
        .find(one => editor.cursor().line >= one.start && editor.cursor().line <= one.end)
      if (!at) return say('No merge conflict on this line', 'warn')
      ctx.prompts.setPrompt({
        kind: 'mergeConflict',
        line: editor.cursor().line,
        ours: at.ours,
        theirs: at.theirs,
      })
    },
    conflictAccept: (side: ConflictSide) => workspace.acceptConflict(editor.cursor().line, side),
    gitDiffFile: () => {
      if (!git.inRepo()) return say('Not a git repository', 'warn')
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      // Unstaged first: a file with both has one row under each heading.
      const change =
        git.changes().find(entry => entry.path === path && entry.area === 'unstaged') ??
        git.changes().find(entry => entry.path === path)
      if (!change) return say(`No changes in ${relative(rootDir, path)}`)
      panes.showView('git')
      // The file's own row has to exist before the cursor can be put on it.
      git.revealChange(change.area, change.rel)
      git.setGitCursor(
        git
          .rows()
          .findIndex(
            row =>
              row.kind === 'file' && row.change.path === path && row.change.area === change.area,
          ),
      )
      showChanges()
    },
    gitDiffAll: () => {
      if (!git.inRepo()) return say('Not a git repository', 'warn')
      panes.showView('git')
      showChanges()
    },
    allChanges,
    allChangesMeta,
    refreshChanges: () => {
      if (!workspace.pageOpen('allChanges')) return
      // Only close a page that had changes: an empty one opened from the palette explains itself.
      const had = allChangesMeta().total > 0
      rebuildAllChanges()
      if (had && git.changes().length === 0) workspace.closePage('allChanges')
    },
    gitDiffBase: () => ctx.branches.open('diffBase'),
    gitDiffBaseReset: () => {
      if (!git.inRepo()) return say('Not a git repository', 'warn')
      if (git.diffBase() === null) return say('Already comparing against HEAD')
      git.setDiffBase(null)
      say('Comparing against HEAD')
    },
    gitCommit: () => startCommit('commit'),
    gitCommitAndPush: () => startCommit('commitPush'),
    gitCommitAndSync: () => startCommit('commitSync'),
    gitCommitAmend: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const subject = lastCommitSubject(repo)
      if (!subject) return say('No commit to amend', 'warn')
      void git.loadMessageHistory()
      ctx.prompts.setPrompt({ kind: 'commitAmend', subject, repo })
    },
    gitFocusMessage: () => {
      if (!git.inRepo()) return say('Not a git repository', 'warn')
      if (!git.staging()) return say('Comparing against a branch — nothing to commit here', 'warn')
      panes.showView('git')
      git.setMessageEditing(true)
      void git.loadMessageHistory()
    },
    gitCommitBox: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const message = git.commitMessage().trim()
      if (!message) return say('Enter a commit message', 'warn')
      git.setMessageEditing(false)
      const staged = stagedPaths(repo)
      if (staged.size > 0) {
        return runCommit(gitOp, git, {
          repo,
          message,
          paths: null,
          variant: 'commit',
          onPushRejected: pullPushOffer,
        })
      }
      const count = statusMap(repo).size
      if (count === 0) return say('Nothing to commit — working tree clean')
      ctx.prompts.setPrompt({ kind: 'commitAll', message, variant: 'commit', repo, count })
    },
    gitSync: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const name = git.branch()
      if (!name) return say('No branch to sync', 'warn')
      const hasUpstream = git.upstream()?.name != null
      gitOp('Syncing', r => (hasUpstream ? pullAndPush(r, name, true) : push(r, name, false)), {
        repo,
        touchesTree: { kind: 'sync' },
        done: () =>
          hasUpstream ? `Synced ${name}` : `Published ${name} — upstream set to origin/${name}`,
      })
    },
    gitUndoCommit: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const subject = lastCommitSubject(repo)
      if (!subject) return say('No commit to undo', 'warn')
      ctx.prompts.setPrompt({ kind: 'undoCommit', subject })
    },
    gitPush: () => {
      if (git.activeRepo() === null) return say(noRepository(git), 'warn')
      const name = git.branch()
      if (!name) return say('No branch to push', 'warn')
      const hasUpstream = git.upstream()?.name != null
      gitOp('Pushing', repo => push(repo, name, hasUpstream), {
        done: () =>
          hasUpstream ? `Pushed ${name}` : `Pushed ${name} — upstream set to origin/${name}`,
        handleFailure: result => {
          if (result.detail !== PUSH_REJECTED) return false
          ctx.prompts.setPrompt({ kind: 'pullPush', branch: name, hasUpstream })
          return true
        },
      })
    },
    gitFetch: () => gitOp('Fetching', repo => fetchRemote(repo), { done: () => 'Fetched' }),
    gitPull: () => gitOp('Pulling', repo => pull(repo), { touchesTree: { kind: 'sync' } }),
    gitStash: () => gitOp('Stashing', repo => stashPush(repo), { touchesTree: { kind: 'sync' } }),
    gitStashPop: () =>
      gitOp('Popping stash', repo => stashPop(repo), { touchesTree: { kind: 'sync' } }),
    gitStashList: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const stashes = stashList(repo)
      if (stashes.length === 0) return say('No stashes')
      ctx.prompts.setPrompt({ kind: 'stashPick', repo, stashes })
    },
    gitNewTag: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      ctx.prompts.setPrompt({ kind: 'newTag', repo })
    },
    gitDeleteTag: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const tags = listTags(repo)
      if (tags.length === 0) return say('No tags')
      ctx.prompts.setPrompt({ kind: 'tagDelete', repo, tags })
    },
    gitAddRemote: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      ctx.prompts.setPrompt({ kind: 'remoteAddName', repo })
    },
    gitRemoveRemote: () => {
      const repo = git.activeRepo()
      if (repo === null) return say(noRepository(git), 'warn')
      const remotes = listRemotes(repo)
      if (remotes.length === 0) return say('No remotes')
      ctx.prompts.setPrompt({ kind: 'remoteRemove', repo, remotes })
    },
    gitFileHistory: () => {
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      const repo = git.repoFor(path)
      if (repo === null) return say('Not a git repository', 'warn')
      const commits = fileHistory(repo, relative(repo, path))
      if (commits.length === 0) return say('No commits touch this file')
      ctx.prompts.setPrompt({ kind: 'fileHistory', repo, commits })
    },
    gitSwitchBranch: () => ctx.branches.open('switch'),
    gitNewBranch: ctx.branches.newBranch,
    gitNewBranchFrom: () => ctx.branches.open('from'),
    gitMergeBranch: () => ctx.branches.open('merge'),
    gitRenameBranch: () => ctx.branches.open('rename'),
    gitDeleteBranch: () => ctx.branches.open('delete'),
    gitDeleteBranchForce: () => ctx.branches.open('deleteForce'),
    openReview: () => panes.toggleView('review'),
    reviewNote: () =>
      noteTarget(target => ctx.prompts.setPrompt({ kind: 'reviewKind', ...target })),
    reviewNoteOf: (kind: NoteKind) =>
      noteTarget(target =>
        ctx.prompts.setPrompt({ kind: 'reviewNote', ...target, noteKind: kind }),
      ),
    reviewReply: () => {
      const parent = ctx.review.replyTarget()
      if (!parent) return
      const span = `${basename(parent.path)}:${parent.line + 1}`
      ctx.prompts.setPrompt({
        kind: 'reviewReply',
        parent: parent.id,
        heading: `${NOTE_LABELS[parent.kind]} · ${span}`,
      })
    },
    reviewClear: ctx.review.clear,
    reviewMoveTo: (row: number) => ctx.review.moveTo(row),
    reviewMove: (delta: number) => {
      ctx.review.move(delta)
      showNote()
    },
    reviewShow: showNote,
    reviewActivate: (row: number) => ctx.review.activate(row, openNote),
    reviewCollapseAll: ctx.review.collapseAll,
    openExtensions: () => panes.toggleView('extensions'),
    reloadExtensions: ctx.extensions.reload,
    updateExtensions: ctx.extensions.updateAll,
    checkExtensionUpdates: ctx.extensions.checkNow,
    showHelp: () => ctx.overlays.setHelp(true),
    quit: ctx.prompts.quit,
  }

  const promote = (id: string) => {
    const tip = keyTip(id)
    if (tip) say(`Tip: ${tip}`)
  }

  const commands = createMemo<Command[]>(() =>
    withKeymap(
      buildCommands(actions, { activeTheme: config.theme, activeIconTheme: config.iconTheme }),
      promote,
    ),
  )

  return { commands, actions }
}
