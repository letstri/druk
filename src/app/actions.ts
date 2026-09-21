import { basename, dirname, join, relative } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { openInBrowser } from '../core/browser'
import { ancestorDirs, changesFor, rowArea, rowRel } from '../core/changeTree'
import type { Change, CommitGroup } from '../core/changeTree'
import { conflictFrom, parseConflicts } from '../core/conflicts'
import type { ConflictSide } from '../core/conflicts'
import { readFile } from '../core/fs'
import type { TreeNode } from '../core/fs'
import {
  blobTexts,
  commitUrl,
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
import type { LocationHit, LocationMethod, Target } from '../lsp/locations'
import { symbolHits } from '../lsp/symbols'
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
    if (node) {
      run(node)
    } else {
      say('Select a file in the tree first', 'warn')
    }
  }

  // The git and extensions panels borrow the tree's focus slot with no file under the cursor.
  const withCopyTarget = (run: (path: string) => void) => {
    const onTree = panes.focus() === 'tree' && panes.view() === 'files'
    const path = onTree
      ? (tree.selectedPath() ?? workspace.activePath())
      : (workspace.activePath() ?? tree.selectedPath())
    if (path) {
      run(path)
    } else {
      say('No file to copy the path of', 'warn')
    }
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
    if (revision === blobRevision) {
      return
    }
    blobs.clear()
    blobRevision = revision
  }
  const rememberBlobs = (repo: string, texts: Map<string, string | null>) => {
    for (const [spec, text] of texts) {
      blobs.set(blobKey(repo, spec), text)
    }
    while (blobs.size > BLOB_CACHE_LIMIT) {
      blobs.delete(blobs.keys().next().value!)
    }
  }
  const blobText = (repo: string, spec: string): string | null => {
    freshBlobs()
    const key = blobKey(repo, spec)
    const hit = blobs.get(key)
    if (hit !== undefined) {
      return hit
    }
    rememberBlobs(repo, blobTexts(repo, [spec]))
    return blobs.get(key) ?? null
  }

  // The specs mirror `diffFileFor`'s below; drift costs a batched read, never an answer.
  const prefetchBlobs = (changes: Change[]) => {
    freshBlobs()
    const ref = git.diffBase() ?? 'HEAD'
    const wanted = new Map<string, Set<string>>()
    for (const change of changes) {
      if (change.status === 'untracked') {
        continue
      }
      const repo = git.repoFor(change.path)
      if (repo === null) {
        continue
      }
      const rel = relative(repo, change.path)
      const entry = git.statusEntries().get(change.path)
      const staged = entry?.staged !== null && entry?.staged !== undefined
      // A rename's committed side is under its old name; `HEAD:./<new>` is simply missing.
      const committedRel = entry?.source ?? rel
      const specs = wanted.get(repo) ?? new Set<string>()
      if (staged) {
        specs.add(`:./${rel}`)
      }
      if (change.area === 'staged' || !staged) {
        specs.add(`${ref}:./${committedRel}`)
      }
      wanted.set(repo, specs)
    }
    for (const [repo, specs] of wanted) {
      const missing = [...specs].filter(
        (spec) => !blobs.has(blobKey(repo, spec))
      )
      if (missing.length > 0) {
        rememberBlobs(repo, blobTexts(repo, missing))
      }
    }
  }

  // Null for a file that cannot be read; `area` is what the diff is between (staged: HEAD vs index).
  const diffFileFor = (
    path: string,
    fileStatus: FileStatus,
    area: ChangeArea = 'unstaged'
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
    const entry = git.statusEntries().get(path)
    const staged =
      repo === null || repoRel === null || !entry?.staged
        ? null
        : blobText(repo, `:./${repoRel}`)
    // As `git diff` measures it: the index when something is staged, else HEAD — and for a
    // rename, HEAD holds the file under its old name, so `HEAD:./<new>` reads as a new file.
    const committedRel = entry?.source ?? repoRel
    const committed = () =>
      blobText(repo!, `${base ?? 'HEAD'}:./${committedRel!}`) ?? ''
    const oldText =
      fileStatus === 'untracked' || repo === null || repoRel === null
        ? ''
        : area === 'staged'
          ? committed()
          : (staged ?? committed())
    let newText = ''
    if (fileStatus !== 'deleted') {
      if (area === 'staged') {
        newText = staged ?? ''
      } else if (buffer === undefined) {
        try {
          newText = readFile(path)
        } catch {
          return null
        }
      } else {
        newText = buffer
      }
    }
    const file: DiffFile = {
      newText,
      // The header says `old → new` from this: `source` is repository-relative, `rel` is not.
      oldPath:
        entry?.source && repo !== null
          ? relative(rootDir, join(repo, entry.source))
          : null,
      oldText,
      path,
      rel,
      status: fileStatus,
    }
    diffFileCache.delete(key)
    diffFileCache.set(key, {
      area,
      base,
      buffer,
      file,
      reloadKey,
      revision,
      status: fileStatus,
    })
    // The all-changes page *is* that walk, and `rebuildAllChanges` prunes it instead.
    while (
      diffFileCache.size > DIFF_FILE_CACHE_LIMIT &&
      !workspace.pageOpen('allChanges')
    ) {
      diffFileCache.delete(diffFileCache.keys().next().value!)
    }
    return file
  }

  const [allChanges, setAllChanges] = createSignal<ChangeSection[]>([])
  const [allChangesMeta, setAllChangesMeta] = createSignal<ChangesMeta>({
    adds: 0,
    dels: 0,
    total: 0,
  })

  // The file under the panel cursor is kept past the cap, or arrows land on an omitted row.
  const rebuildAllChanges = () => {
    const changes = git.changes()
    const prev = new Map(allChanges().map((section) => [section.key, section]))
    // Panel order, but every file: a folded folder's files are not in `rows`.
    const ordered = (['merge', 'staged', 'unstaged'] as const).flatMap((area) =>
      changes.filter((entry) => entry.area === area)
    )
    prefetchBlobs(ordered)
    const { sections, adds, dels, keep } = takeChangeSections(
      ordered,
      (change) => diffFileFor(change.path, change.status, change.area),
      prev,
      rowSlotKey(git.cursorRow())
    )
    setAllChanges(sections)
    setAllChangesMeta({ adds, dels, total: changes.length })
    for (const cached of diffFileCache.keys()) {
      if (!keep.has(cached)) {
        diffFileCache.delete(cached)
      }
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
    if (!target) {
      return
    }
    git.setGitCursor(at)
    if (target.kind !== 'file') {
      return
    }
    if (workspace.page() !== 'allChanges') {
      return showChanges()
    }
    const key = slotKey(target.change.path, target.change.area)
    if (!allChanges().some((section) => section.key === key)) {
      rebuildAllChanges()
    }
  }

  // Not `gitMoveTo`: that would throw a diff up for a fold.
  const gitCollapseAll = () => {
    const row = git.cursorRow()
    const rel = row ? rowRel(row) : null
    const area = row ? rowArea(row) : null
    git.collapseAll()
    const rows = git.rows()
    const top = rel ? (ancestorDirs(rel)[0] ?? rel) : null
    const at = rows.findIndex((r) => rowArea(r) === area && rowRel(r) === top)
    git.setGitCursor(
      at === -1 ? Math.min(git.gitCursor(), Math.max(0, rows.length - 1)) : at
    )
  }

  const stageChanges = (area: ChangeArea | CommitGroup, targets: Change[]) => {
    if (comparison.active()) {
      return say('Staging is unavailable while comparing branches', 'warn')
    }
    if (!git.staging()) {
      return say(
        'Staging compares against HEAD — reset the comparison base',
        'warn'
      )
    }
    if (targets.length === 0) {
      return say('Nothing to stage', 'warn')
    }
    // One repository's paths per call: a folder of checkouts can put two under one heading.
    const repo = git.repoFor(targets[0]!.path)
    if (repo === null) {
      return say(noRepository(git), 'warn')
    }
    const paths = [
      ...new Set(
        targets.filter((c) => git.repoFor(c.path) === repo).map((c) => c.path)
      ),
    ]
    const what =
      paths.length === 1
        ? relative(rootDir, paths[0]!)
        : `${paths.length} files`
    if (area === 'staged') {
      gitOp(
        'Unstaging',
        (r) =>
          unstagePaths(
            r,
            paths.map((p) => relative(r, p))
          ),
        {
          done: () => `Unstaged ${what}`,
          repo,
        }
      )
    } else {
      gitOp(
        'Staging',
        (r) =>
          stagePaths(
            r,
            paths.map((p) => relative(r, p))
          ),
        {
          done: () => `Staged ${what}`,
          repo,
        }
      )
    }
  }

  const gitToggleStage = (at?: number) => {
    const row =
      at === null || at === undefined ? git.cursorRow() : git.rows()[at]
    if (!row) {
      return say('Nothing to stage', 'warn')
    }
    stageChanges(rowArea(row), changesFor(git.changes(), row))
  }

  // A folded folder keeps its files out of `rows`, so the page names a section, not a row.
  const gitToggleStageKey = (key: string) => {
    const at = key.indexOf(':')
    const area = key.slice(0, at) as ChangeArea
    const path = key.slice(at + 1)
    stageChanges(
      area,
      git
        .changes()
        .filter((change) => change.path === path && change.area === area)
    )
  }

  const offerDiscard = () => {
    if (comparison.active()) {
      return say('Discard is unavailable while comparing branches', 'warn')
    }
    if (git.gitBusy()) {
      return say('A git command is already running — let it finish', 'warn')
    }
    if (panes.view() !== 'git') {
      return say('Open the Git panel and select a changed file', 'warn')
    }
    const row = git.cursorRow()
    if (row && row.kind !== 'file') {
      return say('Select a changed file, not a folder', 'warn')
    }
    const path = row?.kind === 'file' ? row.change.path : null
    const repo = path ? git.repoFor(path) : null
    if (!path || !repo) {
      return say('Select a changed file in the Git panel', 'warn')
    }
    const target = discardTarget(repo, path)
    if (!target) {
      return say('That change is stale — refresh and select it again', 'warn')
    }
    ctx.prompts.setPrompt({ kind: 'discardChange', target })
  }

  const pullPushOffer = (branch: string, hasUpstream: boolean) =>
    ctx.prompts.setPrompt({ branch, hasUpstream, kind: 'pullPush' })

  const startCommit = (variant: CommitVariant) => {
    const repo = git.activeRepo()
    if (repo === null) {
      return say(noRepository(git), 'warn')
    }
    void git.loadMessageHistory()
    const staged = stagedPaths(repo)
    if (staged.size > 0) {
      return ctx.prompts.setPrompt({ kind: 'commit', paths: null, variant })
    }
    // `statusMap`, not the diff base: the index is built against HEAD whatever is being reviewed.
    const changes = [...statusMap(repo)]
      .map(([path, fileStatus]) => ({
        checked: true,
        path,
        rel: relative(rootDir, path),
        status: fileStatus,
      }))
      .toSorted((a, b) => a.rel.localeCompare(b.rel))
    if (changes.length === 0) {
      return say('Nothing to commit — working tree clean')
    }
    git.setCommitVariant(variant)
    git.setCommitPick(changes)
  }

  const openCommitRow = (oid: string) => {
    const repo = git.activeRepo()
    if (repo === null) {
      return say(noRepository(git), 'warn')
    }
    ctx.commitView.open(repo, oid)
  }

  const gitActivateRow = (row: number) => {
    gitMoveTo(row)
    const target = git.rows()[git.gitCursor()]
    if (!target) {
      return
    }
    if (target.kind === 'commit') {
      return openCommitRow(target.oid)
    }
    if (target.kind !== 'file') {
      git.toggleCollapsed(rowArea(target), rowRel(target))
    }
  }

  const gitOpenRow = (row: number) => {
    const rows = git.rows()
    const at = Math.max(0, Math.min(row, rows.length - 1))
    const target = rows[at]
    if (!target) {
      return
    }
    git.setGitCursor(at)
    if (target.kind === 'commit') {
      return openCommitRow(target.oid)
    }
    if (target.kind !== 'file') {
      return git.toggleCollapsed(rowArea(target), rowRel(target))
    }
    if (target.change.status === 'deleted') {
      return say('File was deleted', 'warn')
    }
    workspace.openFile(target.change.path)
    if (target.change.area === 'merge') {
      const content = workspace.buffers[target.change.path]?.content
      const [first] = parseConflicts(content ?? '')
      if (first) {
        editor.requestGoto(first.start, 0)
        panes.setFocus('editor')
      }
    }
  }

  const openAt = ctx.navigation.open

  // `what` is the command's own label, so the two messages read the same for all of them.
  const withServed = (what: string, run: (path: string) => void) => {
    const path = workspace.activePath()
    if (!path) {
      return say('No file open', 'warn')
    }
    if (!config.lsp) {
      return say(`LSP is off — "${what}" needs a language server`, 'warn')
    }
    run(path)
  }

  const read = (path: string) => {
    try {
      return readFile(path)
    } catch {
      return ''
    }
  }

  // The line's own text is what a reference list is read by; its place is the note.
  const locationHits = (targets: Target[]): LocationHit[] => {
    const texts = new Map<string, string[]>()
    return targets.map((target) => {
      let lines = texts.get(target.path)
      if (!lines) {
        // A location the server indexed may name a file that has since gone.
        lines = (
          workspace.buffers[target.path]?.content ?? read(target.path)
        ).split('\n')
        texts.set(target.path, lines)
      }
      const where = `${relative(rootDir, target.path)}:${target.line + 1}`
      return {
        ...target,
        label: lines[target.line]?.trim() || where,
        note: where,
      }
    })
  }

  const lspNav = (method: LocationMethod, what: string, found: string) => () =>
    withServed(what, (path) => {
      const at = editor.cursor()
      void (async () => {
        const targets = await ctx.lsp.locations(path, at.line, at.col, method)
        if (targets.length === 0) {
          return say(`No ${found.toLowerCase()} found`)
        }
        const first = targets[0]!
        if (targets.length === 1) {
          return openAt(first.path, first.line, first.col)
        }
        // The request may outlive the keyboard: whatever the user opened meanwhile wins.
        if (ctx.prompts.prompt()) {
          return
        }
        ctx.prompts.setPrompt({
          hits: locationHits(targets),
          kind: 'lspLocations',
          title: found,
        })
      })()
    })

  // The changes page names a section (`${area}:${path}`), not a row: a folded folder has no row.
  const openChangeKey = (key: string, line: number | null) => {
    const section = allChanges().find((entry) => entry.key === key)
    if (!section) {
      return
    }
    if (section.status === 'deleted') {
      return say('File was deleted', 'warn')
    }
    const path = key.slice(key.indexOf(':') + 1)
    openAt(path, line ?? (section.file ? firstChangedLine(section.file) : 0), 0)
  }

  const cursorLine = (path: string): string => {
    const at = editor.cursor()
    return workspace.buffers[path]?.content.split('\n')[at.line] ?? ''
  }

  const noteTarget = (
    run: (target: { path: string; line: number; endLine: number }) => void
  ) => {
    const path = workspace.activePath()
    if (!path) {
      return say('Open a file to note a line in it', 'warn')
    }
    const span = editor.selection()
    const line = span ? span.from : editor.cursor().line
    run({ endLine: span ? span.to : line, line, path })
  }

  const openNote = (path: string, line: number) => openAt(path, line, 0)

  const showNote = () => {
    const target = ctx.review.targetOf()
    if (!target) {
      return
    }
    if (target.path !== workspace.activePath()) {
      // `openFile` hands the keyboard to the editor, which would stop the arrows and drop the card.
      const had = panes.focus()
      workspace.openFile(target.path, true)
      panes.setFocus(had)
    }
    if (workspace.activePath() !== target.path) {
      return
    }
    editor.requestGoto(target.line, 0)
  }

  const jumpProblem = (direction: 1 | -1) => {
    const path = workspace.activePath()
    const list = path ? ctx.lsp.problems[path] : undefined
    const cursor = editor.cursor()
    const target = list
      ? problemFrom(list, cursor.line, cursor.col, direction)
      : null
    if (!target) {
      return say('No problems in this file')
    }
    editor.requestGoto(target.line, target.col)
    const tone =
      target.severity === 'error'
        ? 'error'
        : target.severity === 'warning'
          ? 'warn'
          : 'info'
    say(target.message.replaceAll(/\s+/gu, ' '), tone)
  }

  const jumpConflict = (direction: 1 | -1) => {
    const conflicts = workspace.mergeConflicts()
    const target = conflictFrom(conflicts, editor.cursor().line, direction)
    if (!target) {
      return say('No merge conflicts in this file')
    }
    editor.requestGoto(target.start, 0)
    panes.setFocus('editor')
    const at = conflicts.indexOf(target) + 1
    say(
      `Conflict ${at} of ${conflicts.length} — ${target.ours || 'ours'} vs ${target.theirs || 'theirs'}`
    )
  }

  const actions = {
    allChanges,
    allChangesMeta,
    checkExtensionUpdates: ctx.extensions.checkNow,
    closeAll: () => workspace.closeTabs(workspace.views(), 'Closed all tabs'),
    closeOthers: () => {
      const keep = workspace.activeView()
      if (keep) {
        workspace.closeTabs(
          workspace.views().filter((id) => id !== keep),
          'Closed other tabs'
        )
      }
    },
    closeTab: () => {
      const path = workspace.activePath()
      if (path) {
        workspace.closeTab(path)
      }
    },
    collapseSidebar: () => {
      if (panes.view() === 'git') {
        return gitCollapseAll()
      }
      if (panes.view() === 'review') {
        return ctx.review.collapseAll()
      }
      tree.collapseAll()
    },
    conflictAccept: (side: ConflictSide) =>
      workspace.acceptConflict(editor.cursor().line, side),
    conflictNext: () => jumpConflict(1),
    conflictPrev: () => jumpConflict(-1),
    conflictResolve: () => {
      const at = workspace
        .mergeConflicts()
        .find(
          (one) =>
            editor.cursor().line >= one.start && editor.cursor().line <= one.end
        )
      if (!at) {
        return say('No merge conflict on this line', 'warn')
      }
      ctx.prompts.setPrompt({
        kind: 'mergeConflict',
        line: editor.cursor().line,
        ours: at.ours,
        theirs: at.theirs,
      })
    },
    copyForPaste: () => fileOps.takeForPaste('copy'),
    copyPath: () =>
      withCopyTarget((path) => fileOps.copyPath(path, 'absolute')),
    copyRelativePath: () =>
      withCopyTarget((path) => fileOps.copyPath(path, 'relative')),
    cutForMove: () => fileOps.takeForPaste('cut'),
    findInFile: () => ctx.overlays.setSearch({ scope: 'file' }),
    findInProject: () => ctx.overlays.setSearch({ scope: 'project' }),
    foldOp: editor.requestFoldOp,
    formatDocument: workspace.formatActive,
    formatOpenFiles: workspace.formatOpen,
    gitActivateRow,
    gitAddRemote: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      ctx.prompts.setPrompt({ kind: 'remoteAddName', repo })
    },
    gitCollapseAll,
    gitCommit: () => startCommit('commit'),
    gitCommitAmend: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const subject = lastCommitSubject(repo)
      if (!subject) {
        return say('No commit to amend', 'warn')
      }
      void git.loadMessageHistory()
      ctx.prompts.setPrompt({ kind: 'commitAmend', repo, subject })
    },
    gitCommitAndPush: () => startCommit('commitPush'),
    gitCommitAndSync: () => startCommit('commitSync'),
    gitCommitBox: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const message = git.commitMessage().trim()
      if (!message) {
        return say('Enter a commit message', 'warn')
      }
      git.setMessageEditing(false)
      const staged = stagedPaths(repo)
      if (staged.size > 0) {
        return runCommit(gitOp, git, {
          message,
          onPushRejected: pullPushOffer,
          paths: null,
          repo,
          variant: 'commit',
        })
      }
      const count = statusMap(repo).size
      if (count === 0) {
        return say('Nothing to commit — working tree clean')
      }
      ctx.prompts.setPrompt({
        count,
        kind: 'commitAll',
        message,
        repo,
        variant: 'commit',
      })
    },
    gitCommitGraph: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      ctx.commitGraph.open(repo)
      panes.setFocus('editor')
    },
    gitCompareBranches: () => {
      panes.showView('git')
      comparison.open()
    },
    gitDeleteBranch: () => ctx.branches.open('delete'),
    gitDeleteBranchForce: () => ctx.branches.open('deleteForce'),
    gitDeleteTag: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const tags = listTags(repo)
      if (tags.length === 0) {
        return say('No tags')
      }
      ctx.prompts.setPrompt({ kind: 'tagDelete', repo, tags })
    },
    gitDiffAll: () => {
      if (!git.inRepo()) {
        return say('Not a git repository', 'warn')
      }
      panes.showView('git')
      showChanges()
    },
    gitDiffBase: () => ctx.branches.open('diffBase'),
    gitDiffBaseReset: () => {
      if (!git.inRepo()) {
        return say('Not a git repository', 'warn')
      }
      if (git.diffBase() === null) {
        return say('Already comparing against HEAD')
      }
      git.setDiffBase(null)
      say('Comparing against HEAD')
    },
    gitDiffFile: () => {
      if (!git.inRepo()) {
        return say('Not a git repository', 'warn')
      }
      const path = workspace.activePath()
      if (!path) {
        return say('No file open', 'warn')
      }
      // Unstaged first: a file with both has one row under each heading.
      const change =
        git
          .changes()
          .find((entry) => entry.path === path && entry.area === 'unstaged') ??
        git.changes().find((entry) => entry.path === path)
      if (!change) {
        return say(`No changes in ${relative(rootDir, path)}`)
      }
      panes.showView('git')
      // The file's own row has to exist before the cursor can be put on it.
      git.revealChange(change.area, change.rel)
      git.setGitCursor(
        git
          .rows()
          .findIndex(
            (row) =>
              row.kind === 'file' &&
              row.change.path === path &&
              row.change.area === change.area
          )
      )
      showChanges()
    },
    gitDiscard: () => offerDiscard(),
    gitFetch: () =>
      gitOp('Fetching', (repo) => fetchRemote(repo), { done: () => 'Fetched' }),
    gitFileHistory: () => {
      const path = workspace.activePath()
      if (!path) {
        return say('No file open', 'warn')
      }
      const repo = git.repoFor(path)
      if (repo === null) {
        return say('Not a git repository', 'warn')
      }
      const commits = fileHistory(repo, relative(repo, path))
      if (commits.length === 0) {
        return say('No commits touch this file')
      }
      ctx.prompts.setPrompt({ commits, kind: 'fileHistory', repo })
    },
    gitFocusMessage: () => {
      if (!git.inRepo()) {
        return say('Not a git repository', 'warn')
      }
      if (!git.staging()) {
        return say(
          'Comparing against a branch — nothing to commit here',
          'warn'
        )
      }
      panes.showView('git')
      git.setMessageEditing(true)
      void git.loadMessageHistory()
    },
    gitLandOnFile: () => {
      const row = git.cursorRow()
      if (row?.kind === 'file') {
        return
      }
      const at = git.rows().findIndex((entry) => entry.kind === 'file')
      // The cursor alone, not `gitMoveTo`: showing the sidebar must not throw a diff up.
      if (at !== -1) {
        git.setGitCursor(at)
      }
    },
    gitMergeBranch: () => ctx.branches.open('merge'),
    gitMoveTo,
    gitNewBranch: ctx.branches.newBranch,
    gitNewBranchFrom: () => ctx.branches.open('from'),
    gitNewTag: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      ctx.prompts.setPrompt({ kind: 'newTag', repo })
    },
    gitOpenRow,
    gitPull: () =>
      gitOp('Pulling', (repo) => pull(repo), { touchesTree: { kind: 'sync' } }),
    gitPush: () => {
      if (git.activeRepo() === null) {
        return say(noRepository(git), 'warn')
      }
      const name = git.branch()
      if (!name) {
        return say('No branch to push', 'warn')
      }
      const hasUpstream =
        git.upstream()?.name !== null && git.upstream()?.name !== undefined
      gitOp('Pushing', (repo) => push(repo, name, hasUpstream), {
        done: () =>
          hasUpstream
            ? `Pushed ${name}`
            : `Pushed ${name} — upstream set to origin/${name}`,
        handleFailure: (result) => {
          if (result.detail !== PUSH_REJECTED) {
            return false
          }
          ctx.prompts.setPrompt({ branch: name, hasUpstream, kind: 'pullPush' })
          return true
        },
      })
    },
    gitRemoveRemote: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const remotes = listRemotes(repo)
      if (remotes.length === 0) {
        return say('No remotes')
      }
      ctx.prompts.setPrompt({ kind: 'remoteRemove', remotes, repo })
    },
    gitRenameBranch: () => ctx.branches.open('rename'),
    gitStash: () =>
      gitOp('Stashing', (repo) => stashPush(repo), {
        touchesTree: { kind: 'sync' },
      }),
    gitStashList: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const stashes = stashList(repo)
      if (stashes.length === 0) {
        return say('No stashes')
      }
      ctx.prompts.setPrompt({ kind: 'stashPick', repo, stashes })
    },
    gitStashPop: () =>
      gitOp('Popping stash', (repo) => stashPop(repo), {
        touchesTree: { kind: 'sync' },
      }),
    gitSwitchBranch: () => ctx.branches.open('switch'),
    gitSync: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const name = git.branch()
      if (!name) {
        return say('No branch to sync', 'warn')
      }
      const hasUpstream =
        git.upstream()?.name !== null && git.upstream()?.name !== undefined
      gitOp(
        'Syncing',
        (r) =>
          hasUpstream ? pullAndPush(r, name, true) : push(r, name, false),
        {
          done: () =>
            hasUpstream
              ? `Synced ${name}`
              : `Published ${name} — upstream set to origin/${name}`,
          repo,
          touchesTree: { kind: 'sync' },
        }
      )
    },
    gitToggleStage,
    gitToggleStageKey,
    gitUndoCommit: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const subject = lastCommitSubject(repo)
      if (!subject) {
        return say('No commit to undo', 'warn')
      }
      ctx.prompts.setPrompt({ kind: 'undoCommit', subject })
    },
    gotoDefinition: lspNav('definition', 'Go to definition', 'Definitions'),
    gotoImplementation: lspNav(
      'implementation',
      'Go to implementation',
      'Implementations'
    ),
    gotoLine: () => ctx.prompts.setPrompt({ kind: 'gotoLine' }),
    gotoReferences: lspNav('references', 'Find references', 'References'),
    gotoSymbol: () =>
      withServed('Go to symbol in file', (path) => {
        void (async () => {
          const hits = symbolHits(
            await ctx.lsp.symbols(path, null),
            path,
            rootDir
          )
          if (hits.length === 0) {
            return say('No symbols found')
          }
          if (ctx.prompts.prompt()) {
            return
          }
          ctx.prompts.setPrompt({
            hits,
            kind: 'lspLocations',
            title: 'Symbols',
          })
        })()
      }),
    gotoTypeDefinition: lspNav(
      'typeDefinition',
      'Go to type definition',
      'Type definitions'
    ),
    gotoWorkspaceSymbol: () =>
      withServed('Go to symbol in project', (path) =>
        ctx.prompts.setPrompt({ kind: 'workspaceSymbol', path })
      ),
    lineHome: editor.requestLineHome,
    lineOp: editor.requestLineOp,
    lspStatus: () => {
      ctx.workspace.openPage('lspStatus')
      panes.setFocus('editor')
    },
    navBack: ctx.navigation.back,
    navForward: ctx.navigation.forward,
    newFile: () =>
      ctx.prompts.setPrompt({ dir: tree.targetDir(), kind: 'newFile' }),
    newFolder: () =>
      ctx.prompts.setPrompt({ dir: tree.targetDir(), kind: 'newFolder' }),
    newWorktree: ctx.workspaces.newWorktree,
    nextTab: () => workspace.switchTab(1),
    openChangeKey,
    openCommitOnWeb: () => {
      const repo = git.activeRepo()
      if (repo === null) {
        return say(noRepository(git), 'warn')
      }
      const oid =
        ctx.commitGraph.selected()?.oid ?? ctx.commitView.commit()?.commit.oid
      if (!oid) {
        return say('Select a commit in the graph first', 'warn')
      }
      const url = commitUrl(repo, oid)
      if (!url) {
        return say('No remote to open this commit on', 'warn')
      }
      // The URL itself is forty characters of hash: the forge and the short oid say the same thing.
      const where = `${oid.slice(0, 7)} on ${new URL(url).host}`
      void (async () => {
        const opened = await openInBrowser(url)
        if (opened) {
          return say(`Opened ${where}`)
        }
        // No browser to hand it to — over SSH there should not be one — so the link is copied instead.
        fileOps.copyLink(url)
        say(`Copied the link to ${where}`)
      })()
    },
    openExtensions: () => panes.toggleView('extensions'),
    openFile: () => ctx.overlays.setPicker('files'),
    openFileUnderCursor: () => {
      // Disk first, then the server, which is what places a bare package or an alias.
      const path = workspace.activePath()
      if (!path) {
        return say('No file open', 'warn')
      }
      const at = editor.cursor()
      const token = pathTokenAt(cursorLine(path), at.col)
      if (!token) {
        return say('No path under the cursor', 'warn')
      }
      const found = resolveImportPath(token, dirname(path), rootDir)
      if (found) {
        return openAt(found, 0, 0)
      }
      void (async () => {
        const target = await ctx.lsp.definition(path, at.line, at.col)
        if (!target) {
          return say(`Cannot find "${token}"`, 'warn')
        }
        openAt(target.path, target.line, target.col)
      })()
    },
    openGraphCommit: () => {
      const commit = ctx.commitGraph.selected()
      if (commit) {
        openCommitRow(commit.oid)
      }
    },
    openProjectSettings: () => {
      settings.setScope('project')
      ctx.workspace.openPage('settings')
      panes.setFocus('editor')
    },
    openReview: () => panes.toggleView('review'),
    openSettings: () => {
      settings.setScope('user')
      ctx.workspace.openPage('settings')
      panes.setFocus('editor')
    },
    openWorkspace: ctx.workspaces.openPrompt,
    paste: fileOps.paste,
    prevTab: () => workspace.switchTab(-1),
    previewIcons: settings.previewIcons,
    previewTheme: settings.previewTheme,
    problemsAtCursor: () => {
      const path = workspace.activePath()
      const list = path ? ctx.lsp.problems[path] : undefined
      if (!list || problemsOn(list, editor.cursor().line).length === 0) {
        return say('No problem on this line')
      }
      ctx.overlays.setProblemsOpen('cursor')
    },
    problemsList: () => {
      const any = workspace
        .tabs()
        .some((path) => (ctx.lsp.problems[path] ?? []).length > 0)
      if (!any) {
        return say('No problems')
      }
      ctx.overlays.setProblemsOpen('all')
    },
    problemsNext: () => jumpProblem(1),
    problemsPrev: () => jumpProblem(-1),
    quit: ctx.prompts.quit,
    redo: () => editor.requestHistory('redo'),
    refreshChanges: () => {
      if (!workspace.pageOpen('allChanges')) {
        return
      }
      // Only close a page that had changes: an empty one opened from the palette explains itself.
      const had = allChangesMeta().total > 0
      rebuildAllChanges()
      if (had && git.changes().length === 0) {
        workspace.closePage('allChanges')
      }
    },
    reloadExtensions: ctx.extensions.reload,
    remove: () => {
      const targets = tree.actionTargets()
      if (targets.length === 0) {
        return say('Nothing selected', 'warn')
      }
      ctx.prompts.setPrompt({ kind: 'delete', targets })
    },
    removeWorktree: () => ctx.workspaces.pickWorktree('remove'),
    rename: withNode((n) =>
      ctx.prompts.setPrompt({ kind: 'rename', target: n.path })
    ),
    reopenTab: workspace.reopenTab,
    replaceInFile: () =>
      ctx.overlays.setSearch({ replacing: true, scope: 'file' }),
    replaceInProject: () =>
      ctx.overlays.setSearch({ replacing: true, scope: 'project' }),
    restartLsp: () => {
      if (!settings.config.lsp) {
        return say('LSP is off', 'warn')
      }
      ctx.lsp.restart()
      say('Restarted language servers')
    },
    restoreIcons: settings.restoreIcons,
    restoreTheme: settings.restoreTheme,
    reviewActivate: (row: number) => ctx.review.activate(row, openNote),
    reviewClear: ctx.review.clear,
    reviewCollapseAll: ctx.review.collapseAll,
    reviewMove: (delta: number) => {
      ctx.review.move(delta)
      showNote()
    },
    reviewMoveTo: (row: number) => ctx.review.moveTo(row),
    reviewNote: () =>
      noteTarget((target) =>
        ctx.prompts.setPrompt({ kind: 'reviewKind', ...target })
      ),
    reviewNoteOf: (kind: NoteKind) =>
      noteTarget((target) =>
        ctx.prompts.setPrompt({ kind: 'reviewNote', ...target, noteKind: kind })
      ),
    reviewReply: () => {
      const parent = ctx.review.replyTarget()
      if (!parent) {
        return
      }
      const span = `${basename(parent.path)}:${parent.line + 1}`
      ctx.prompts.setPrompt({
        heading: `${NOTE_LABELS[parent.kind]} · ${span}`,
        kind: 'reviewReply',
        parent: parent.id,
      })
    },
    reviewShow: showNote,
    save: workspace.saveActive,
    saveAll: workspace.saveAll,
    saveWithoutFormatting: workspace.saveWithoutFormatting,
    setIconTheme: settings.applyIconTheme,
    setTheme: settings.applyTheme,
    showHelp: () => ctx.overlays.setHelp(true),
    switchTab: () => ctx.overlays.setPicker('tabs'),
    switchWorkspace: ctx.workspaces.pick,
    switchWorktree: () => ctx.workspaces.pickWorktree('switch'),
    toggleDiffLayout: settings.toggleDiffView,
    toggleFocus: () =>
      panes.focus() === 'tree' ? panes.setFocus('editor') : panes.focusTree(),
    toggleGitView: () => panes.toggleView('git'),
    toggleMarkdown: workspace.toggleRendered,
    togglePreview: () => {
      if (ctx.preview.on()) {
        ctx.preview.close()
        return say('Preview off')
      }
      panes.showView('files')
      ctx.preview.open()
      say('Preview on — ↑↓ walks the tree, Enter opens, Space closes')
    },
    toggleSidebar: panes.toggleSidebar,
    toggleSidebarPosition: settings.toggleSidebarPosition,
    toggleWrap: settings.toggleWrap,
    triggerCompletion: editor.requestCompletion,
    undo: () => editor.requestHistory('undo'),
    uninstallServer: (id: string) => {
      const target = ctx.lsp.removable(id)
      if (!target) {
        return say(`${id}: druk did not install it — nothing to remove`, 'warn')
      }
      ctx.prompts.setPrompt({
        id,
        kind: 'uninstallServer',
        name: target.name,
        packages: target.packages,
      })
    },
    updateExtensions: ctx.extensions.updateAll,
  }

  const promote = (id: string) => {
    const tip = keyTip(id)
    if (tip) {
      say(`Tip: ${tip}`)
    }
  }

  const commands = createMemo<Command[]>(() =>
    withKeymap(
      buildCommands(actions, {
        activeIconTheme: config.iconTheme,
        activeTheme: config.theme,
      }),
      promote
    )
  )

  return { actions, commands }
}
