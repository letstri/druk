import { dirname, relative } from 'node:path'

import { createMemo } from 'solid-js'

import { ancestorDirs } from '../core/changeTree'
import { readFile } from '../core/fs'
import type { TreeNode } from '../core/fs'
import {
  fetchRemote,
  inRepository,
  lastCommitSubject,
  pull,
  push,
  PUSH_REJECTED,
  refText,
  stagedPaths,
  stashPop,
  stashPush,
  statusMap,
} from '../core/git'
import type { FileStatus } from '../core/git'
import { pathTokenAt, resolveImportPath } from '../core/imports'
import type { DiffFile } from '../ui/DiffView'
import { buildCommands } from './commands'
import type { Command } from './commands'
import type { AppContext } from './context'
import { problemFrom } from './lsp'

/** Wire the palette's command tree to the controllers that carry the actions out. */
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

  /** For commands that act on the tree selection, which the palette can run without one. */
  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = tree.selectedNode()
    if (node) run(node)
    else say('Select a file in the tree first', 'warn')
  }

  /**
   * Both texts of one file's diff. The new side prefers the open buffer over the
   * disk, so unsaved edits show — that is the diff the user is looking at. Null
   * for a file that cannot be read (binary), which the callers skip.
   */
  const diffFileFor = (path: string, fileStatus: FileStatus): DiffFile | null => {
    const rel = relative(rootDir, path)
    const oldText =
      fileStatus === 'untracked' ? '' : (refText(rootDir, rel, git.diffBase() ?? 'HEAD') ?? '')
    let newText = ''
    if (fileStatus !== 'deleted') {
      const open = workspace.buffers[path]
      if (open) {
        newText = open.content
      } else {
        try {
          newText = readFile(path)
        } catch {
          return null
        }
      }
    }
    return { path, rel, status: fileStatus, oldText, newText }
  }

  /**
   * Show one changed file's diff over the editor slot. The source-control
   * panel's cursor is what pages through the changes, so everything that opens
   * a diff moves that cursor first and calls this second — a page the arrows
   * cannot move from is a dead end.
   */
  const showDiff = (path: string) => {
    // The panel only lists changed files, but its list is a frame behind a fresh
    // edit — 'modified' is the fallback for a path git has not caught up with,
    // and diffing it against the base is right either way.
    const file = diffFileFor(path, git.gitStatus().get(path) ?? 'modified')
    if (!file) return say('Cannot diff this file', 'warn')
    ctx.workspace.setPage(null)
    ctx.workspace.setDiff(file)
  }

  /**
   * Move the panel's cursor to `row`, diffing it if it is a file. The only way
   * the cursor moves, so the page and the cursor cannot disagree about which
   * change is on screen. A folder row leaves the page as it was: folding is what
   * `gitActivateRow` is for, and a mere pass over a folder must not fold it.
   */
  const gitMoveTo = (row: number) => {
    const rows = git.rows()
    const at = Math.max(0, Math.min(row, rows.length - 1))
    const target = rows[at]
    if (!target) return
    panes.setGitCursor(at)
    if (target.kind === 'file') showDiff(target.change.path)
  }

  /**
   * Fold every folder in the source-control panel. The cursor is moved rather
   * than clamped: its row is usually one of the ones just hidden, and the folder
   * that swallowed it is where it was. Deliberately not `gitMoveTo`, which would
   * throw a diff over whatever page is up for a mere fold.
   */
  const gitCollapseAll = () => {
    const row = git.rows()[panes.gitCursor()]
    const rel = row ? (row.kind === 'dir' ? row.rel : row.change.rel) : null
    git.collapseAll()
    const rows = git.rows()
    const top = rel ? (ancestorDirs(rel)[0] ?? rel) : null
    const at = rows.findIndex(r => (r.kind === 'dir' ? r.rel : r.change.rel) === top)
    panes.setGitCursor(at >= 0 ? at : Math.min(panes.gitCursor(), Math.max(0, rows.length - 1)))
  }

  /** Enter, or a click: a file diffs, a folder folds. */
  const gitActivateRow = (row: number) => {
    gitMoveTo(row)
    const target = git.rows()[panes.gitCursor()]
    if (target?.kind === 'dir') git.toggleCollapsed(target.rel)
  }

  /**
   * Land on a position in a file, from wherever the editor slot was. A page
   * gives way to it — `openFile` closes one, but a jump inside the file already
   * open never calls it — and a file that would not open leaves the goto unsent,
   * or it would aim at the file still on screen.
   */
  const openAt = (path: string, line: number, col: number) => {
    // A jump inside the file already open changes no tab, so nothing else would
    // record where it started — and the way back is what the jump is half of.
    if (path === workspace.activeView()) ctx.navigation.mark()
    workspace.setDiff(null)
    workspace.setPage(null)
    if (path !== workspace.activePath()) workspace.openFile(path)
    if (workspace.activePath() !== path) return
    editor.requestGoto(line, col)
    panes.setFocus('editor')
  }

  /** The line the cursor is on, as the buffer holds it. */
  const cursorLine = (path: string): string => {
    const at = editor.cursor()
    return workspace.buffers[path]?.content.split('\n')[at.line] ?? ''
  }

  /** Jump to the neighbouring problem and read it out in the status bar. */
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

  const actions = {
    save: workspace.saveActive,
    openFile: () => ctx.overlays.setPicker('files'),
    switchTab: () => ctx.overlays.setPicker('tabs'),
    closeOthers: () => {
      const keep = workspace.activePath()
      if (keep)
        workspace.closeTabs(
          workspace.tabs().filter(path => path !== keep),
          'Closed other tabs',
        )
    },
    closeAll: () => workspace.closeTabs(workspace.tabs(), 'Closed all tabs'),
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
    /**
     * Open the file the path under the cursor names. Disk first — a relative
     * import is placed without asking anyone — and the language server second,
     * for the specifiers no amount of path joining resolves: an alias declared
     * somewhere this cannot read, a bundler's own map, a package in
     * `node_modules`. The server resolves those the way the project does.
     */
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
    paste: fileOps.paste,
    closeTab: () => void (workspace.activePath() && workspace.closeTab(workspace.activePath()!)),
    reopenTab: workspace.reopenTab,
    nextTab: () => workspace.switchTab(1),
    prevTab: () => workspace.switchTab(-1),
    navBack: ctx.navigation.back,
    navForward: ctx.navigation.forward,
    toggleFocus: () => (panes.focus() === 'tree' ? panes.setFocus('editor') : panes.focusTree()),
    toggleSidebar: panes.toggleSidebar,
    // One command for the button both sidebar views carry: which of them is up
    // is what "collapse everything" means.
    collapseSidebar: () => (panes.view() === 'git' ? gitCollapseAll() : tree.collapseAll()),
    gitCollapseAll,
    toggleGitView: panes.toggleGitView,
    toggleMarkdown: workspace.toggleRendered,
    setTheme: settings.applyTheme,
    previewTheme: settings.previewTheme,
    restoreTheme: settings.restoreTheme,
    toggleWrap: settings.toggleWrap,
    lineOp: editor.requestLineOp,
    triggerCompletion: editor.requestCompletion,
    openSettings: () => {
      settings.setScope('user')
      // One page at a time: the slot under the settings page is the editor's.
      ctx.workspace.setDiff(null)
      ctx.workspace.setPage('settings')
      panes.setFocus('editor')
    },
    openProjectSettings: () => {
      settings.setScope('project')
      ctx.workspace.setDiff(null)
      ctx.workspace.setPage('settings')
      panes.setFocus('editor')
    },
    lspStatus: () => {
      ctx.workspace.setDiff(null)
      ctx.workspace.setPage('lspStatus')
      panes.setFocus('editor')
    },
    problemsList: () => {
      const any = workspace.tabs().some(path => (ctx.lsp.problems[path] ?? []).length > 0)
      if (!any) return say('No problems')
      ctx.overlays.setProblemsOpen(true)
    },
    problemsNext: () => jumpProblem(1),
    problemsPrev: () => jumpProblem(-1),
    /**
     * Delete druk's own copy of a server. Only ever druk's: one on PATH or in
     * the project is not druk's to remove, and the row says so rather than
     * offering a confirm that would do nothing.
     */
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
    showDiff,
    gitCompareBranches: () => {
      ctx.workspace.setDiff(null)
      panes.showView('git')
      comparison.open()
    },
    gitMoveTo,
    gitActivateRow,
    /**
     * "Diff current file" — the palette's way into the panel: it opens the
     * source-control view with the cursor on the file being edited, so the
     * arrows carry on from there like any other diff.
     */
    gitDiffFile: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      const change = git.changes().find(entry => entry.path === path)
      if (!change) return say(`No changes in ${relative(rootDir, path)}`)
      panes.showView('git')
      // A folded folder would leave the cursor pointing at a row that is not on
      // screen — the file's own row has to exist before it can be landed on.
      git.revealChange(change.rel)
      panes.setGitCursor(
        git.rows().findIndex(row => row.kind === 'file' && row.change.path === path),
      )
      showDiff(path)
    },
    /**
     * Rebuild the open diff from the repository as it is now. The page is a
     * snapshot taken when it opened, so a commit, stash or save made anywhere
     * else would otherwise leave it showing changes that no longer exist. Not a
     * palette command: `App` runs it whenever git or a buffer moves.
     */
    refreshDiff: () => {
      const shown = workspace.diff()?.path
      if (!shown) return
      // The page belongs to a row in the panel: once the change is committed,
      // stashed or reverted the row is gone, and so is the page it opened.
      const fileStatus = git.gitStatus().get(shown)
      if (!fileStatus) return ctx.workspace.setDiff(null)
      ctx.workspace.setDiff(diffFileFor(shown, fileStatus))
    },
    /**
     * Point everything at another branch: the tree marks, the gutter, the
     * source-control list and the diff page all compare against it until this is
     * put back. Reviewing a whole branch is what this is for — "what does my work
     * add to main", rather than "what have I not committed yet".
     */
    gitDiffBase: () => ctx.branches.open('diffBase'),
    gitDiffBaseReset: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      if (git.diffBase() === null) return say('Already comparing against HEAD')
      git.setDiffBase(null)
      say('Comparing against HEAD')
    },
    gitCommit: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      // A hand-built index is a selection already made, so the picker mirrors
      // it: staged files start checked, the rest unchecked. With nothing
      // staged there is no selection to respect and everything starts checked.
      const staged = stagedPaths(rootDir)
      // Deliberately not `git.diffBase()`: the index is built against HEAD no
      // matter which branch is being reviewed, so offering the files that differ
      // from some other branch would stage work that is already committed.
      const changes = [...statusMap(rootDir)]
        .map(([path, fileStatus]) => ({
          path,
          rel: relative(rootDir, path),
          status: fileStatus,
          checked: staged.size === 0 || staged.has(path),
        }))
        .toSorted((a, b) => a.rel.localeCompare(b.rel))
      if (changes.length === 0) return say('Nothing to commit — working tree clean')
      git.setCommitPick(changes)
    },
    gitUndoCommit: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      const subject = lastCommitSubject(rootDir)
      if (!subject) return say('No commit to undo', 'warn')
      ctx.prompts.setPrompt({ kind: 'undoCommit', subject })
    },
    gitPush: () => {
      const name = git.branch()
      // Detached HEAD and an unborn branch both land here; neither is pushable.
      if (!name) return say('No branch to push', 'warn')
      const hasUpstream = git.upstream()?.name != null
      gitOp('Pushing', () => push(rootDir, name, hasUpstream), {
        done: () =>
          hasUpstream ? `Pushed ${name}` : `Pushed ${name} — upstream set to origin/${name}`,
        // Rejected because origin moved on: the fix is the same two commands
        // every time, so offer to run them rather than name them and stop.
        handleFailure: result => {
          if (result.detail !== PUSH_REJECTED) return false
          ctx.prompts.setPrompt({ kind: 'pullPush', branch: name, hasUpstream })
          return true
        },
      })
    },
    gitFetch: () => gitOp('Fetching', () => fetchRemote(rootDir), { done: () => 'Fetched' }),
    gitPull: () => gitOp('Pulling', () => pull(rootDir), { touchesTree: true }),
    gitStash: () => gitOp('Stashing', () => stashPush(rootDir), { touchesTree: true }),
    gitStashPop: () => gitOp('Popping stash', () => stashPop(rootDir), { touchesTree: true }),
    gitSwitchBranch: () => ctx.branches.open('switch'),
    gitNewBranch: ctx.branches.newBranch,
    gitNewBranchFrom: () => ctx.branches.open('from'),
    gitMergeBranch: () => ctx.branches.open('merge'),
    gitRenameBranch: () => ctx.branches.open('rename'),
    gitDeleteBranch: () => ctx.branches.open('delete'),
    gitDeleteBranchForce: () => ctx.branches.open('deleteForce'),
    openExtensions: panes.toggleExtensionsView,
    reloadExtensions: ctx.extensions.reload,
    updateExtensions: ctx.extensions.updateAll,
    checkExtensionUpdates: ctx.extensions.checkNow,
    showHelp: () => ctx.overlays.setHelp(true),
    quit: ctx.prompts.quit,
  }

  const commands = createMemo<Command[]>(() =>
    buildCommands(actions, { activeTheme: config.theme }),
  )

  return { commands, actions }
}
