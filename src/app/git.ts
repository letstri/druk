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
  recentCommitMessages,
  statusEntriesAsync,
  statusMap,
  upstreamCommits,
  upstreamOf,
} from '../core/git'
import type { ChangeArea, GitResult, LineChange, StatusEntry, Upstream } from '../core/git'
import { stepHistory } from '../core/messageHistory'
import { discoverRepos, groupByRepo, repoOf } from '../core/repos'
import type { CommitFile } from '../ui/CommitModal'
import type { EditorBridge } from './editor'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

// `panelView` is the live accessor, not a value: flipping the setting must rebuild the rows.
export function createGit(
  rootDir: string,
  panelView: () => 'tree' | 'list',
  panelShowing: () => boolean = () => false,
) {
  const [gitCursor, setGitCursor] = createSignal(0)
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  const [revision, setRevision] = createSignal(0)
  const [statusEntries, setStatusEntries] = createSignal<Map<string, StatusEntry>>(new Map())
  const gitStatus = createMemo(
    () => new Map([...statusEntries()].map(([path, e]) => [path, combinedStatus(e)])),
  )
  const [gitIgnored, setGitIgnored] = createSignal<Set<string>>(new Set())
  const [branch, setBranch] = createSignal<string | null>(null)
  const [repos, setRepos] = createSignal<string[]>(inRepository(rootDir) ? [rootDir] : [], {
    // Compared by content: the scanning effect reads this, so a fresh identity never settles.
    equals: (before, after) =>
      before.length === after.length && before.every((repo, at) => repo === after[at]),
  })
  const [editorRepo, setEditorRepo] = createSignal<string | null>(null)
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  const [gitBusy, setGitBusy] = createSignal(false)
  const [commitPick, setCommitPick] = createSignal<CommitFile[] | null>(null)
  const [commitVariant, setCommitVariant] = createSignal<CommitVariant>('commit')
  const [commitMessage, setCommitMessage] = createSignal('')
  const [messageEditing, setMessageEditing] = createSignal(false)
  const [messageHistory, setMessageHistory] = createSignal<string[]>([])
  // -1 is the draft `messageDraft` holds.
  const [messageAt, setMessageAt] = createSignal(-1)
  const [messageDraft, setMessageDraft] = createSignal('')
  // null is HEAD. Committing ignores it: the index is always built against HEAD.
  const [diffBase, setDiffBase] = createSignal<string | null>(null)

  const bump = () => setRevision(n => n + 1)

  // A path staged and then edited again is two changes, one under each heading.
  const changes = createMemo(() =>
    [...statusEntries()]
      .flatMap(([path, entry]) => {
        const rel = relative(rootDir, path)
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

  const staging = () => diffBase() === null

  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())

  const [syncCommits, setSyncCommits] = createSignal<{
    incoming: UpstreamCommit[]
    outgoing: UpstreamCommit[]
  }>({ incoming: [], outgoing: [] })

  const rows = createMemo(() => [
    ...changeRows(changes(), panelView(), collapsed(), staging()),
    ...(staging() ? commitRows(syncCommits().incoming, syncCommits().outgoing, collapsed()) : []),
  ])

  // The stored index outlives a shrinking list, so a raw `rows()[gitCursor()]` can miss the last row.
  const cursorRow = () => {
    const list = rows()
    if (list.length === 0) return undefined
    return list[Math.max(0, Math.min(gitCursor(), list.length - 1))]
  }

  const repoFor = (path: string) => repoOf(path, repos())

  const cursorRepo = createMemo(() => {
    if (!panelShowing()) return null
    const row = cursorRow()
    if (!row) return null
    if (row.kind === 'section' || row.kind === 'commit' || row.kind === 'commitSection') return null
    return repoFor(row.kind === 'file' ? row.change.path : join(rootDir, row.rel))
  })

  const activeRepo = createMemo(
    () => cursorRepo() ?? editorRepo() ?? (repos().length === 1 ? repos()[0]! : null),
  )

  const inRepo = () => repos().length > 0

  const loadMessageHistory = async () => {
    setMessageAt(-1)
    setMessageDraft('')
    const repo = activeRepo()
    setMessageHistory(repo === null ? [] : await recentCommitMessages(repo))
  }

  // `delta` 1 is ↑ (older), -1 is ↓ (newer).
  const walkMessageHistory = (delta: number) => {
    const step = stepHistory(messageHistory(), messageAt(), delta, commitMessage(), messageDraft())
    if (!step) return
    setMessageAt(step.at)
    setMessageDraft(step.draft)
    setCommitMessage(step.value)
  }

  // A recall sets the renderable's value, which emits `input` back: only a different value is typing.
  const typeMessage = (value: string) => {
    setCommitMessage(value)
    const at = messageAt()
    if (at >= 0 && value !== messageHistory()[at]) setMessageAt(-1)
  }

  const toggleCollapsed = (area: ChangeArea | CommitGroup, rel: string) =>
    setCollapsed(previous => {
      const next = new Set(previous)
      const key = foldKey(area, rel)
      if (!next.delete(key)) next.add(key)
      return next
    })

  // From a fully expanded pass: a single-child chain is one row keyed on the outermost.
  const collapseAll = () =>
    setCollapsed(
      new Set(
        changeRows(changes(), 'tree', new Set(), staging()).flatMap(row =>
          row.kind === 'dir' ? [foldKey(row.area, row.rel)] : [],
        ),
      ),
    )

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
    messageHistory,
    loadMessageHistory,
    walkMessageHistory,
    typeMessage,
    diffBase,
    setDiffBase,
    changes,
    rows,
    cursorRow,
    collapsed,
    toggleCollapsed,
    collapseAll,
    revealChange,
    syncCommits,
    setSyncCommits,
  }
}

export type Git = ReturnType<typeof createGit>

export function noRepository(git: Git): string {
  return git.repos().length > 0
    ? 'Which repository? Open a file in one, or put the panel cursor on its change'
    : 'Not a git repository'
}

// `run` is handed the repository: a caller that looked it up again could pick another.
export function createGitOp(deps: { git: Git; status: Status; workspace: Workspace }) {
  const { git, status, workspace } = deps
  return (
    verb: string,
    run: (repo: string) => Promise<GitResult>,
    options: {
      // Captured when the operation was offered, not the live cursor's.
      repo?: string
      touchesTree?: { kind: 'sync' } | { kind: 'followDisk'; paths: readonly string[] }
      done?: (result: GitResult) => string
      // True means the failure is taken over and no error line is written.
      handleFailure?: (result: GitResult) => boolean
    } = {},
  ) => {
    const repo = options.repo ?? git.activeRepo()
    if (repo === null) return status.say(noRepository(git), 'warn')
    if (git.gitBusy()) return status.say('A git command is already running — let it finish', 'warn')
    status.whileFree(() => {
      git.setGitBusy(true)
      const release = status.claimBusy({ label: verb })
      void run(repo)
        .then(result => {
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
          return status.say(options.done ? options.done(result) : result.detail || `${verb} done`)
        })
        .finally(() => {
          git.setGitBusy(false)
          release()
        })
    })
  }
}

export type GitOp = ReturnType<typeof createGitOp>

export type CommitVariant = 'commit' | 'commitPush' | 'commitSync'

// `paths` 'all' resolves when the operation runs: resolving at the confirm commits a stale set.
export function runCommit(
  gitOp: GitOp,
  git: Git,
  opts: {
    repo: string
    message: string
    paths: string[] | null | 'all'
    variant: CommitVariant
    onPushRejected?: (branch: string, hasUpstream: boolean) => void
  },
) {
  const verbs: Record<CommitVariant, string> = {
    commit: 'Committing',
    commitPush: 'Committing and pushing',
    commitSync: 'Committing and syncing',
  }
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
      // From the repository, not the signals: the active one may have changed under a confirm.
      const branch = currentBranch(repo)
      if (!branch) return { ok: true, detail: 'Committed — no branch to push' }
      const hasUpstream = (await upstreamOf(repo))?.name != null
      pushed = { branch, hasUpstream }
      if (opts.variant === 'commitPush') return push(repo, branch, hasUpstream)
      return hasUpstream ? pullAndPush(repo, branch, true) : push(repo, branch, false)
    },
    {
      repo: opts.repo,
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

const SCAN_INTERVAL = 5000

async function ignoredIn(repos: string[], paths: string[]): Promise<Set<string>> {
  const ignored = new Set<string>()
  for (const [repo, group] of groupByRepo(paths, repos)) {
    for (const path of await ignoredAmongAsync(repo, group)) ignored.add(path)
  }
  return ignored
}

export function wireGitEffects(deps: {
  rootDir: string
  git: Git
  tree: Tree
  editor: EditorBridge
  workspace: Workspace
  config: Config
}) {
  const { rootDir, git, tree, editor, workspace, config } = deps

  // Once per burst, and the body must read its inputs itself: what `on` handed it is stale by then.
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

  // Generation per query: a burst can land an earlier answer after a newer one, clearing included.
  let linesRun = 0
  let upstreamRun = 0

  const refreshLines = deferred(() => {
    const path = workspace.activePath()
    const run = ++linesRun
    if (!path) {
      git.setGitLines(new Map())
      return
    }
    void diffLines(path, git.diffBase()).then(lines => {
      if (run === linesRun) git.setGitLines(lines)
    })
  })

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, too heavy for every keystroke.
      () => [workspace.activePath(), editor.reloadKey(), git.revision(), git.diffBase()] as const,
      refreshLines,
    ),
  )

  const refreshUpstream = deferred(() => {
    const repo = git.activeRepo()
    const run = ++upstreamRun
    void (async () => {
      const upstream = repo ? await upstreamOf(repo) : null
      if (run !== upstreamRun) return
      git.setUpstream(upstream)
      const [incoming, outgoing] =
        repo && upstream?.name != null
          ? await Promise.all([
              upstreamCommits(repo, 'incoming'),
              upstreamCommits(repo, 'outgoing'),
            ])
          : [[], []]
      if (run === upstreamRun) git.setSyncCommits({ incoming, outgoing })
    })()
  })

  createEffect(on(() => [git.branch(), git.revision(), git.activeRepo()] as const, refreshUpstream))

  let generation = 0

  let scanned: string[] = []
  let scannedAt = 0
  let scannedDepth = -1
  const currentRepos = (depth: number) => {
    const now = Date.now()
    if (depth === scannedDepth && now - scannedAt < SCAN_INTERVAL) return scanned
    scannedDepth = depth
    scannedAt = now
    const found = discoverRepos(rootDir, depth)
    // The fallback is a checkout whose git directory is elsewhere (`--separate-git-dir`).
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

  // The branch rides along: nothing else notices HEAD moving in another terminal.
  createEffect(
    on(
      () =>
        [
          tree.expanded(),
          git.revision(),
          editor.reloadKey(),
          // Tracked here, not merely read in the body: the deferred body reads untracked.
          config.respectGitignore,
          config.gitScanDepth,
          git.diffBase(),
          git.activeRepo(),
        ] as const,
      refreshStatus,
    ),
  )

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
