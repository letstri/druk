import { join, relative } from 'node:path'

import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'

import { ancestorDirs, changeRows, commitRows, foldKey } from '../core/changeTree'
import type { Change, CommitGroup, UpstreamCommit } from '../core/changeTree'
import type { Config } from '../core/config'
import {
  combinedStatus,
  commitPaths,
  commitStaged,
  currentBranch,
  currentBranchAsync,
  diffLines,
  ignoredAmongAsync,
  inRepository,
  pullAndPush,
  push,
  PUSH_REJECTED,
  statusEntriesAsync,
  statusMap,
  upstreamCommits,
  upstreamOf,
} from '../core/git'
import type { ChangeArea, GitResult, LineChange, StatusEntry, Upstream } from '../core/git'
import { discoverRepos, groupByRepo, repoOf } from '../core/repos'
import type { CommitFile } from '../ui/CommitModal'
import type { EditorBridge } from './editor'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/**
 * Everything the UI shows about the repositories, refreshed by `wireGitEffects`.
 *
 * There may be more than one: a folder that only *holds* checkouts is as ordinary
 * a thing to open as a checkout itself, and every query runs in the repository
 * the path it is about belongs to. One of them is the *active* one — whose branch
 * the status bar shows and which the commands act on — and the panel's cursor is what
 * makes it follow the source-control panel: acting on a repository other than the
 * one whose change is under the cursor is never what was meant.
 *
 * `panelView` is read on every render of the panel's rows, so it is the live
 * config accessor rather than a value — flipping the setting must rebuild them.
 */
export function createGit(
  rootDir: string,
  panelView: () => 'tree' | 'list',
  panelShowing: () => boolean = () => false,
) {
  /** Row under the cursor in the source-control panel; clamped where it is read,
   * because the change list shrinks under it on every commit. */
  const [gitCursor, setGitCursor] = createSignal(0)
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  /** Bumped when something may have changed what git would report. */
  const [revision, setRevision] = createSignal(0)
  /** Both porcelain columns per path — what the panel's two headings come from. */
  const [statusEntries, setStatusEntries] = createSignal<Map<string, StatusEntry>>(new Map())
  /** One mark per path, for the tree and the gutter, which want no such split. */
  const gitStatus = createMemo(
    () => new Map([...statusEntries()].map(([path, e]) => [path, combinedStatus(e)])),
  )
  /** Visible tree paths that `.gitignore` excludes — dimmed in the sidebar. */
  const [gitIgnored, setGitIgnored] = createSignal<Set<string>>(new Set())
  // Starts null and is filled by `wireGitEffects` after the first frame: reading
  // the branch here is a synchronous subprocess on the render thread's clock.
  const [branch, setBranch] = createSignal<string | null>(null)
  /**
   * Every repository under the opened folder — itself, when that is one. A signal
   * because finding them reads the filesystem: the panel and the tree ask on
   * every render, and a scan there would run once per frame.
   */
  const [repos, setRepos] = createSignal<string[]>(inRepository(rootDir) ? [rootDir] : [], {
    // Compared by content: a scan builds a fresh array every refresh, and the
    // effect that scans also depends on `activeRepo` — which reads this. A new
    // identity for an unchanged list is a loop that never settles.
    equals: (before, after) =>
      before.length === after.length && before.every((repo, at) => repo === after[at]),
  })
  /** Repository of whatever the editor is on, kept by `wireGitEffects`. */
  const [editorRepo, setEditorRepo] = createSignal<string | null>(null)
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  /** A git mutation in flight — one at a time, they share a repository. */
  const [gitBusy, setGitBusy] = createSignal(false)
  /** Changed files offered to "Commit…", or null when the picker is closed. */
  const [commitPick, setCommitPick] = createSignal<CommitFile[] | null>(null)
  /** What follows the commit the picker or prompt is building — set when either opens. */
  const [commitVariant, setCommitVariant] = createSignal<CommitVariant>('commit')
  /**
   * The panel's commit box — VS Code's message field over the change list. The
   * text outlives the editing state on purpose: leaving the box to look at a
   * diff must not throw a half-written message away.
   */
  const [commitMessage, setCommitMessage] = createSignal('')
  /** Whether the box owns the keyboard — a real input only while it does. */
  const [messageEditing, setMessageEditing] = createSignal(false)
  /**
   * What every comparison is against: null is HEAD, and a ref name points the
   * whole editor at that branch instead — tree marks, gutter, the panel's list
   * and the diff page all follow it. Committing deliberately does not: the index
   * is always built against HEAD, whatever is being reviewed.
   */
  const [diffBase, setDiffBase] = createSignal<string | null>(null)

  const bump = () => setRevision(n => n + 1)

  /**
   * The changed files as the source-control panel lists them, in path order.
   * A path staged and then edited again is two changes, one under each heading —
   * git reports two states for it, and staging the rest of it is a thing to do.
   */
  const changes = createMemo(() =>
    [...statusEntries()]
      .flatMap(([path, entry]) => {
        const rel = relative(rootDir, path)
        // An unmerged path is one row under Merge Changes, not one per column:
        // the merge is the change, and Space (git add) is what resolves it.
        if (entry.conflicted) {
          return [{ path, rel, status: entry.unstaged ?? 'modified', area: 'merge' as const }]
        }
        const both: Change[] = []
        if (entry.staged) both.push({ path, rel, status: entry.staged, area: 'staged' })
        if (entry.unstaged) both.push({ path, rel, status: entry.unstaged, area: 'unstaged' })
        return both
      })
      .toSorted((a, b) => a.rel.localeCompare(b.rel)),
  )

  /** Whether anything can be staged at all — see `statusEntries` in `core/git`. */
  const staging = () => diffBase() === null

  /** Folder and heading rows the panel has folded away, keyed by `foldKey`. */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())

  /** The upstream commits the sync sections list, kept by `wireGitEffects`. */
  const [syncCommits, setSyncCommits] = createSignal<{
    incoming: UpstreamCommit[]
    outgoing: UpstreamCommit[]
  }>({ incoming: [], outgoing: [] })

  /**
   * What the panel draws and what the cursor counts, folder and heading rows
   * included. Every caller works in row indices: `changes` is no longer
   * addressable by cursor, because in tree mode most rows are not files.
   * The sync sections ride under the change list; against a comparison base
   * they are dropped with the headings — the distance shown would be HEAD's,
   * not the base's, and nothing on the page would explain whose.
   */
  const rows = createMemo(() => [
    ...changeRows(changes(), panelView(), collapsed(), staging()),
    ...(staging() ? commitRows(syncCommits().incoming, syncCommits().outgoing, collapsed()) : []),
  ])

  /** Which repository a path belongs to — the innermost, so a nested one wins. */
  const repoFor = (path: string) => repoOf(path, repos())

  /** The repository the source-control panel's cursor is in, when it is showing. */
  const cursorRepo = createMemo(() => {
    if (!panelShowing()) return null
    const at = gitCursor()
    const row = rows()[Math.max(0, Math.min(at, rows().length - 1))]
    if (!row) return null
    // A heading is about no path in particular, so it says nothing about which
    // repository is meant and the open file answers instead — and a sync row is
    // the active repository's by construction, which is the same fallback.
    if (row.kind === 'section' || row.kind === 'commit' || row.kind === 'commitSection') return null
    return repoFor(row.kind === 'file' ? row.change.path : join(rootDir, row.rel))
  })

  /**
   * The repository every command acts on and the status bar reports. The panel's
   * cursor wins while it is up — it is what the diff on screen belongs to — then
   * the open file, and a single repository answers whatever either of them says.
   */
  const activeRepo = createMemo(
    () => cursorRepo() ?? editorRepo() ?? (repos().length === 1 ? repos()[0]! : null),
  )

  const inRepo = () => repos().length > 0

  const toggleCollapsed = (area: ChangeArea | CommitGroup, rel: string) =>
    setCollapsed(previous => {
      const next = new Set(previous)
      const key = foldKey(area, rel)
      if (!next.delete(key)) next.add(key)
      return next
    })

  /**
   * Fold every folder the panel can draw. Headings stay open: folding them hides
   * the whole panel, which is not what "collapse folders" offers anywhere else.
   *
   * Taken from a fully expanded pass rather than from the changes' own ancestors:
   * a chain of single-child folders is drawn as one row keyed on the outermost of
   * them, so a deeper rel in the set would hide a subtree leaving no row to press.
   */
  const collapseAll = () =>
    setCollapsed(
      new Set(
        changeRows(changes(), 'tree', new Set(), staging()).flatMap(row =>
          row.kind === 'dir' ? [foldKey(row.area, row.rel)] : [],
        ),
      ),
    )

  /** Unfold every folder on the way to `rel`, so its row is on screen to land on. */
  const revealChange = (area: ChangeArea, rel: string) =>
    setCollapsed(previous => {
      const hiding = [
        foldKey(area, ''),
        ...ancestorDirs(rel).map(dir => foldKey(area, dir)),
      ].filter(key => previous.has(key))
      if (hiding.length === 0) return previous
      const next = new Set(previous)
      for (const key of hiding) next.delete(key)
      return next
    })

  return {
    gitCursor,
    setGitCursor,
    gitLines,
    setGitLines,
    revision,
    bump,
    gitStatus,
    statusEntries,
    setStatusEntries,
    staging,
    gitIgnored,
    setGitIgnored,
    branch,
    setBranch,
    repos,
    setRepos,
    repoFor,
    editorRepo,
    setEditorRepo,
    activeRepo,
    inRepo,
    upstream,
    setUpstream,
    gitBusy,
    setGitBusy,
    commitPick,
    setCommitPick,
    commitVariant,
    setCommitVariant,
    commitMessage,
    setCommitMessage,
    messageEditing,
    setMessageEditing,
    diffBase,
    setDiffBase,
    changes,
    rows,
    collapsed,
    toggleCollapsed,
    collapseAll,
    revealChange,
    syncCommits,
    setSyncCommits,
  }
}

export type Git = ReturnType<typeof createGit>

/**
 * Why a git command will not run. With repositories open but none of them
 * picked, "not a git repository" would be a lie about a folder full of them —
 * what is missing is which one the command is meant for.
 */
export function noRepository(git: Git): string {
  return git.repos().length > 0
    ? 'Which repository? Open a file in one, or put the panel cursor on its change'
    : 'Not a git repository'
}

/**
 * Run one git mutation: refuse outside a repository, keep them serial, report
 * what git said. `touchesTree` pulls the working tree back into open buffers —
 * a stash or pull rewrites files under the editor, and waiting for the watcher
 * would leave stale buffers on screen for its debounce interval.
 *
 * `run` is handed the repository to work in rather than reading one itself: with
 * several open, the one this refused to run without is the one the command has
 * to use, and a caller that looked it up again could pick another.
 */
export function createGitOp(deps: { git: Git; status: Status; workspace: Workspace }) {
  const { git, status, workspace } = deps
  return (
    verb: string,
    run: (repo: string) => Promise<GitResult>,
    options: {
      /** Repository captured when the operation was offered, rather than the live cursor's. */
      repo?: string
      /** How buffers follow a successful operation that rewrites the working tree. */
      touchesTree?: { kind: 'sync' } | { kind: 'followDisk'; paths: readonly string[] }
      done?: (result: GitResult) => string
      /**
       * Offer a way out of a failure instead of reporting it. Returning true
       * means this call has taken the failure over — whatever it put on the
       * status bar stays there, in place of the error line.
       */
      handleFailure?: (result: GitResult) => boolean
    } = {},
  ) => {
    const repo = options.repo ?? git.activeRepo()
    if (repo === null) return status.say(noRepository(git), 'warn')
    if (git.gitBusy()) return status.say('A git command is already running — let it finish', 'warn')
    git.setGitBusy(true)
    status.say(`${verb}…`)
    void run(repo).then(result => {
      git.setGitBusy(false)
      git.bump()
      if (!result.ok) {
        if (options.handleFailure?.(result)) return
        return status.say(result.detail || `${verb} failed`, 'error')
      }
      if (options.touchesTree?.kind === 'sync') {
        const warning = workspace.clashWarning(workspace.syncFromDisk())
        if (warning) return status.say(warning, 'warn')
      } else if (options.touchesTree?.kind === 'followDisk') {
        for (const path of options.touchesTree.paths) workspace.followDisk(path)
      }
      status.say(options.done ? options.done(result) : result.detail || `${verb} done`)
    })
  }
}

export type GitOp = ReturnType<typeof createGitOp>

/** What follows the commit itself — VS Code's Commit & Push / Commit & Sync. */
export type CommitVariant = 'commit' | 'commitPush' | 'commitSync'

/**
 * One commit, whichever door it came through — the panel's box, the message
 * prompt, or the "no staged changes" confirm — so the push half and the
 * message-clearing cannot drift apart between them.
 *
 * `paths` is null for the index as it stands, `'all'` for every change the
 * repository has *when the operation runs* — the confirm that offers it names a
 * count, and resolving the list early would commit a stale set after an edit
 * made while the confirm sat open.
 */
export function runCommit(
  gitOp: GitOp,
  git: Git,
  opts: {
    repo: string
    message: string
    paths: string[] | null | 'all'
    variant: CommitVariant
    /** Raised when the push half is rejected because origin moved on. */
    onPushRejected?: (branch: string, hasUpstream: boolean) => void
  },
) {
  const verbs: Record<CommitVariant, string> = {
    commit: 'Committing',
    commitPush: 'Committing and pushing',
    commitSync: 'Committing and syncing',
  }
  // Whether the commit itself landed: a rejected push after it must still clear
  // the message box — those words are in a commit now.
  let committed = false
  let pushed: { branch: string; hasUpstream: boolean } | null = null
  gitOp(
    verbs[opts.variant],
    async repo => {
      const paths = opts.paths === 'all' ? [...statusMap(repo).keys()] : opts.paths
      if (paths !== null && paths.length === 0) {
        return { ok: false, detail: 'Nothing to commit — working tree clean' }
      }
      const commit =
        paths === null
          ? await commitStaged(repo, opts.message)
          : await commitPaths(repo, opts.message, paths)
      if (!commit.ok || opts.variant === 'commit') {
        committed = commit.ok
        return commit
      }
      committed = true
      // Asked of the repository rather than taken from the signals: the payload
      // may have sat in a confirm while the active repository changed under it.
      const branch = currentBranch(repo)
      if (!branch) return { ok: true, detail: 'Committed — no branch to push' }
      const hasUpstream = upstreamOf(repo)?.name != null
      pushed = { branch, hasUpstream }
      if (opts.variant === 'commitPush') return push(repo, branch, hasUpstream)
      // Sync on a branch origin has never seen is a publish, VS Code's own turn.
      return hasUpstream ? pullAndPush(repo, branch, true) : push(repo, branch, false)
    },
    {
      repo: opts.repo,
      // The pull half of a sync rewrites files under open buffers.
      touchesTree: opts.variant === 'commitSync' ? { kind: 'sync' } : undefined,
      done: result => {
        git.setCommitMessage('')
        return result.detail || 'Committed'
      },
      handleFailure: result => {
        if (committed) git.setCommitMessage('')
        if (result.detail !== PUSH_REJECTED || !pushed || !opts.onPushRejected) return false
        opts.onPushRejected(pushed.branch, pushed.hasUpstream)
        return true
      },
    },
  )
}

/** How long a repository scan stands before the next refresh redoes it. */
const SCAN_INTERVAL = 5000

/** `ignoredAmong` per repository the visible rows fall in. */
async function ignoredIn(repos: string[], paths: string[]): Promise<Set<string>> {
  const ignored = new Set<string>()
  for (const [repo, group] of groupByRepo(paths, repos)) {
    for (const path of await ignoredAmongAsync(repo, group)) ignored.add(path)
  }
  return ignored
}

/** Keep the git signals current, each on the cheapest cadence that stays correct. */
export function wireGitEffects(deps: {
  rootDir: string
  git: Git
  tree: Tree
  editor: EditorBridge
  workspace: Workspace
  config: Config
}) {
  const { rootDir, git, tree, editor, workspace, config } = deps

  /**
   * Run `query` after the frame that asked for it, and once per burst.
   *
   * Every query below is a handful of synchronous subprocesses — ~75ms together
   * on a middling repository, hundreds of milliseconds on a large one — so run
   * inline they are paid out of whatever repaint triggered them: the initial
   * render, or, most visibly, the two refreshes a save with a formatter asks for
   * before and after the tool runs. Deferring puts the frame on screen first and
   * collapses a burst (a save's own bump, then the watcher's on the formatter's
   * write) into one pass. The body must therefore read its inputs itself: by the
   * time it runs, the values `on` handed the effect may be a burst out of date.
   */
  const deferred = (query: () => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    onCleanup(() => {
      if (timer) clearTimeout(timer)
    })
    return () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        query()
      }, 0)
    }
  }

  const refreshLines = deferred(() => {
    const path = workspace.activePath()
    git.setGitLines(path ? diffLines(path, git.diffBase()) : new Map())
  })

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, far too heavy to run
      // on every keystroke. Saving bumps reloadKey, which refreshes the marks.
      () => [workspace.activePath(), editor.reloadKey(), git.revision(), git.diffBase()] as const,
      refreshLines,
    ),
  )

  const refreshUpstream = deferred(() => {
    const repo = git.activeRepo()
    const upstream = repo ? upstreamOf(repo) : null
    git.setUpstream(upstream)
    // The sync sections measure the same distance, so they move on its cadence.
    git.setSyncCommits(
      repo && upstream?.name != null
        ? {
            incoming: upstreamCommits(repo, 'incoming'),
            outgoing: upstreamCommits(repo, 'outgoing'),
          }
        : { incoming: [], outgoing: [] },
    )
  })

  // Ahead/behind only moves when history does, so it is deliberately not tied to
  // the tree refresh, which fires on every filesystem event. The active
  // repository is one of the inputs: with several open, moving to another one is
  // as much of a change as its history moving.
  createEffect(on(() => [git.branch(), git.revision(), git.activeRepo()] as const, refreshUpstream))

  /**
   * Which query answered last wins, and an earlier one that comes back after it
   * must be dropped: the status queries are asynchronous, and a burst can put a
   * slow repository's answer behind a newer pass over all of them.
   */
  let generation = 0

  /**
   * The repositories, rescanned at most every `SCAN_INTERVAL`.
   *
   * `git init` in another terminal writes .git, and a repository can be cloned
   * into the folder while druk is open, so this cannot be answered once — but it
   * rides the tree refresh, which fires on every filesystem event, and reading a
   * folder tree three levels deep on each keystroke's save is not what any of
   * those events is asking about. A repository that appears shows up a few
   * seconds later; nothing else waits on it.
   */
  let scanned: string[] = []
  let scannedAt = 0
  let scannedDepth = -1
  const currentRepos = (depth: number) => {
    const now = Date.now()
    if (depth === scannedDepth && now - scannedAt < SCAN_INTERVAL) return scanned
    scannedDepth = depth
    scannedAt = now
    const found = discoverRepos(rootDir, depth)
    // The fallback covers what the filesystem cannot see — a checkout whose git
    // directory is elsewhere (`GIT_DIR`, `--separate-git-dir`), which only git
    // itself can answer for.
    scanned = found.length > 0 ? found : inRepository(rootDir) ? [rootDir] : []
    return scanned
  }

  const refreshStatus = deferred(() => {
    git.setRepos(currentRepos(config.gitScanDepth))

    const run = ++generation
    const base = git.diffBase()
    void Promise.all(git.repos().map(repo => statusEntriesAsync(repo, base))).then(maps => {
      if (run !== generation) return
      const merged = new Map<string, StatusEntry>()
      for (const map of maps) {
        for (const [path, entry] of map) merged.set(path, entry)
      }
      git.setStatusEntries(merged)
    })

    // With the rows hidden outright there is nothing left to dim, and the
    // subprocess would answer "none of these" on every filesystem event.
    // Asynchronous like the status above, and behind the same generation guard:
    // run inline these were the last synchronous subprocesses on the refresh
    // cadence, and each one froze input — hover included — for its run time.
    if (config.respectGitignore) {
      git.setGitIgnored(new Set<string>())
    } else {
      void ignoredIn(
        git.repos(),
        tree.nodes().map(n => n.path),
      ).then(ignored => {
        if (run === generation) git.setGitIgnored(ignored)
      })
    }
    const active = git.activeRepo()
    void (active ? currentBranchAsync(active) : Promise.resolve(null)).then(branch => {
      if (run === generation) git.setBranch(branch)
    })
  })

  // Tree marks follow the same cadence, plus any filesystem change. The branch
  // rides along: a checkout in another terminal writes .git, so the watcher fires
  // here, and nothing else would ever notice HEAD had moved. Ignored paths ride
  // the same tick: expansion reveals new rows that need a check-ignore pass.
  createEffect(
    on(
      () =>
        [
          tree.expanded(),
          git.revision(),
          editor.reloadKey(),
          // Not merely read in the body: flipping the setting is the one thing
          // that changes the answer without touching the tree or the repository.
          config.respectGitignore,
          config.gitScanDepth,
          git.diffBase(),
          // The branch is this repository's, so moving between them re-reads it.
          git.activeRepo(),
        ] as const,
      refreshStatus,
    ),
  )

  // Which repository the editor is in. The tree's selection stands in while no
  // file is open — browsing a repository is enough to mean it, and without it a
  // folder of checkouts would show no branch until something was opened.
  createEffect(
    on(
      () => [workspace.activePath(), tree.selectedPath(), git.repos()] as const,
      ([path, selected]) =>
        git.setEditorRepo(
          (path ? git.repoFor(path) : null) ?? (selected ? git.repoFor(selected) : null),
        ),
    ),
  )
}
