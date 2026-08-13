import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { decodeText } from './fs'
// Not `run`: every query in this file names its own result `run`, and the two
// spellings sitting in one scope is how a call ends up aimed at the wrong one.
import { notInstalled, run as runProcess } from './process'
import type { ProcessResult } from './process'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/** Which of git's two columns a change is in — the index, or the working tree. */
export type StageArea = 'staged' | 'unstaged'

/** The panel's groups: the two index sides, and the paths a merge left in conflict. */
export type ChangeArea = StageArea | 'merge'

/**
 * One path's change split the way porcelain reports it. Both sides can be set at
 * once: a file edited after being added is staged *and* unstaged, and the panel
 * lists it under both headings, as VS Code does.
 */
export interface StatusEntry {
  staged: FileStatus | null
  unstaged: FileStatus | null
  /** A merge left this path unmerged — the panel's `Merge Changes` group. */
  conflicted?: boolean
}

/** The single mark the tree and the gutter want: staged wins when both are set. */
export function combinedStatus(entry: StatusEntry): FileStatus {
  return entry.staged ?? entry.unstaged ?? 'modified'
}

/**
 * Queries run synchronously (`git`) — they sit behind the gutter marks, tree marks
 * and status bar, and finish in milliseconds. Mutations run through `mutate`,
 * asynchronously: a push or fetch talks to the network and would freeze the whole
 * TUI for its duration if awaited on the render thread's clock.
 *
 * `spawnSync` truncates at 1 MB by default and reports ENOBUFS, which every caller
 * here reads as "no output" — `status` would lose files in a large repository.
 */
const MAX_OUTPUT = 128 * 1024 * 1024

function git(cwd: string, args: string[], timeout = 5000, input?: string) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT,
    input,
  })
}

/**
 * `git` off the render thread, for the comparison queries — the synchronous
 * `git` above would stall a frame for as long as the subprocess takes, which on
 * a branch's worth of files is not a frame's worth of time.
 */
function gitAsync(cwd: string, args: string[], timeout = 10_000): Promise<ProcessResult> {
  return runProcess('git', args, { cwd, timeout, maxOutput: MAX_OUTPUT })
}

/**
 * Lines changed against `ref` (HEAD when null), keyed by 0-based line number.
 * Returns an empty map outside a repository, for untracked files, or when git is
 * unavailable.
 */
export function diffLines(path: string, ref: string | null = null): Map<number, LineChange> {
  const marks = new Map<number, LineChange>()
  const run = git(
    dirname(path),
    ['diff', '--no-color', '--unified=0', ...(ref ? [ref] : []), '--', path],
    3000,
  )
  if (run.status !== 0 || !run.stdout) return marks

  for (const hunk of run.stdout.split('\n')) {
    // @@ -oldStart,oldCount +newStart,newCount @@
    const header = hunk.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!header) continue
    const removed = header[1] === undefined ? 1 : Number(header[1])
    const start = Number(header[2])
    const added = header[3] === undefined ? 1 : Number(header[3])

    if (added === 0) {
      // Pure deletion: mark the line the removed text sat above.
      marks.set(Math.max(0, start - 1), 'deleted')
      continue
    }
    // A hunk that replaces N lines with M: the first N are rewrites, the rest new.
    for (let i = 0; i < added; i++) {
      marks.set(start - 1 + i, i < removed ? 'modified' : 'added')
    }
  }
  return marks
}

/**
 * Current branch, or null outside a repository and on a detached HEAD —
 * `--abbrev-ref` answers the literal "HEAD" there, which is not a branch name and
 * must never reach `git push --set-upstream`.
 */
export function currentBranch(cwd: string): string | null {
  const run = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000)
  if (run.status !== 0) return null
  const branch = run.stdout.trim()
  return branch.length > 0 && branch !== 'HEAD' ? branch : null
}

export interface Branch {
  /** `main` for a local branch, `origin/main` for a remote-tracking one. */
  name: string
  remote: boolean
  current: boolean
  /** Where this local branch pushes and pulls, e.g. `origin/main`. */
  upstream: string | null
}

export type ComparisonFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'

export interface ComparisonRef {
  name: string
  oid: string
}

export interface ComparisonFile {
  path: string
  oldPath: string | null
  status: ComparisonFileStatus
  similarity: number | null
  binary: boolean
  additions: number | null
  deletions: number | null
  oldOid: string | null
  newOid: string | null
}

export interface ComparisonCommit {
  oid: string
  shortOid: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
  parents: string[]
}

export interface ComparisonStats {
  files: number
  additions: number
  deletions: number
  binaryFiles: number
}

export interface BranchComparison {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
  files: ComparisonFile[]
  commits: ComparisonCommit[]
  stats: ComparisonStats
}

export type ComparisonFailure =
  | 'notRepository'
  | 'detachedHead'
  | 'unbornBranch'
  | 'noDefaultBranch'
  | 'invalidBase'
  | 'invalidCompare'
  | 'noMergeBase'
  | 'gitError'
  | 'timeout'

export type ComparisonResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ComparisonFailure; detail: string }

export interface ComparisonIdentity {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
}

export type ComparisonContent =
  | { binary: true }
  | { binary: false; oldText: string; newText: string }

export interface ComparisonCommitDetail {
  commit: ComparisonCommit
  files: ComparisonFile[]
  stats: ComparisonStats
}

/**
 * The local name a remote-tracking branch checks out as: `origin/feat` → `feat`.
 * Both the checkout and the message that reports it derive it the same way, so a
 * remote whose name contains a slash cannot make the two disagree.
 */
export function localBranchName(name: string): string {
  return name.slice(name.indexOf('/') + 1)
}

/**
 * Every branch, most recently committed to first — the order a picker wants,
 * since the branch you are looking for is nearly always one you touched today.
 * Empty outside a repository.
 */
export function listBranches(cwd: string): Branch[] {
  // Tab-separated: every field is a ref name or a single character, none of
  // which can contain a tab.
  const format = ['%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)']
  const run = git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${format.join('\t')}`,
    'refs/heads',
    'refs/remotes',
  ])
  if (run.status !== 0 || !run.stdout) return []

  const branches: Branch[] = []
  for (const line of run.stdout.split('\n')) {
    const [ref, name, head, upstream] = line.split('\t')
    if (!ref || !name) continue
    // `origin/HEAD` is the remote's default-branch pointer, not a branch of its own.
    if (name.endsWith('/HEAD')) continue
    branches.push({
      name,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream || null,
    })
  }
  return branches
}

/**
 * The configured branch a comparison starts from. Remote HEAD is repository
 * evidence; `init.defaultBranch` is useful only when that branch actually
 * exists. Guessing main/master would make the same repository compare
 * differently across machines.
 */
export function defaultBranch(cwd: string): string | null {
  const remotes = git(cwd, ['remote']).stdout?.trim().split('\n').filter(Boolean) ?? []
  for (const remote of remotes.toSorted((a, b) => {
    if (a === 'origin') return -1
    if (b === 'origin') return 1
    return a.localeCompare(b)
  })) {
    const head = git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])
    if (head.status === 0 && head.stdout.trim()) return head.stdout.trim()
  }

  const configured = git(cwd, ['config', '--get', 'init.defaultBranch'])
  const name = configured.status === 0 ? configured.stdout.trim() : ''
  if (!name) return null
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).status === 0
    ? name
    : null
}

function comparisonFailure(reason: ComparisonFailure, detail: string): ComparisonResult<never> {
  return { ok: false, reason, detail }
}

function asyncFailure(run: ProcessResult, fallback: string): ComparisonResult<never> {
  if (run.timedOut) return comparisonFailure('timeout', `${fallback} timed out`)
  if (run.overflow) return comparisonFailure('gitError', `${fallback} produced too much output`)
  return comparisonFailure('gitError', run.stderr.trim() || fallback)
}

/**
 * Resolve the two branch tips and their history relationship before any file
 * metadata is loaded. Explicit OIDs make every later query a stable snapshot
 * even if a ref moves while it is running.
 */
export async function resolveComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
): Promise<ComparisonResult<ComparisonIdentity>> {
  if (!inRepository(cwd)) return comparisonFailure('notRepository', 'Not a git repository')

  let compare = compareName
  if (!compare) {
    const symbolic = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 3000)
    if (symbolic.status !== 0) {
      return comparisonFailure('detachedHead', 'Branch comparison needs a checked-out branch')
    }
    compare = symbolic.stdout.trim()
  }

  const [baseRun, compareRun] = await Promise.all([
    gitAsync(cwd, ['rev-parse', '--verify', `${baseName}^{commit}`]),
    gitAsync(cwd, ['rev-parse', '--verify', `${compare}^{commit}`]),
  ])
  if (compareRun.status !== 0) {
    if (compareRun.timedOut || compareRun.overflow || compareRun.status === null) {
      return asyncFailure(compareRun, `Could not resolve ${compare}`)
    }
    return comparisonFailure(
      compareName ? 'invalidCompare' : 'unbornBranch',
      compareName
        ? `Compare branch "${compare}" does not exist`
        : `Branch "${compare}" has no commits yet`,
    )
  }
  if (baseRun.status !== 0) {
    if (baseRun.timedOut || baseRun.overflow || baseRun.status === null) {
      return asyncFailure(baseRun, `Could not resolve ${baseName}`)
    }
    return comparisonFailure('invalidBase', `Base branch "${baseName}" does not exist`)
  }

  const baseOid = baseRun.stdout.trim()
  const compareOid = compareRun.stdout.trim()
  const mergeBase = await gitAsync(cwd, ['merge-base', baseOid, compareOid])
  if (mergeBase.status !== 0) {
    if (mergeBase.timedOut || mergeBase.overflow || mergeBase.status === null) {
      return asyncFailure(mergeBase, 'Could not find the merge base')
    }
    return comparisonFailure('noMergeBase', 'The branches have no common ancestor')
  }

  const counts = await gitAsync(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    `${baseOid}...${compareOid}`,
  ])
  if (counts.status !== 0) return asyncFailure(counts, 'Could not count branch commits')
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number)

  return {
    ok: true,
    value: {
      base: { name: baseName, oid: baseOid },
      compare: { name: compare, oid: compareOid },
      mergeBase: mergeBase.stdout.trim(),
      ahead,
      behind,
    },
  }
}

const COMPARISON_STATUS: Record<string, ComparisonFileStatus | undefined> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
}

function comparisonKey(oldPath: string | null, path: string): string {
  return `${oldPath ?? ''}\0${path}`
}

function parseCount(value: string): number | null {
  return value === '-' ? null : Number(value)
}

const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P'
const COMMIT_FIELDS = 7

/** `git log -z --format=COMMIT_FORMAT` output: seven NUL-separated fields each. */
function parseCommits(text: string): ComparisonCommit[] | null {
  const fields = text.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % COMMIT_FIELDS !== 0) return null
  const commits: ComparisonCommit[] = []
  for (let at = 0; at < fields.length; at += COMMIT_FIELDS) {
    commits.push({
      oid: fields[at]!,
      shortOid: fields[at + 1]!,
      subject: fields[at + 2]!,
      authorName: fields[at + 3]!,
      authorEmail: fields[at + 4]!,
      authoredAt: fields[at + 5]!,
      parents: fields[at + 6]!.split(' ').filter(Boolean),
    })
  }
  return commits
}

/** git's own name for "nothing", so a root commit needs no special case. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Both halves of `changedFiles` need these, and must agree on them. */
const RENAMES = ['--find-renames', '--find-copies']

interface LineTotals {
  binary: boolean
  additions: number | null
  deletions: number | null
}

/** All-zero is git's "this side does not exist", not an object to read. */
function blobOid(field: string | undefined): string | null {
  return field && !/^0+$/.test(field) ? field : null
}

/**
 * `--numstat -z` totals, keyed by path pair. A record is `adds\tdels\tpath`,
 * except for a rename or a copy, whose path field is empty and whose two paths
 * follow as records of their own. Null if a record is truncated — every parse
 * here refuses partial output rather than dropping a row, because a dropped row
 * would read as "this file did not change".
 */
function parseNumstat(text: string): Map<string, LineTotals> | null {
  const totals = new Map<string, LineTotals>()
  const records = text.split('\0')
  if (records.at(-1) === '') records.pop()
  for (let at = 0; at < records.length; at++) {
    const record = records[at]!
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
    if (secondTab < 0) return null
    const inlinePath = record.slice(secondTab + 1)
    let oldPath: string | null = null
    let path = inlinePath
    if (inlinePath.length === 0) {
      if (at + 2 >= records.length) return null
      oldPath = records[at + 1]!
      path = records[at + 2]!
      at += 2
    }
    const additions = parseCount(record.slice(0, firstTab))
    const deletions = parseCount(record.slice(firstTab + 1, secondTab))
    totals.set(comparisonKey(oldPath, path), {
      // git spends a `-` on each count of a file it will not diff as text.
      binary: additions === null || deletions === null,
      additions,
      deletions,
    })
  }
  return totals
}

type RawFile = Omit<ComparisonFile, keyof LineTotals>

/**
 * `--raw -z` records: `:oldMode newMode oldOid newOid STATUS`, then the path —
 * or two paths when the status is a rename or a copy. `-z` is what keeps a path
 * containing a tab, a newline or a non-ASCII byte intact; the default output
 * C-quotes those, and unquoting them by hand loses the original spelling.
 */
function parseRaw(text: string): RawFile[] | null {
  const files: RawFile[] = []
  const tokens = text.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  for (let at = 0; at < tokens.length; at++) {
    const header = tokens[at]!
    if (!header.startsWith(':')) return null
    const fields = header.slice(1).split(' ')
    const spec = fields[4] ?? ''
    const status = COMPARISON_STATUS[spec[0] ?? '']
    if (!status) return null
    const pathCount = status === 'renamed' || status === 'copied' ? 2 : 1
    if (at + pathCount > tokens.length - 1) return null
    const paths = tokens.slice(at + 1, at + 1 + pathCount)
    at += pathCount
    files.push({
      path: paths.at(-1)!,
      oldPath: pathCount === 2 ? paths[0]! : null,
      status,
      // `R100`, `C75`: how much of the old file the new one still is.
      similarity: spec.length > 1 ? Number(spec.slice(1)) : null,
      oldOid: blobOid(fields[2]),
      newOid: blobOid(fields[3]),
    })
  }
  return files
}

/**
 * The files that differ between two commit-ish, with their line totals. Two
 * passes because no single git command carries both: `--raw` has the status,
 * the paths and the blob OIDs a lazy diff needs, `--numstat` has the counts.
 * Both are given the same rename flags, so they agree on which pairs exist.
 */
async function changedFiles(
  cwd: string,
  from: string,
  to: string,
): Promise<ComparisonResult<{ files: ComparisonFile[]; stats: ComparisonStats }>> {
  const [rawRun, numstatRun] = await Promise.all([
    gitAsync(cwd, ['diff', '--raw', '-z', '--abbrev=64', ...RENAMES, from, to]),
    gitAsync(cwd, ['diff', '--numstat', '-z', ...RENAMES, from, to]),
  ])
  if (rawRun.status !== 0) return asyncFailure(rawRun, 'Could not read changed files')
  if (numstatRun.status !== 0) return asyncFailure(numstatRun, 'Could not read line totals')

  const raw = parseRaw(rawRun.stdout)
  const totals = parseNumstat(numstatRun.stdout)
  if (!raw || !totals) {
    return comparisonFailure('gitError', 'Git returned incomplete comparison metadata')
  }

  const files: ComparisonFile[] = []
  const stats: ComparisonStats = { files: 0, additions: 0, deletions: 0, binaryFiles: 0 }
  for (const file of raw) {
    const total = totals.get(comparisonKey(file.oldPath, file.path))
    if (!total) return comparisonFailure('gitError', `Git reported no line totals for ${file.path}`)
    files.push({ ...file, ...total })
    stats.files++
    if (total.binary) stats.binaryFiles++
    else {
      stats.additions += total.additions ?? 0
      stats.deletions += total.deletions ?? 0
    }
  }
  return {
    ok: true,
    value: { files: files.toSorted((a, b) => a.path.localeCompare(b.path)), stats },
  }
}

/**
 * A resolved comparison's files and commits. Contents stay unread: the OIDs in
 * `identity` make this a snapshot, so a blob can be fetched when its row is
 * opened without the list underneath having moved.
 */
export async function loadResolvedComparison(
  cwd: string,
  identity: ComparisonIdentity,
): Promise<ComparisonResult<BranchComparison>> {
  // `mergeBase..compare` for the files and `base..compare` for the commits: both
  // leave out what only the base has, which is what makes this the branch's own
  // work rather than a tip-to-tip diff.
  const [changed, logRun] = await Promise.all([
    changedFiles(cwd, identity.mergeBase, identity.compare.oid),
    gitAsync(cwd, [
      'log',
      '-z',
      `--format=${COMMIT_FORMAT}`,
      `${identity.base.oid}..${identity.compare.oid}`,
    ]),
  ])
  if (!changed.ok) return changed
  if (logRun.status !== 0) return asyncFailure(logRun, 'Could not read comparison commits')
  const commits = parseCommits(logRun.stdout)
  if (!commits) return comparisonFailure('gitError', 'Git returned incomplete commit metadata')
  return { ok: true, value: { ...identity, ...changed.value, commits } }
}

export async function loadBranchComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
): Promise<ComparisonResult<BranchComparison>> {
  const identity = await resolveComparison(cwd, baseName, compareName)
  return identity.ok ? loadResolvedComparison(cwd, identity.value) : identity
}

/** The two textual sides of one comparison row, fetched only when it is opened. */
export async function comparisonFileContent(
  cwd: string,
  file: ComparisonFile,
): Promise<ComparisonResult<ComparisonContent>> {
  if (file.binary) return { ok: true, value: { binary: true } }

  const read = (oid: string | null) =>
    oid ? gitAsync(cwd, ['cat-file', 'blob', oid]) : Promise.resolve<ProcessResult | null>(null)
  const [oldRun, newRun] = await Promise.all([read(file.oldOid), read(file.newOid)])
  if (oldRun && oldRun.status !== 0) return asyncFailure(oldRun, `Could not read ${file.oldPath}`)
  if (newRun && newRun.status !== 0) return asyncFailure(newRun, `Could not read ${file.path}`)
  return {
    ok: true,
    value: { binary: false, oldText: oldRun?.stdout ?? '', newText: newRun?.stdout ?? '' },
  }
}

/** Metadata and first-parent file changes for one commit. */
export async function comparisonCommitDetail(
  cwd: string,
  oid: string,
): Promise<ComparisonResult<ComparisonCommitDetail>> {
  const metadata = await gitAsync(cwd, ['log', '-1', '-z', `--format=${COMMIT_FORMAT}`, oid])
  if (metadata.status !== 0) return asyncFailure(metadata, 'Could not read commit metadata')
  const commits = parseCommits(metadata.stdout)
  const commit = commits?.length === 1 ? commits[0]! : null
  if (!commit) return comparisonFailure('invalidCompare', `Commit "${oid}" does not exist`)

  // First parent for a merge, as `git show` reads one — a combined diff is not
  // something the diff renderer can draw. The empty tree stands in for the
  // parent a root commit does not have.
  const changed = await changedFiles(cwd, commit.parents[0] ?? EMPTY_TREE, commit.oid)
  return changed.ok ? { ok: true, value: { commit, ...changed.value } } : changed
}

const STATUS_BY_CODE: Record<string, FileStatus> = {
  '?': 'untracked',
  'A': 'added',
  'M': 'modified',
  'R': 'modified',
  'C': 'modified',
  'U': 'modified',
  // Typechange — a file became a symlink or back. Without this row the entry
  // parses to neither side and the file vanishes from the panel entirely.
  'T': 'modified',
  'D': 'deleted',
}

/**
 * Directory git-relative paths are joined onto. git reports the resolved root
 * (/private/var/…), while the tree holds the path the user opened (/var/…) —
 * so the caller's form wins when the two are the same place.
 */
function sameOrRoot(cwd: string, root: string): string {
  try {
    if (realpathSync(cwd) === realpathSync(root)) return cwd
  } catch {
    // unreadable path: fall back to git's own root
  }
  return root
}

/** `sameOrRoot` for the directory itself. Null outside a repository. */
function keyBase(cwd: string): string | null {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], 3000)
  return top.status === 0 ? sameOrRoot(cwd, top.stdout.trim()) : null
}

/*
 * The three parsers below are shared by the synchronous and asynchronous
 * spellings of `statusMap`. Both have to answer identically: the tree marks come
 * from one and the commit picker from the other, and a file the two disagree
 * about is a row you cannot commit.
 */

const STATUS_ARGS = ['status', '--porcelain', '-z', '-uall']
const UNTRACKED_ARGS = ['ls-files', '--others', '--exclude-standard', '-z']

export interface PorcelainEntry {
  /** The index and working-tree columns exactly as git reported them. */
  readonly xy: string
  /** Repository-relative destination path, never an absolute path. */
  readonly path: string
  /** Repository-relative source of a rename or copy. */
  readonly source: string | null
}

export type DiscardMode = 'restore' | 'delete'

export interface DiscardTarget {
  readonly repo: string
  readonly path: string
  /** Absolute working-tree paths changed when this row is discarded. */
  readonly affectedPaths: readonly string[]
  readonly mode: DiscardMode
  /** The status row approved by the user, retained so execution can reject drift. */
  readonly entry: PorcelainEntry
  /** Identity of HEAD, the index entry, and the working-tree change at confirmation time. */
  readonly fingerprint: string
}

/** Parse porcelain without throwing away either status column or rename/copy source. */
function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  const parsed: PorcelainEntry[] = []
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    const source = xy[0] === 'R' || xy[0] === 'C' ? (entries[++i] ?? null) : null
    parsed.push({ xy, path: entry.slice(3), source })
  }
  return parsed
}

function porcelainEntries(cwd: string): PorcelainEntry[] {
  const run = git(cwd, STATUS_ARGS)
  return run.status === 0 ? parsePorcelainEntries(run.stdout) : []
}

function pathInHead(repo: string, path: string): boolean {
  return git(repo, ['cat-file', '-e', `HEAD:./${path}`], 3000).status === 0
}

/**
 * A path after `--` is a pathspec, where `[`, `*` and `?` are glob metacharacters:
 * `git clean -f -- '[id].tsx'` deletes `i.tsx` too, and the route files every
 * Next.js and SvelteKit project is full of are named exactly that. Every path
 * here came from porcelain and means itself alone.
 */
const literal = (path: string) => `:(literal)${path}`

function discardMode(repo: string, entry: PorcelainEntry): DiscardMode {
  if (entry.xy[0] === 'R') return 'restore'
  if (entry.xy[0] === 'C' || entry.xy === '??') return 'delete'
  return pathInHead(repo, entry.path) ? 'restore' : 'delete'
}

/** Hash every part of the selected change whose replacement the user is approving. */
function discardFingerprint(repo: string, entry: PorcelainEntry): string | null {
  const paths = entry.source ? [entry.path, entry.source] : [entry.path]
  const head = git(repo, ['rev-parse', '--verify', 'HEAD'])
  const index = git(repo, ['ls-files', '--stage', '-z', '--', ...paths.map(literal)])
  const worktree = git(repo, [
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    '--no-textconv',
    '--',
    ...paths.map(literal),
  ])
  if (index.status !== 0 || worktree.status !== 0) return null

  let untracked = ''
  if (entry.xy === '??') {
    const content = git(repo, ['hash-object', '--no-filters', '--', entry.path])
    if (content.status !== 0) return null
    untracked = content.stdout
  }

  return createHash('sha256')
    .update(head.status === 0 ? head.stdout : 'unborn')
    .update('\0')
    .update(index.stdout)
    .update('\0')
    .update(worktree.stdout)
    .update('\0')
    .update(untracked)
    .digest('hex')
}

/** Pin the exact row and repository a discard confirmation is about. */
export function discardTarget(repo: string, path: string): DiscardTarget | null {
  const base = keyBase(repo)
  if (base === null) return null
  const rel = relative(base, path)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null
  const gitPath = rel.split(sep).join('/')
  const entry = porcelainEntries(repo).find(candidate => candidate.path === gitPath)
  if (!entry) return null
  const fingerprint = discardFingerprint(repo, entry)
  if (fingerprint === null) return null
  const affectedPaths = Object.freeze(
    entry.xy[0] === 'R' && entry.source ? [path, join(base, entry.source)] : [path],
  )
  return Object.freeze({
    repo,
    path,
    affectedPaths,
    mode: discardMode(repo, entry),
    entry: Object.freeze(entry),
    fingerprint,
  })
}

/**
 * `git status --porcelain -z -uall`. `-z` because the default output C-quotes and
 * octal-escapes any path that is not plain ASCII; unquoting that by hand loses
 * every accented or spaced name. `-uall`, or a brand-new directory collapses to a
 * single `?? newdir/` entry and every file inside it shows no mark at all.
 */
/** Porcelain's unmerged states — a `U` in either column, plus both-added/-deleted. */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function parsePorcelain(stdout: string, base: string): Map<string, StatusEntry> {
  const statuses = new Map<string, StatusEntry>()
  for (const entry of parsePorcelainEntries(stdout)) {
    // An unmerged path is neither staged nor unstaged — it is a question the
    // merge asked, and `git add` (the panel's Space) is what answers it.
    if (CONFLICT_CODES.has(entry.xy)) {
      statuses.set(join(base, entry.path), { staged: null, unstaged: 'modified', conflicted: true })
      continue
    }
    // `??` is one code across both columns, not an index state: an untracked
    // file is nothing the index has heard of, so it is unstaged and only that.
    const untracked = entry.xy === '??'
    const staged = untracked ? null : (STATUS_BY_CODE[entry.xy[0]!] ?? null)
    const unstaged = untracked ? 'untracked' : (STATUS_BY_CODE[entry.xy[1]!] ?? null)
    if (staged || unstaged) statuses.set(join(base, entry.path), { staged, unstaged })
  }
  return statuses
}

/** Every path with a change, whichever column it is in. */
function flatten(entries: Map<string, StatusEntry>): Map<string, FileStatus> {
  return new Map([...entries].map(([path, entry]) => [path, combinedStatus(entry)]))
}

/** A diff against a ref knows nothing of the index — every change is a change. */
function asUnstaged(statuses: Map<string, FileStatus>): Map<string, StatusEntry> {
  return new Map([...statuses].map(([path, status]) => [path, { staged: null, unstaged: status }]))
}

/**
 * `git diff --name-status -z`. `-z` drops the tab between the code and the path
 * as well, so the fields arrive as a flat alternating list rather than one
 * record per entry.
 */
function parseNameStatus(stdout: string, base: string): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  const fields = stdout.split('\0')
  for (let i = 0; i < fields.length; i += 2) {
    const code = fields[i]
    if (!code) continue
    // A rename or copy spends a field on each path; the new one is what exists
    // on disk, and skipping ahead keeps the codes on the even indices.
    if (code[0] === 'R' || code[0] === 'C') i++
    const path = fields[i + 1]
    const status = STATUS_BY_CODE[code[0]!]
    if (status && path) statuses.set(join(base, path), status)
  }
  return statuses
}

function addUntracked(stdout: string, base: string, into: Map<string, FileStatus>) {
  for (const rel of stdout.split('\0')) {
    if (rel.length > 0) into.set(join(base, rel), 'untracked')
  }
}

/**
 * Working-tree status per absolute path. Staged and unstaged changes collapse to
 * one mark — the tree only needs "this differs from HEAD", or from `ref` when
 * the user has pointed the whole editor at another branch.
 *
 * Against a ref this takes two queries rather than one: `git status` can only
 * ever compare against HEAD, so the tracked files come from a diff and the
 * untracked ones — which differ from every ref, and which the diff never
 * mentions — from `ls-files`.
 */
export function statusMap(cwd: string, ref: string | null = null): Map<string, FileStatus> {
  return flatten(statusEntries(cwd, ref))
}

/**
 * The same status, both columns kept apart — what the source-control panel's
 * Staged/Changes headings are built from.
 *
 * Against a ref there is nothing staged to report: the index is always the
 * index of HEAD, so a comparison base's changes are all unstaged and the panel
 * draws one list, which is what it did before staging existed.
 */
export function statusEntries(cwd: string, ref: string | null = null): Map<string, StatusEntry> {
  const base = keyBase(cwd)
  if (base === null) return new Map()
  if (ref === null) {
    const run = git(cwd, STATUS_ARGS)
    return run.status === 0 ? parsePorcelain(run.stdout, base) : new Map()
  }

  const diff = git(cwd, ['diff', '--name-status', '-z', ref])
  if (diff.status !== 0) return new Map()
  const statuses = parseNameStatus(diff.stdout, base)
  const others = git(cwd, UNTRACKED_ARGS)
  if (others.status === 0) addUntracked(others.stdout, base, statuses)
  return asUnstaged(statuses)
}

/**
 * `statusEntries` off the render thread. The multi-repository refresh runs one of
 * these per repository at once: a folder holding twenty checkouts is forty
 * subprocesses, which synchronously would be a visible freeze on every save and
 * every filesystem event, and in parallel costs about what the slowest one does.
 */
export async function statusEntriesAsync(
  cwd: string,
  ref: string | null = null,
): Promise<Map<string, StatusEntry>> {
  const top = await gitAsync(cwd, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return new Map()
  const base = sameOrRoot(cwd, top.stdout.trim())
  if (ref === null) {
    const run = await gitAsync(cwd, STATUS_ARGS)
    return run.status === 0 ? parsePorcelain(run.stdout, base) : new Map()
  }

  const [diff, others] = await Promise.all([
    gitAsync(cwd, ['diff', '--name-status', '-z', ref]),
    gitAsync(cwd, UNTRACKED_ARGS),
  ])
  if (diff.status !== 0) return new Map()
  const statuses = parseNameStatus(diff.stdout, base)
  if (others.status === 0) addUntracked(others.stdout, base, statuses)
  return asUnstaged(statuses)
}

/**
 * Which of `paths` gitignore would skip. Empty outside a repository.
 *
 * The companion to `ignoredPaths`, and not a duplicate of it: that one answers
 * "what may the tree hide", which needs no key for anything inside a collapsed
 * directory. This one answers "what does the tree draw dim", which is asked about
 * rows that are on screen *because* nothing is hidden — including the children of
 * an expanded `node_modules`, which `--directory` deliberately never enumerates.
 * Asking per visible path bounds the work by the sidebar's height either way.
 *
 * Paths come back in the same spelling they went in: we feed absolute tree paths
 * on stdin and get those absolutes out, so there is no `keyBase` remapping the
 * way `statusMap` needs for porcelain's repo-relative names — and no `keyBase`
 * call either, which would double the subprocesses this costs per refresh.
 */
export function ignoredAmong(cwd: string, paths: string[]): Set<string> {
  const ignored = new Set<string>()
  if (paths.length === 0) return ignored

  // git aborts the whole batch with 128 at the first path that reaches through a
  // symlinked directory ("is beyond a symbolic link") — expanding pnpm's
  // node_modules/@scope/pkg is enough — so those paths are never asked about.
  // One of them in the list used to blank the answer for every other row.
  //
  // The cache lives for this call alone: a directory can be swapped for a symlink
  // while druk is open, and the tree refresh this rides on is where that shows up.
  const symlinkDirs = new Map<string, boolean>()
  const askable: string[] = []
  const unanswerable: string[] = []
  for (const path of paths) {
    ;(beyondSymlink(cwd, path, symlinkDirs) ? unanswerable : askable).push(path)
  }

  // `-z` + `--stdin`: one NUL-terminated path each way. Exit 1 means none of the
  // paths are ignored, and 128 means there is no repository here — both are an
  // empty set rather than a failure, so only 0 has output worth reading.
  const run = git(cwd, ['check-ignore', '--stdin', '-z'], 5000, `${askable.join('\0')}\0`)
  if (run.status === 0) {
    for (const path of run.stdout.split('\0')) {
      if (path.length > 0) ignored.add(path)
    }
  }

  // An ignored directory takes everything under it, which is the only answer left
  // for the rows git refused. Applied to those alone: a force-added file under an
  // ignored directory is not ignored, and git is the one who knows which.
  for (const path of unanswerable) {
    if (hasIgnoredAncestor(cwd, path, ignored)) ignored.add(path)
  }
  return ignored
}

/** Whether any directory between `cwd` and `path` is a symlink. */
function beyondSymlink(cwd: string, path: string, cache: Map<string, boolean>): boolean {
  if (!path.startsWith(`${cwd}/`)) return false
  for (let dir = dirname(path); dir.length > cwd.length; dir = dirname(dir)) {
    let symlink = cache.get(dir)
    if (symlink === undefined) {
      try {
        symlink = lstatSync(dir).isSymbolicLink()
      } catch {
        symlink = false
      }
      cache.set(dir, symlink)
    }
    if (symlink) return true
  }
  return false
}

function hasIgnoredAncestor(cwd: string, path: string, ignored: Set<string>): boolean {
  if (!path.startsWith(`${cwd}/`)) return false
  for (let dir = dirname(path); dir.length > cwd.length; dir = dirname(dir)) {
    if (ignored.has(dir)) return true
  }
  return false
}

/**
 * The file's content at `ref`, or null when `ref` has no such file (untracked,
 * added, unborn branch, outside a repository). `cwd` anchors the lookup — the
 * `./` spelling makes the path cwd-relative, so a deleted file still resolves
 * even though it no longer exists on disk.
 */
export function refText(cwd: string, relPath: string, ref = 'HEAD'): string | null {
  const run = git(cwd, ['show', `${ref}:./${relPath}`], 3000)
  // Normalized like every other text druk reads: the working-tree side of a diff
  // comes from an open buffer, which is always LF, so a blob committed with CRLF
  // would otherwise diff as every line changed.
  return run.status === 0 ? decodeText(run.stdout).text : null
}

/**
 * The staged copy of a path — the index's own blob, which is neither HEAD's nor
 * the working tree's while a file is half-staged. `git show :./x` is how the
 * index is addressed; there is no ref name for it.
 */
export function indexText(cwd: string, relPath: string): string | null {
  const run = git(cwd, ['show', `:./${relPath}`], 3000)
  return run.status === 0 ? decodeText(run.stdout).text : null
}

export interface Upstream {
  /** `origin/main`, or null when the branch was never pushed. */
  name: string | null
  /** Commits here but not on the remote, and the other way round. */
  ahead: number
  behind: number
}

/**
 * Where a push would go and how far apart the two sides are. Two subprocesses at
 * worst, one outside a repository — the status bar asks for this often enough
 * that a `currentBranch` call on top of them is worth avoiding.
 */
export function upstreamOf(cwd: string): Upstream | null {
  const ref = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (ref.status !== 0) {
    // No upstream and no repository look the same here; the branch tells them apart.
    // Ahead/behind stay 0: with nothing to compare against there is no distance to
    // report, and a repo with no remote at all must not show a phantom ↑.
    return currentBranch(cwd) ? { name: null, ahead: 0, behind: 0 } : null
  }

  // Status checked, and NaN floored: a failed count would otherwise put "NaN↓"
  // on the status bar — `[''].map(Number)` is `[NaN]`, which `?? 0` keeps.
  const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  const [behind, ahead] = counts.status === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : []
  return { name: ref.stdout.trim(), ahead: ahead || 0, behind: behind || 0 }
}

/** How many commits either sync section lists — the header carries the true counts. */
const SYNC_LOG_CAP = 50

/**
 * The commits between the branch and its upstream, one direction at a time —
 * what the panel's Incoming/Outgoing sections list. Empty with no upstream to
 * measure against, and capped: a branch hundreds of commits adrift is a wall of
 * rows the header's counts already summarise.
 */
export function upstreamCommits(
  cwd: string,
  direction: 'incoming' | 'outgoing',
): { oid: string; subject: string }[] {
  const range = direction === 'incoming' ? 'HEAD..@{upstream}' : '@{upstream}..HEAD'
  const run = git(cwd, ['log', '-n', String(SYNC_LOG_CAP), '--format=%H %s', range], 5000)
  if (run.status !== 0) return []
  return run.stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const split = line.indexOf(' ')
      return split < 0
        ? { oid: line, subject: '' }
        : { oid: line.slice(0, split), subject: line.slice(split + 1) }
    })
}

export function inRepository(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-inside-work-tree'], 3000).stdout?.trim() === 'true'
}

/**
 * Absolute paths staged in the index, keyed like `statusMap` so the two can be
 * compared. On an unborn branch git diffs the index against the empty tree, so
 * a fresh repository with staged files still reports correctly.
 */
export function stagedPaths(cwd: string): Set<string> {
  const staged = new Set<string>()
  const base = keyBase(cwd)
  if (base === null) return staged
  // `-z` for the same reason as `statusMap`: quoted paths would never match its keys.
  const run = git(cwd, ['diff', '--cached', '--name-only', '-z'])
  if (run.status !== 0) return staged
  for (const rel of run.stdout.split('\0')) {
    if (rel.length > 0) staged.add(join(base, rel))
  }
  return staged
}

/**
 * Absolute paths of git-ignored entries, keyed like `statusMap`. Empty outside a
 * repository — with no `.gitignore` semantics to apply, nothing is ignored.
 *
 * `--directory` collapses a fully-ignored directory to one entry instead of
 * enumerating everything inside it — the difference between one line for
 * `node_modules` and a hundred thousand. The tree matches these keys exactly:
 * it hides an ignored directory at its top and never descends, so the collapsed
 * entry is the only key it ever asks about. Dimming cannot use these keys for
 * exactly that reason — see `ignoredAmong`.
 *
 * Keyed off `cwd`, not `keyBase`: `ls-files` names paths relative to the
 * directory it runs in, unlike porcelain's repo-relative ones, and it lists
 * nothing outside that directory either. A druk opened on a subdirectory of a
 * repository would otherwise key every entry under the repository root.
 */
export function ignoredPaths(cwd: string): Set<string> {
  const ignored = new Set<string>()
  // `-z` for the same reason as `statusMap`: quoted paths would never match its keys.
  const run = git(cwd, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ])
  if (run.status !== 0) return ignored
  for (const rel of run.stdout.split('\0')) {
    if (rel.length === 0) continue
    // A collapsed directory keeps git's trailing separator; the tree's paths have none.
    ignored.add(join(cwd, rel.endsWith('/') ? rel.slice(0, -1) : rel))
  }
  return ignored
}

/** Subject of HEAD, or null with no commits yet — what "undo last commit" names. */
export function lastCommitSubject(cwd: string): string | null {
  const run = git(cwd, ['log', '-1', '--format=%s'], 3000)
  if (run.status !== 0) return null
  const subject = run.stdout.trim()
  return subject.length > 0 ? subject : null
}

export interface GitResult {
  ok: boolean
  /** One status-bar line: the first thing git said worth repeating. */
  detail: string
}

/** Long enough for a slow push; nothing druk runs should legitimately outlast it. */
const MUTATE_TIMEOUT = 60_000

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function firstLine(text: string): string {
  return lines(text)[0] ?? ''
}

/** Advice and progress chatter git emits around the one line that says what broke. */
const NOISE = /^(?:hint|warning|note):|^To\s|^remote:\s*$/i

/**
 * What the status bar shows when git fails. Git puts its advice *before* the
 * cause, so the first line is usually the wrong one: a rejected pull opens with
 * a dozen `hint:` lines and only ends with the `fatal:` that names the problem.
 * Prefer that line, fall back to whatever survives the noise filter, and strip
 * the severity prefix — the bar already colours the message as an error.
 */
export function failureLine(text: string): string {
  const all = lines(text)
  const signal = all.filter(line => !NOISE.test(line))
  const chosen = signal.find(line => line.startsWith('fatal:')) ?? signal[0] ?? all[0] ?? ''
  return chosen.replace(/^(?:fatal|error):\s*/, '')
}

/**
 * The one failure druk offers to fix rather than report: `gitPush` recognises it
 * by this exact string, so the row in KNOWN below has to keep using the constant.
 */
export const PUSH_REJECTED = "origin has commits you don't — pull first, then push"

/**
 * Failures worth naming, in the terms of what to do next. Git's own wording
 * assumes a shell where the fix is one command away, and druk runs a fixed set
 * of commands with no shell to offer — so each of these says what happened and
 * where the fix lives, pointing at druk's own commands where it has one.
 *
 * Matched against git's whole output, not the chosen line: the reason and the
 * command that failed routinely sit on different lines. First match wins, so
 * the specific patterns have to stay above the general ones — "Authentication
 * failed" would otherwise swallow the missing-credentials case below it.
 */
export const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  // druk pulls with --ff-only; a real merge needs an editor and a conflict UI.
  [
    /Not possible to fast-forward|Need to specify how to reconcile/i,
    'Branch and origin have both moved on — merge or rebase in a terminal',
  ],
  [/\[rejected\].*(?:non-fast-forward|fetch first)/i, PUSH_REJECTED],
  [
    /local changes to the following files would be overwritten/i,
    'Commit or stash your changes first — this would overwrite them',
  ],
  // Above the general conflict row, and matching both halves of the output: a
  // stash pop that conflicts keeps the entry, and saying so is the difference
  // between a scare and a fact. A conflict with no stash line is a merge.
  [
    /(?:^CONFLICT|Merge conflict in)[\s\S]*stash entry is kept/im,
    'Conflicts in the working tree — the stash was kept, resolve them first',
  ],
  [
    /^CONFLICT|Merge conflict in/im,
    'Conflicts in the working tree — resolve them, then commit the merge',
  ],
  [
    /unmerged files|needs merge|unresolved conflict/i,
    'Resolve the merge conflicts in your working tree first',
  ],
  [/nothing to commit|no changes added to commit/i, 'Nothing to commit'],
  [/branch named '.*' already exists/i, 'A branch of that name already exists'],
  // Short on purpose: the status bar is one line wide, and a longer sentence is
  // cut off exactly where it would have said what to do instead.
  [/is not fully merged/i, 'Branch has unmerged commits — a force delete discards them'],
  [
    /Cannot delete branch .* checked out/i,
    'That is the branch you are on — switch to another one first',
  ],
  [/is not a valid branch name/i, 'Not a valid branch name'],
  // Undo is `reset --soft HEAD~1`, so a root commit has nothing to reset to.
  [/ambiguous argument 'HEAD~1'/i, 'Nothing to undo — this is the only commit'],
  [/No stash entries found/i, 'No stash to pop'],
  [
    /No configured push destination|does not appear to be a git repository/i,
    "No remote — add an 'origin' in a terminal",
  ],
  [
    /Could not resolve host|unable to access.*(?:Couldn't connect|Connection refused|Operation timed out)/i,
    "Can't reach the remote — check your network",
  ],
  // Ours: GIT_TERMINAL_PROMPT=0 turns git's credential prompt into this.
  [
    /terminal prompts disabled|could not read (?:Username|Password)/i,
    "No stored credentials for the remote — druk can't prompt for them",
  ],
  [/Permission denied \(publickey\)/i, 'The remote rejected your SSH key'],
  [
    /Authentication failed|Invalid username or password|Access denied/i,
    'Authentication failed — check your credentials for the remote',
  ],
  [
    /(?:repository|Repository) .*not found|remote: Not Found/i,
    "Remote repository not found — check the 'origin' URL",
  ],
  [
    /index\.lock.*File exists|Another git process seems to be running/i,
    'Another git process is running in this repository — let it finish',
  ],
]

/**
 * A known failure named in druk's terms, or git's own most useful line.
 *
 * Both streams are matched, because git routinely splits one failure across the
 * two: a stash pop onto an unmerged index puts `error: could not write index` on
 * stderr and the `f.txt: needs merge` that actually explains it on stdout. Only
 * the fallback keeps to one stream, where stderr is the better guess.
 */
export function explain(stderr: string, stdout = ''): string {
  const both = `${stderr}\n${stdout}`
  for (const [pattern, message] of KNOWN) {
    if (pattern.test(both)) return message
  }
  return failureLine(stderr || stdout)
}

async function mutate(cwd: string, args: string[]): Promise<GitResult> {
  const result = await runProcess('git', args, {
    cwd,
    // Without this an https remote with no cached credential makes git *prompt*
    // on the terminal druk owns — an invisible question the TUI hangs behind.
    // Failing fast turns it into a status-bar error instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: MUTATE_TIMEOUT,
  })
  if (result.error) {
    // The one failure with no git output to explain: there is no git.
    const detail = notInstalled(result)
      ? 'git is not installed, or not on PATH'
      : result.error.message
    return { ok: false, detail }
  }
  // Success chatter (push progress, fetch summaries) arrives on stderr too,
  // so on failure stderr is the answer and on success either will do.
  if (result.status === 0) return { ok: true, detail: firstLine(result.stdout || result.stderr) }
  // A killed process leaves whatever it had already written, which for a
  // hung fetch is nothing at all — say why it stopped instead of going blank.
  const detail = result.timedOut
    ? `Timed out after ${MUTATE_TIMEOUT / 1000}s and was stopped`
    : explain(result.stderr, result.stdout)
  return { ok: false, detail }
}

const sameEntry = (before: PorcelainEntry, after: PorcelainEntry) =>
  before.xy === after.xy && before.path === after.path && before.source === after.source

/**
 * Discard one pinned porcelain row without disturbing any other index or
 * working-tree entry. The row is read again at the last possible moment: a
 * confirmation left open while git changes must never execute against the new
 * meaning of the same path.
 */
export async function discardChange(target: DiscardTarget): Promise<GitResult> {
  const current = porcelainEntries(target.repo).find(entry => entry.path === target.entry.path)
  if (!current) return { ok: false, detail: 'That change is gone — refresh and try again' }
  const mode = discardMode(target.repo, current)
  if (mode !== target.mode) {
    return { ok: false, detail: 'That change changed how it would be discarded — try again' }
  }
  if (!sameEntry(target.entry, current)) {
    return { ok: false, detail: 'That change changed while the confirmation was open — try again' }
  }
  if (discardFingerprint(target.repo, current) !== target.fingerprint) {
    return { ok: false, detail: 'That change changed while the confirmation was open — try again' }
  }

  if (current.xy[0] === 'R' && current.source) {
    const paths = [literal(current.source), literal(current.path)]
    const reset = await mutate(target.repo, ['reset', '-q', '--', ...paths])
    if (!reset.ok) return reset
    const restore = await mutate(target.repo, [
      'checkout',
      '-q',
      'HEAD',
      '--',
      literal(current.source),
    ])
    if (!restore.ok) return restore
    return mutate(target.repo, ['clean', '-q', '-f', '--', literal(current.path)])
  }

  if (target.mode === 'delete') {
    if (current.xy !== '??') {
      const unstage = await mutate(target.repo, [
        'rm',
        '-q',
        '--cached',
        '-f',
        '--',
        literal(current.path),
      ])
      if (!unstage.ok) return unstage
    }
    return mutate(target.repo, ['clean', '-q', '-f', '--', literal(current.path)])
  }

  const inHead = pathInHead(target.repo, current.path)
  if (inHead) return mutate(target.repo, ['checkout', '-q', 'HEAD', '--', literal(current.path)])
  const reset = await mutate(target.repo, ['reset', '-q', 'HEAD', '--', literal(current.path)])
  if (!reset.ok) return reset
  return mutate(target.repo, ['clean', '-q', '-f', '--', literal(current.path)])
}

/**
 * Put `paths` in the index. `-A` rather than a plain add: it is what records a
 * deletion, and a folder row hands this the folder, whose files may include one.
 */
export function stagePaths(cwd: string, paths: readonly string[]): Promise<GitResult> {
  return mutate(cwd, ['add', '-A', '--', ...paths.map(literal)])
}

/**
 * Take `paths` back out of the index, leaving the working tree alone.
 *
 * `restore --staged` needs something to restore *from*, and on an unborn branch
 * there is no HEAD to name — every staged file there is a fresh add, so removing
 * the index entry is the whole of unstaging it.
 */
export function unstagePaths(cwd: string, paths: readonly string[]): Promise<GitResult> {
  const spec = paths.map(literal)
  return hasCommits(cwd)
    ? mutate(cwd, ['restore', '--staged', '--', ...spec])
    : mutate(cwd, ['rm', '-q', '--cached', '-r', '--', ...spec])
}

/** Whether HEAD names a commit — false on a repository with nothing committed yet. */
function hasCommits(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], 3000).status === 0
}

/** Commit whatever is in the index, as `git commit` with no pathspec does. */
export function commitStaged(cwd: string, message: string): Promise<GitResult> {
  return mutate(cwd, ['commit', '-m', message])
}

/** Stage and commit exactly `paths`; anything staged for other paths stays staged. */
export async function commitPaths(
  cwd: string,
  message: string,
  paths: string[],
): Promise<GitResult> {
  // -A scoped to the paths: it is what stages a deletion or an untracked file.
  const add = await mutate(cwd, ['add', '-A', '--', ...paths])
  if (!add.ok) return add
  return mutate(cwd, ['commit', '-m', message, '--', ...paths])
}

/**
 * Rewrite the last commit with whatever the index holds now. The message is
 * always given: amending is offered with the old subject prefilled, so an
 * "unchanged" message is the user handing the same words back, not a case to
 * special-case with `--no-edit`.
 */
export function commitAmend(cwd: string, message: string): Promise<GitResult> {
  return mutate(cwd, ['commit', '--amend', '-m', message])
}

/** Soft reset: the commit is gone, its changes stay staged. */
export function undoLastCommit(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['reset', '--soft', 'HEAD~1'])
}

export function stashPush(cwd: string): Promise<GitResult> {
  // -u: "stash my changes" from an editor includes the files just created.
  return mutate(cwd, ['stash', 'push', '-u'])
}

export function stashPop(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['stash', 'pop'])
}

export function push(cwd: string, branch: string, hasUpstream: boolean): Promise<GitResult> {
  return mutate(cwd, hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch])
}

/**
 * The fix for a rejected push, as one operation.
 *
 * Deliberately not `pull()`: a push is rejected precisely when the two sides
 * have diverged, which is the one case `--ff-only` refuses, so the merge is the
 * whole point of this. `--no-edit` keeps git from opening an editor druk cannot
 * host, and a conflicted merge stops here with git's own reason — the working
 * tree is left mid-merge, as it is after "Merge branch", and the push never runs.
 */
export async function pullAndPush(
  cwd: string,
  branch: string,
  hasUpstream: boolean,
): Promise<GitResult> {
  const pulled = await mutate(cwd, ['pull', '--no-rebase', '--no-edit'])
  if (!pulled.ok) return pulled
  return push(cwd, branch, hasUpstream)
}

export function fetchRemote(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['fetch'])
}

export function pull(cwd: string): Promise<GitResult> {
  // --ff-only: a real merge wants an editor and a conflict UI druk does not have.
  return mutate(cwd, ['pull', '--ff-only'])
}

/** Create `name` off `from` (HEAD when null) and switch to it. */
export function createBranch(cwd: string, name: string, from: string | null): Promise<GitResult> {
  return mutate(cwd, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name])
}

/**
 * Switch to `name`. A remote-tracking ref is not something to be on — checking
 * one out directly only detaches HEAD — so the first switch to `origin/x`
 * creates the local `x` that tracks it, and later ones move to that branch.
 */
export function switchBranch(cwd: string, name: string, remote: boolean): Promise<GitResult> {
  if (!remote) return mutate(cwd, ['checkout', name])
  const local = localBranchName(name)
  const exists = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], 3000)
  return exists.status === 0
    ? mutate(cwd, ['checkout', local])
    : mutate(cwd, ['checkout', '-b', local, '--track', name])
}

export function renameBranch(cwd: string, from: string, to: string): Promise<GitResult> {
  return mutate(cwd, ['branch', '-m', from, to])
}

/** Delete a local branch. Without `force`, git refuses one that is not merged. */
export function deleteBranch(cwd: string, name: string, force: boolean): Promise<GitResult> {
  return mutate(cwd, ['branch', force ? '-D' : '-d', name])
}

export function mergeBranch(cwd: string, name: string): Promise<GitResult> {
  // --no-edit: a merge commit otherwise opens an editor druk cannot show.
  return mutate(cwd, ['merge', '--no-edit', name])
}
