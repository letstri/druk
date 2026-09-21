import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { decodeText } from './fs'
import { firstLine, notInstalled, run as runProcess } from './process'
import type { ProcessResult } from './process'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

type StageArea = 'staged' | 'unstaged'

export type ChangeArea = StageArea | 'merge'

export interface StatusEntry {
  staged: FileStatus | null
  unstaged: FileStatus | null
  conflicted?: boolean
  // Where a rename came from, repository-relative: the blob to diff against lives under that name.
  source?: string
}

export function combinedStatus(entry: StatusEntry): FileStatus {
  return entry.staged ?? entry.unstaged ?? 'modified'
}

// spawnSync truncates at 1 MB by default and reports ENOBUFS, which every caller reads as "no output".
const MAX_OUTPUT = 128 * 1024 * 1024

// `git status`/`git diff` rewrite the index to refresh its stat cache, which wakes the `.git`
// watcher that asked for them; reads take no optional lock so that loop cannot start.
const READ_ONLY = ['--no-optional-locks']

// A path after `--` is a pathspec: `git clean -f -- '[id].tsx'` would also delete `i.tsx`.
const literal = (path: string) => `:(literal)${path}`

function git(cwd: string, args: string[], timeout = 5000, input?: string) {
  return spawnSync('git', [...READ_ONLY, ...args], {
    cwd,
    encoding: 'utf-8',
    input,
    maxBuffer: MAX_OUTPUT,
    timeout,
  })
}

function gitAsync(
  cwd: string,
  args: string[],
  timeout = 10_000,
  input?: string
): Promise<ProcessResult> {
  return runProcess('git', [...READ_ONLY, ...args], {
    cwd,
    input,
    maxOutput: MAX_OUTPUT,
    timeout,
  })
}

// Keyed by 0-based line number; git's hunk headers are 1-based.
export async function diffLines(
  path: string,
  ref: string | null = null
): Promise<Map<number, LineChange>> {
  const marks = new Map<number, LineChange>()
  const run = await gitAsync(
    dirname(path),
    [
      'diff',
      '--no-color',
      '--unified=0',
      ...(ref ? [ref] : []),
      '--',
      literal(path),
    ],
    3000
  )
  if (run.status !== 0 || !run.stdout) {
    return marks
  }

  for (const hunk of run.stdout.split('\n')) {
    const header = hunk.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u)
    if (!header) {
      continue
    }
    const removed = header[1] === undefined ? 1 : Number(header[1])
    const start = Number(header[2])
    const added = header[3] === undefined ? 1 : Number(header[3])

    if (added === 0) {
      marks.set(Math.max(0, start - 1), 'deleted')
      continue
    }
    for (let i = 0; i < added; i += 1) {
      marks.set(start - 1 + i, i < removed ? 'modified' : 'added')
    }
  }
  return marks
}

export function currentBranch(cwd: string): string | null {
  const run = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000)
  return parseBranch(run.stdout, run.status)
}

export async function currentBranchAsync(cwd: string): Promise<string | null> {
  const run = await gitAsync(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000)
  return parseBranch(run.stdout, run.status)
}

function parseBranch(stdout: string, status: number | null): string | null {
  if (status !== 0) {
    return null
  }
  const branch = stdout.trim()
  return branch.length > 0 && branch !== 'HEAD' ? branch : null
}

export interface Branch {
  name: string
  remote: boolean
  current: boolean
  upstream: string | null
}

export type ComparisonFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'

interface ComparisonRef {
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

interface ComparisonStats {
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

type ComparisonFailure =
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

export function localBranchName(name: string): string {
  return name.slice(name.indexOf('/') + 1)
}

export function listBranches(cwd: string): Branch[] {
  const format = [
    '%(refname)',
    '%(refname:short)',
    '%(HEAD)',
    '%(upstream:short)',
  ]
  const run = git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${format.join('\t')}`,
    'refs/heads',
    'refs/remotes',
  ])
  if (run.status !== 0 || !run.stdout) {
    return []
  }

  const branches: Branch[] = []
  for (const line of run.stdout.split('\n')) {
    const [ref, name, head, upstream] = line.split('\t')
    if (!ref || !name) {
      continue
    }
    if (name.endsWith('/HEAD')) {
      continue
    }
    branches.push({
      current: head === '*',
      name,
      remote: ref.startsWith('refs/remotes/'),
      upstream: upstream || null,
    })
  }
  return branches
}

export function defaultBranch(cwd: string): string | null {
  const remotes =
    git(cwd, ['remote']).stdout?.trim().split('\n').filter(Boolean) ?? []
  for (const remote of remotes.toSorted((a, b) => {
    if (a === 'origin') {
      return -1
    }
    if (b === 'origin') {
      return 1
    }
    return a.localeCompare(b)
  })) {
    const head = git(cwd, [
      'symbolic-ref',
      '--quiet',
      '--short',
      `refs/remotes/${remote}/HEAD`,
    ])
    if (head.status === 0 && head.stdout.trim()) {
      return head.stdout.trim()
    }
  }

  const configured = git(cwd, ['config', '--get', 'init.defaultBranch'])
  const name = configured.status === 0 ? configured.stdout.trim() : ''
  if (!name) {
    return null
  }
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
    .status === 0
    ? name
    : null
}

function comparisonFailure(
  reason: ComparisonFailure,
  detail: string
): ComparisonResult<never> {
  return { detail, ok: false, reason }
}

function asyncFailure(
  run: ProcessResult,
  fallback: string
): ComparisonResult<never> {
  if (run.timedOut) {
    return comparisonFailure('timeout', `${fallback} timed out`)
  }
  if (run.overflow) {
    return comparisonFailure('gitError', `${fallback} produced too much output`)
  }
  return comparisonFailure('gitError', run.stderr.trim() || fallback)
}

export async function resolveComparison(
  cwd: string,
  baseName: string,
  compareName?: string
): Promise<ComparisonResult<ComparisonIdentity>> {
  if (!inRepository(cwd)) {
    return comparisonFailure('notRepository', 'Not a git repository')
  }

  let compare = compareName
  if (!compare) {
    const symbolic = git(
      cwd,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      3000
    )
    if (symbolic.status !== 0) {
      return comparisonFailure(
        'detachedHead',
        'Branch comparison needs a checked-out branch'
      )
    }
    compare = symbolic.stdout.trim()
  }

  const [baseRun, compareRun] = await Promise.all([
    gitAsync(cwd, ['rev-parse', '--verify', `${baseName}^{commit}`]),
    gitAsync(cwd, ['rev-parse', '--verify', `${compare}^{commit}`]),
  ])
  if (compareRun.status !== 0) {
    if (
      compareRun.timedOut ||
      compareRun.overflow ||
      compareRun.status === null
    ) {
      return asyncFailure(compareRun, `Could not resolve ${compare}`)
    }
    return comparisonFailure(
      compareName ? 'invalidCompare' : 'unbornBranch',
      compareName
        ? `Compare branch "${compare}" does not exist`
        : `Branch "${compare}" has no commits yet`
    )
  }
  if (baseRun.status !== 0) {
    if (baseRun.timedOut || baseRun.overflow || baseRun.status === null) {
      return asyncFailure(baseRun, `Could not resolve ${baseName}`)
    }
    return comparisonFailure(
      'invalidBase',
      `Base branch "${baseName}" does not exist`
    )
  }

  const baseOid = baseRun.stdout.trim()
  const compareOid = compareRun.stdout.trim()
  const mergeBase = await gitAsync(cwd, ['merge-base', baseOid, compareOid])
  if (mergeBase.status !== 0) {
    if (mergeBase.timedOut || mergeBase.overflow || mergeBase.status === null) {
      return asyncFailure(mergeBase, 'Could not find the merge base')
    }
    return comparisonFailure(
      'noMergeBase',
      'The branches have no common ancestor'
    )
  }

  const counts = await gitAsync(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    `${baseOid}...${compareOid}`,
  ])
  if (counts.status !== 0) {
    return asyncFailure(counts, 'Could not count branch commits')
  }
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/u).map(Number)

  return {
    ok: true,
    value: {
      ahead,
      base: { name: baseName, oid: baseOid },
      behind,
      compare: { name: compare, oid: compareOid },
      mergeBase: mergeBase.stdout.trim(),
    },
  }
}

const COMPARISON_STATUS: Record<string, ComparisonFileStatus | undefined> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
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

function parseCommits(text: string): ComparisonCommit[] | null {
  const fields = text.split('\0')
  if (fields.at(-1) === '') {
    fields.pop()
  }
  if (fields.length % COMMIT_FIELDS !== 0) {
    return null
  }
  const commits: ComparisonCommit[] = []
  for (let at = 0; at < fields.length; at += COMMIT_FIELDS) {
    commits.push({
      authorEmail: fields[at + 4]!,
      authorName: fields[at + 3]!,
      authoredAt: fields[at + 5]!,
      oid: fields[at]!,
      parents: fields[at + 6]!.split(' ').filter(Boolean),
      shortOid: fields[at + 1]!,
      subject: fields[at + 2]!,
    })
  }
  return commits
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// Both halves of `changedFiles` must pass these, or they disagree on which path pairs exist.
const RENAMES = ['--find-renames', '--find-copies']

interface LineTotals {
  binary: boolean
  additions: number | null
  deletions: number | null
}

function blobOid(field: string | undefined): string | null {
  return field && !/^0+$/u.test(field) ? field : null
}

// A rename or copy leaves the record's path field empty and follows it with its two paths.
function parseNumstat(text: string): Map<string, LineTotals> | null {
  const totals = new Map<string, LineTotals>()
  const records = text.split('\0')
  if (records.at(-1) === '') {
    records.pop()
  }
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at]!
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab === -1 ? -1 : record.indexOf('\t', firstTab + 1)
    if (secondTab < 0) {
      return null
    }
    const inlinePath = record.slice(secondTab + 1)
    let oldPath: string | null = null
    let path = inlinePath
    if (inlinePath.length === 0) {
      if (at + 2 >= records.length) {
        return null
      }
      oldPath = records[at + 1]!
      path = records[at + 2]!
      at += 2
    }
    const additions = parseCount(record.slice(0, firstTab))
    const deletions = parseCount(record.slice(firstTab + 1, secondTab))
    totals.set(comparisonKey(oldPath, path), {
      additions,
      binary: additions === null || deletions === null,
      deletions,
    })
  }
  return totals
}

type RawFile = Omit<ComparisonFile, keyof LineTotals>

// `-z` keeps a path holding a tab, a newline or a non-ASCII byte intact; the default output C-quotes it.
// A rename or copy spends two records on its paths.
function parseRaw(text: string): RawFile[] | null {
  const files: RawFile[] = []
  const tokens = text.split('\0')
  if (tokens.at(-1) === '') {
    tokens.pop()
  }
  for (let at = 0; at < tokens.length; at += 1) {
    const header = tokens[at]!
    if (!header.startsWith(':')) {
      return null
    }
    const fields = header.slice(1).split(' ')
    const spec = fields[4] ?? ''
    const status = COMPARISON_STATUS[spec[0] ?? '']
    if (!status) {
      return null
    }
    const pathCount = status === 'renamed' || status === 'copied' ? 2 : 1
    if (at + pathCount > tokens.length - 1) {
      return null
    }
    const paths = tokens.slice(at + 1, at + 1 + pathCount)
    at += pathCount
    files.push({
      newOid: blobOid(fields[3]),
      oldOid: blobOid(fields[2]),
      oldPath: pathCount === 2 ? paths[0]! : null,
      path: paths.at(-1)!,
      similarity: spec.length > 1 ? Number(spec.slice(1)) : null,
      status,
    })
  }
  return files
}

async function changedFiles(
  cwd: string,
  from: string,
  to: string
): Promise<
  ComparisonResult<{ files: ComparisonFile[]; stats: ComparisonStats }>
> {
  const [rawRun, numstatRun] = await Promise.all([
    gitAsync(cwd, ['diff', '--raw', '-z', '--abbrev=64', ...RENAMES, from, to]),
    gitAsync(cwd, ['diff', '--numstat', '-z', ...RENAMES, from, to]),
  ])
  if (rawRun.status !== 0) {
    return asyncFailure(rawRun, 'Could not read changed files')
  }
  if (numstatRun.status !== 0) {
    return asyncFailure(numstatRun, 'Could not read line totals')
  }

  const raw = parseRaw(rawRun.stdout)
  const totals = parseNumstat(numstatRun.stdout)
  if (!raw || !totals) {
    return comparisonFailure(
      'gitError',
      'Git returned incomplete comparison metadata'
    )
  }

  const files: ComparisonFile[] = []
  const stats: ComparisonStats = {
    additions: 0,
    binaryFiles: 0,
    deletions: 0,
    files: 0,
  }
  for (const file of raw) {
    const total = totals.get(comparisonKey(file.oldPath, file.path))
    if (!total) {
      return comparisonFailure(
        'gitError',
        `Git reported no line totals for ${file.path}`
      )
    }
    files.push({ ...file, ...total })
    stats.files += 1
    if (total.binary) {
      stats.binaryFiles += 1
    } else {
      stats.additions += total.additions ?? 0
      stats.deletions += total.deletions ?? 0
    }
  }
  return {
    ok: true,
    value: {
      files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
      stats,
    },
  }
}

export async function loadResolvedComparison(
  cwd: string,
  identity: ComparisonIdentity
): Promise<ComparisonResult<BranchComparison>> {
  const [changed, logRun] = await Promise.all([
    changedFiles(cwd, identity.mergeBase, identity.compare.oid),
    gitAsync(cwd, [
      'log',
      '-z',
      `--format=${COMMIT_FORMAT}`,
      `${identity.base.oid}..${identity.compare.oid}`,
    ]),
  ])
  if (!changed.ok) {
    return changed
  }
  if (logRun.status !== 0) {
    return asyncFailure(logRun, 'Could not read comparison commits')
  }
  const commits = parseCommits(logRun.stdout)
  if (!commits) {
    return comparisonFailure(
      'gitError',
      'Git returned incomplete commit metadata'
    )
  }
  return { ok: true, value: { ...identity, ...changed.value, commits } }
}

export async function loadBranchComparison(
  cwd: string,
  baseName: string,
  compareName?: string
): Promise<ComparisonResult<BranchComparison>> {
  const identity = await resolveComparison(cwd, baseName, compareName)
  return identity.ok ? loadResolvedComparison(cwd, identity.value) : identity
}

export async function comparisonFileContent(
  cwd: string,
  file: ComparisonFile
): Promise<ComparisonResult<ComparisonContent>> {
  if (file.binary) {
    return { ok: true, value: { binary: true } }
  }

  const read = (oid: string | null) =>
    oid
      ? gitAsync(cwd, ['cat-file', 'blob', oid])
      : Promise.resolve<ProcessResult | null>(null)
  const [oldRun, newRun] = await Promise.all([
    read(file.oldOid),
    read(file.newOid),
  ])
  if (oldRun && oldRun.status !== 0) {
    return asyncFailure(oldRun, `Could not read ${file.oldPath}`)
  }
  if (newRun && newRun.status !== 0) {
    return asyncFailure(newRun, `Could not read ${file.path}`)
  }
  return {
    ok: true,
    value: {
      binary: false,
      newText: newRun?.stdout ?? '',
      oldText: oldRun?.stdout ?? '',
    },
  }
}

export async function comparisonCommitDetail(
  cwd: string,
  oid: string
): Promise<ComparisonResult<ComparisonCommitDetail>> {
  const metadata = await gitAsync(cwd, [
    'log',
    '-1',
    '-z',
    `--format=${COMMIT_FORMAT}`,
    oid,
  ])
  if (metadata.status !== 0) {
    return asyncFailure(metadata, 'Could not read commit metadata')
  }
  const commits = parseCommits(metadata.stdout)
  const commit = commits?.length === 1 ? commits[0]! : null
  if (!commit) {
    return comparisonFailure('invalidCompare', `Commit "${oid}" does not exist`)
  }

  const changed = await changedFiles(
    cwd,
    commit.parents[0] ?? EMPTY_TREE,
    commit.oid
  )
  return changed.ok
    ? { ok: true, value: { commit, ...changed.value } }
    : changed
}

const STATUS_BY_CODE: Record<string, FileStatus> = {
  '?': 'untracked',
  A: 'added',
  C: 'modified',
  D: 'deleted',
  M: 'modified',
  R: 'modified',
  // Typechange: without this row the entry parses to neither side and the file vanishes from the panel.
  T: 'modified',
  U: 'modified',
}

// git reports the resolved root (/private/var/…) where the tree holds the opened spelling (/var/…),
// so the caller's wins when both name one place — keys from the two must match.
function sameOrRoot(cwd: string, root: string): string {
  try {
    if (realpathSync(cwd) === realpathSync(root)) {
      return cwd
    }
  } catch {
    // unreadable path
  }
  return root
}

function keyBase(cwd: string): string | null {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], 3000)
  return top.status === 0 ? sameOrRoot(cwd, top.stdout.trim()) : null
}

const STATUS_ARGS = ['status', '--porcelain', '-z', '-uall']
const UNTRACKED_ARGS = ['ls-files', '--others', '--exclude-standard', '-z']

interface PorcelainEntry {
  readonly xy: string
  readonly path: string
  readonly source: string | null
}

type DiscardMode = 'restore' | 'delete'

export interface DiscardTarget {
  readonly repo: string
  readonly path: string
  readonly affectedPaths: readonly string[]
  readonly mode: DiscardMode
  readonly entry: PorcelainEntry
  readonly fingerprint: string
}

function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  const parsed: PorcelainEntry[] = []
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    if (entry.length < 4) {
      continue
    }
    const xy = entry.slice(0, 2)
    let source: string | null = null
    if (xy[0] === 'R' || xy[0] === 'C') {
      i += 1
      source = entries[i] ?? null
    }
    parsed.push({ path: entry.slice(3), source, xy })
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

function discardMode(repo: string, entry: PorcelainEntry): DiscardMode {
  if (entry.xy[0] === 'R') {
    return 'restore'
  }
  if (entry.xy[0] === 'C' || entry.xy === '??') {
    return 'delete'
  }
  return pathInHead(repo, entry.path) ? 'restore' : 'delete'
}

function discardFingerprint(
  repo: string,
  entry: PorcelainEntry
): string | null {
  const paths = entry.source ? [entry.path, entry.source] : [entry.path]
  const head = git(repo, ['rev-parse', '--verify', 'HEAD'])
  const index = git(repo, [
    'ls-files',
    '--stage',
    '-z',
    '--',
    ...paths.map(literal),
  ])
  const worktree = git(repo, [
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    '--no-textconv',
    '--',
    ...paths.map(literal),
  ])
  if (index.status !== 0 || worktree.status !== 0) {
    return null
  }

  let untracked = ''
  if (entry.xy === '??') {
    const content = git(repo, ['hash-object', '--no-filters', '--', entry.path])
    if (content.status !== 0) {
      return null
    }
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

export function discardTarget(
  repo: string,
  path: string
): DiscardTarget | null {
  const base = keyBase(repo)
  if (base === null) {
    return null
  }
  const rel = relative(base, path)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    return null
  }
  const gitPath = rel.split(sep).join('/')
  const entry = porcelainEntries(repo).find(
    (candidate) => candidate.path === gitPath
  )
  if (!entry) {
    return null
  }
  const fingerprint = discardFingerprint(repo, entry)
  if (fingerprint === null) {
    return null
  }
  const affectedPaths = Object.freeze(
    entry.xy[0] === 'R' && entry.source
      ? [path, join(base, entry.source)]
      : [path]
  )
  return Object.freeze({
    affectedPaths,
    entry: Object.freeze(entry),
    fingerprint,
    mode: discardMode(repo, entry),
    path,
    repo,
  })
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function parsePorcelain(
  stdout: string,
  base: string
): Map<string, StatusEntry> {
  const statuses = new Map<string, StatusEntry>()
  for (const entry of parsePorcelainEntries(stdout)) {
    if (CONFLICT_CODES.has(entry.xy)) {
      statuses.set(join(base, entry.path), {
        conflicted: true,
        staged: null,
        unstaged: 'modified',
      })
      continue
    }
    const untracked = entry.xy === '??'
    const staged = untracked ? null : (STATUS_BY_CODE[entry.xy[0]!] ?? null)
    const unstaged = untracked
      ? 'untracked'
      : (STATUS_BY_CODE[entry.xy[1]!] ?? null)
    if (staged || unstaged) {
      statuses.set(join(base, entry.path), {
        staged,
        unstaged,
        ...(entry.source ? { source: entry.source } : {}),
      })
    }
  }
  return statuses
}

function flatten(entries: Map<string, StatusEntry>): Map<string, FileStatus> {
  return new Map(
    [...entries].map(([path, entry]) => [path, combinedStatus(entry)])
  )
}

function asUnstaged(
  statuses: Map<string, FileStatus>
): Map<string, StatusEntry> {
  return new Map(
    [...statuses].map(([path, status]) => [
      path,
      { staged: null, unstaged: status },
    ])
  )
}

// `-z` drops the tab between code and path too: the fields arrive as one flat alternating list.
function parseNameStatus(
  stdout: string,
  base: string
): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  const fields = stdout.split('\0')
  for (let i = 0; i < fields.length; i += 2) {
    const code = fields[i]
    if (!code) {
      continue
    }
    // A rename or copy spends a field on each path; skipping one keeps the codes on even indices.
    if (code[0] === 'R' || code[0] === 'C') {
      i += 1
    }
    const path = fields[i + 1]
    const status = STATUS_BY_CODE[code[0]!]
    if (status && path) {
      statuses.set(join(base, path), status)
    }
  }
  return statuses
}

function addUntracked(
  stdout: string,
  base: string,
  into: Map<string, FileStatus>
) {
  for (const rel of stdout.split('\0')) {
    if (rel.length > 0) {
      into.set(join(base, rel), 'untracked')
    }
  }
}

export function statusMap(
  cwd: string,
  ref: string | null = null
): Map<string, FileStatus> {
  return flatten(statusEntries(cwd, ref))
}

export function statusEntries(
  cwd: string,
  ref: string | null = null
): Map<string, StatusEntry> {
  const base = keyBase(cwd)
  if (base === null) {
    return new Map()
  }
  if (ref === null) {
    const run = git(cwd, STATUS_ARGS)
    return run.status === 0 ? parsePorcelain(run.stdout, base) : new Map()
  }

  const diff = git(cwd, ['diff', '--name-status', '-z', ref])
  if (diff.status !== 0) {
    return new Map()
  }
  const statuses = parseNameStatus(diff.stdout, base)
  const others = git(cwd, UNTRACKED_ARGS)
  if (others.status === 0) {
    addUntracked(others.stdout, base, statuses)
  }
  return asUnstaged(statuses)
}

export async function statusEntriesAsync(
  cwd: string,
  ref: string | null = null
): Promise<Map<string, StatusEntry>> {
  const top = await gitAsync(cwd, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) {
    return new Map()
  }
  const base = sameOrRoot(cwd, top.stdout.trim())
  if (ref === null) {
    const run = await gitAsync(cwd, STATUS_ARGS)
    return run.status === 0 ? parsePorcelain(run.stdout, base) : new Map()
  }

  const [diff, others] = await Promise.all([
    gitAsync(cwd, ['diff', '--name-status', '-z', ref]),
    gitAsync(cwd, UNTRACKED_ARGS),
  ])
  if (diff.status !== 0) {
    return new Map()
  }
  const statuses = parseNameStatus(diff.stdout, base)
  if (others.status === 0) {
    addUntracked(others.stdout, base, statuses)
  }
  return asUnstaged(statuses)
}

export async function ignoredAmongAsync(
  cwd: string,
  paths: string[]
): Promise<Set<string>> {
  if (paths.length === 0) {
    return new Set()
  }
  const split = splitBeyondSymlink(cwd, paths)
  const run = await gitAsync(
    cwd,
    ['check-ignore', '--stdin', '-z'],
    5000,
    `${split.askable.join('\0')}\0`
  )
  return readCheckIgnore(cwd, split, run.stdout, run.status)
}

// git aborts the whole `check-ignore` batch with 128 at the first path reaching through a symlink.
function splitBeyondSymlink(cwd: string, paths: string[]) {
  const symlinkDirs = new Map<string, boolean>()
  const askable: string[] = []
  const unanswerable: string[] = []
  for (const path of paths) {
    ;(beyondSymlink(cwd, path, symlinkDirs) ? unanswerable : askable).push(path)
  }
  return { askable, unanswerable }
}

function readCheckIgnore(
  cwd: string,
  split: { unanswerable: string[] },
  stdout: string,
  status: number | null
): Set<string> {
  const ignored = new Set<string>()
  if (status === 0) {
    for (const path of stdout.split('\0')) {
      if (path.length > 0) {
        ignored.add(path)
      }
    }
  }

  for (const path of split.unanswerable) {
    if (hasIgnoredAncestor(cwd, path, ignored)) {
      ignored.add(path)
    }
  }
  return ignored
}

function beyondSymlink(
  cwd: string,
  path: string,
  cache: Map<string, boolean>
): boolean {
  if (!path.startsWith(`${cwd}/`)) {
    return false
  }
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
    if (symlink) {
      return true
    }
  }
  return false
}

function hasIgnoredAncestor(
  cwd: string,
  path: string,
  ignored: Set<string>
): boolean {
  if (!path.startsWith(`${cwd}/`)) {
    return false
  }
  for (let dir = dirname(path); dir.length > cwd.length; dir = dirname(dir)) {
    if (ignored.has(dir)) {
      return true
    }
  }
  return false
}

export function blobTexts(
  cwd: string,
  specs: string[]
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  if (specs.length === 0) {
    return out
  }
  // Buffers, not utf8: the batch header counts contents in bytes, so a non-ASCII blob slices wrong.
  const run = spawnSync('git', [...READ_ONLY, 'cat-file', '--batch'], {
    cwd,
    input: `${specs.join('\n')}\n`,
    maxBuffer: MAX_OUTPUT,
    timeout: 10_000,
  })
  const stdout = run.status === 0 ? run.stdout : null
  if (!stdout) {
    for (const spec of specs) {
      out.set(spec, null)
    }
    return out
  }
  let at = 0
  for (const spec of specs) {
    const nl = stdout.indexOf(10, at)
    if (nl === -1) {
      out.set(spec, null)
      continue
    }
    const [, type, size] = stdout.toString('utf-8', at, nl).split(' ')
    at = nl + 1
    const bytes = Number(size)
    if (type !== 'blob' || !Number.isFinite(bytes)) {
      out.set(spec, null)
      continue
    }
    // The other diff side is an open buffer, always LF: a CRLF blob would diff as every line changed.
    out.set(spec, decodeText(stdout.toString('utf-8', at, at + bytes)).text)
    // the newline git writes after the contents
    at += bytes + 1
  }
  return out
}

export interface Upstream {
  name: string | null
  ahead: number
  behind: number
}

export async function upstreamOf(cwd: string): Promise<Upstream | null> {
  const ref = await gitAsync(
    cwd,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    5000
  )
  if (ref.status !== 0) {
    return (await currentBranchAsync(cwd))
      ? { ahead: 0, behind: 0, name: null }
      : null
  }

  // `|| 0`, not `?? 0`: `[''].map(Number)` is `[NaN]`, which `??` would keep and the status bar print.
  const counts = await gitAsync(
    cwd,
    ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
    5000
  )
  const [behind, ahead] =
    counts.status === 0 ? counts.stdout.trim().split(/\s+/u).map(Number) : []
  return { ahead: ahead || 0, behind: behind || 0, name: ref.stdout.trim() }
}

export interface LogEntry {
  oid: string
  subject: string
}

const LOG_CAP = 50

function parseLog(run: { status: number | null; stdout: string }): LogEntry[] {
  if (run.status !== 0) {
    return []
  }
  return lines(run.stdout).map((line) => {
    const split = line.indexOf(' ')
    return split === -1
      ? { oid: line, subject: '' }
      : { oid: line.slice(0, split), subject: line.slice(split + 1) }
  })
}

export async function upstreamCommits(
  cwd: string,
  direction: 'incoming' | 'outgoing'
): Promise<LogEntry[]> {
  const range =
    direction === 'incoming' ? 'HEAD..@{upstream}' : '@{upstream}..HEAD'
  return parseLog(
    await gitAsync(
      cwd,
      ['log', '-n', String(LOG_CAP), '--format=%H %s', range],
      5000
    )
  )
}

export async function recentCommitMessages(cwd: string): Promise<string[]> {
  const run = await gitAsync(
    cwd,
    ['log', '-n', String(LOG_CAP), '--format=%s'],
    5000
  )
  if (run.status !== 0) {
    return []
  }
  const seen = new Set<string>()
  for (const line of run.stdout.split('\n')) {
    const subject = line.trim()
    if (subject.length > 0) {
      seen.add(subject)
    }
  }
  return [...seen]
}

export function inRepository(cwd: string): boolean {
  return (
    git(cwd, ['rev-parse', '--is-inside-work-tree'], 3000).stdout?.trim() ===
    'true'
  )
}

export function stagedPaths(cwd: string): Set<string> {
  const staged = new Set<string>()
  const base = keyBase(cwd)
  if (base === null) {
    return staged
  }
  // `-z`: a C-quoted path would never match statusMap's keys.
  const run = git(cwd, ['diff', '--cached', '--name-only', '-z'])
  if (run.status !== 0) {
    return staged
  }
  for (const rel of run.stdout.split('\0')) {
    if (rel.length > 0) {
      staged.add(join(base, rel))
    }
  }
  return staged
}

export function ignoredPaths(cwd: string): Set<string> {
  const ignored = new Set<string>()
  // `-z`: a C-quoted path would never match statusMap's keys.
  const run = git(cwd, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ])
  if (run.status !== 0) {
    return ignored
  }
  for (const rel of run.stdout.split('\0')) {
    if (rel.length === 0) {
      continue
    }
    // A collapsed directory keeps git's trailing separator; the tree's paths have none.
    ignored.add(join(cwd, rel.endsWith('/') ? rel.slice(0, -1) : rel))
  }
  return ignored
}

export function lastCommitSubject(cwd: string): string | null {
  const run = git(cwd, ['log', '-1', '--format=%s'], 3000)
  if (run.status !== 0) {
    return null
  }
  const subject = run.stdout.trim()
  return subject.length > 0 ? subject : null
}

export interface GitResult {
  ok: boolean
  detail: string
}

const MUTATE_TIMEOUT = 60_000

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const NOISE = /^(?:hint|warning|note):|^To\s|^remote:\s*$/iu

export function failureLine(text: string): string {
  const all = lines(text)
  const signal = all.filter((line) => !NOISE.test(line))
  const chosen =
    signal.find((line) => line.startsWith('fatal:')) ??
    signal[0] ??
    all[0] ??
    ''
  return chosen.replace(/^(?:fatal|error):\s*/u, '')
}

// `gitPush` recognises this by its exact string, so the KNOWN row below must keep using the constant.
export const PUSH_REJECTED =
  "origin has commits you don't — pull first, then push"

// The branch switcher recognises this by its exact string to offer carrying the changes over.
export const SWITCH_BLOCKED =
  'Commit or stash your changes first — this would overwrite them'

// First match wins: a specific pattern has to stay above the general one it would be swallowed by.
export const KNOWN: readonly (readonly [RegExp, string])[] = [
  [
    /Not possible to fast-forward|Need to specify how to reconcile/iu,
    'Branch and origin have both moved on — merge or rebase in a terminal',
  ],
  [/\[rejected\].*(?:non-fast-forward|fetch first)/iu, PUSH_REJECTED],
  [
    /local changes to the following files would be overwritten/iu,
    SWITCH_BLOCKED,
  ],
  [
    /(?:^CONFLICT|Merge conflict in)[\s\S]*stash entry is kept/imu,
    'Conflicts in the working tree — the stash was kept, resolve them first',
  ],
  [
    /^CONFLICT|Merge conflict in/imu,
    'Conflicts in the working tree — resolve them, then commit the merge',
  ],
  [
    /unmerged files|needs merge|unresolved conflict/iu,
    'Resolve the merge conflicts in your working tree first',
  ],
  [/nothing to commit|no changes added to commit/iu, 'Nothing to commit'],
  [
    /branch named '.*' already exists/iu,
    'A branch of that name already exists',
  ],
  [
    /is not fully merged/iu,
    'Branch has unmerged commits — a force delete discards them',
  ],
  [
    /Cannot delete branch .* checked out/iu,
    'That is the branch you are on — switch to another one first',
  ],
  [/is not a valid branch name/iu, 'Not a valid branch name'],
  [
    /ambiguous argument 'HEAD~1'/iu,
    'Nothing to undo — this is the only commit',
  ],
  [/No stash entries found/iu, 'No stash to pop'],
  [
    /No configured push destination|does not appear to be a git repository/iu,
    "No remote — add an 'origin' in a terminal",
  ],
  [
    /Could not resolve host|unable to access.*(?:Couldn't connect|Connection refused|Operation timed out)/iu,
    "Can't reach the remote — check your network",
  ],
  [
    /terminal prompts disabled|could not read (?:Username|Password)/iu,
    "No stored credentials for the remote — druk can't prompt for them",
  ],
  [/Permission denied \(publickey\)/iu, 'The remote rejected your SSH key'],
  [
    /Authentication failed|Invalid username or password|Access denied/iu,
    'Authentication failed — check your credentials for the remote',
  ],
  [
    /(?:repository|Repository) .*not found|remote: Not Found/iu,
    "Remote repository not found — check the 'origin' URL",
  ],
  [
    /index\.lock.*File exists|Another git process seems to be running/iu,
    'Another git process is running in this repository — let it finish',
  ],
]

export function explain(stderr: string, stdout = ''): string {
  const both = `${stderr}\n${stdout}`
  for (const [pattern, message] of KNOWN) {
    if (pattern.test(both)) {
      return message
    }
  }
  return failureLine(stderr || stdout)
}

async function mutate(cwd: string, args: string[]): Promise<GitResult> {
  const result = await runProcess('git', args, {
    cwd,
    // Without this git prompts for credentials on the terminal druk owns, and the TUI hangs behind it.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: MUTATE_TIMEOUT,
  })
  if (result.error) {
    const detail = notInstalled(result)
      ? 'git is not installed, or not on PATH'
      : result.error.message
    return { detail, ok: false }
  }
  if (result.status === 0) {
    return { detail: firstLine(result.stdout || result.stderr), ok: true }
  }
  const detail = result.timedOut
    ? `Timed out after ${MUTATE_TIMEOUT / 1000}s and was stopped`
    : explain(result.stderr, result.stdout)
  return { detail, ok: false }
}

const sameEntry = (before: PorcelainEntry, after: PorcelainEntry) =>
  before.xy === after.xy &&
  before.path === after.path &&
  before.source === after.source

// The row is re-read at the last moment: a confirmation left open must not run against a changed path.
export async function discardChange(target: DiscardTarget): Promise<GitResult> {
  const current = porcelainEntries(target.repo).find(
    (entry) => entry.path === target.entry.path
  )
  if (!current) {
    return { detail: 'That change is gone — refresh and try again', ok: false }
  }
  const mode = discardMode(target.repo, current)
  if (mode !== target.mode) {
    return {
      detail: 'That change changed how it would be discarded — try again',
      ok: false,
    }
  }
  if (!sameEntry(target.entry, current)) {
    return {
      detail: 'That change changed while the confirmation was open — try again',
      ok: false,
    }
  }
  if (discardFingerprint(target.repo, current) !== target.fingerprint) {
    return {
      detail: 'That change changed while the confirmation was open — try again',
      ok: false,
    }
  }

  if (current.xy[0] === 'R' && current.source) {
    const paths = [literal(current.source), literal(current.path)]
    const reset = await mutate(target.repo, ['reset', '-q', '--', ...paths])
    if (!reset.ok) {
      return reset
    }
    const restore = await mutate(target.repo, [
      'checkout',
      '-q',
      'HEAD',
      '--',
      literal(current.source),
    ])
    if (!restore.ok) {
      return restore
    }
    return mutate(target.repo, [
      'clean',
      '-q',
      '-f',
      '--',
      literal(current.path),
    ])
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
      if (!unstage.ok) {
        return unstage
      }
    }
    return mutate(target.repo, [
      'clean',
      '-q',
      '-f',
      '--',
      literal(current.path),
    ])
  }

  const inHead = pathInHead(target.repo, current.path)
  if (inHead) {
    return mutate(target.repo, [
      'checkout',
      '-q',
      'HEAD',
      '--',
      literal(current.path),
    ])
  }
  const reset = await mutate(target.repo, [
    'reset',
    '-q',
    'HEAD',
    '--',
    literal(current.path),
  ])
  if (!reset.ok) {
    return reset
  }
  return mutate(target.repo, ['clean', '-q', '-f', '--', literal(current.path)])
}

export function stagePaths(
  cwd: string,
  paths: readonly string[]
): Promise<GitResult> {
  return mutate(cwd, ['add', '-A', '--', ...paths.map(literal)])
}

export function unstagePaths(
  cwd: string,
  paths: readonly string[]
): Promise<GitResult> {
  const spec = [...new Set([...paths, ...renameSources(cwd, paths)])].map(
    literal
  )
  return hasCommits(cwd)
    ? mutate(cwd, ['restore', '--staged', '--', ...spec])
    : mutate(cwd, ['rm', '-q', '--cached', '-r', '--', ...spec])
}

// Porcelain reports a rename under its destination alone; restoring that leaves the source staged.
function renameSources(cwd: string, paths: readonly string[]): string[] {
  const wanted = paths.map((path) => path.split(sep).join('/'))
  const covers = (rel: string) =>
    wanted.some((path) => rel === path || rel.startsWith(`${path}/`))
  return porcelainEntries(cwd).flatMap((entry) =>
    entry.source !== null &&
    (entry.xy[0] === 'R' || entry.xy[0] === 'C') &&
    covers(entry.path)
      ? [entry.source]
      : []
  )
}

function hasCommits(cwd: string): boolean {
  return (
    git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], 3000).status === 0
  )
}

export function commitStaged(cwd: string, message: string): Promise<GitResult> {
  return mutate(cwd, ['commit', '-m', message])
}

export async function commitPaths(
  cwd: string,
  message: string,
  paths: string[]
): Promise<GitResult> {
  const add = await mutate(cwd, ['add', '-A', '--', ...paths.map(literal)])
  if (!add.ok) {
    return add
  }
  return mutate(cwd, ['commit', '-m', message, '--', ...paths.map(literal)])
}

export function commitAmend(cwd: string, message: string): Promise<GitResult> {
  return mutate(cwd, ['commit', '--amend', '-m', message])
}

export function undoLastCommit(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['reset', '--soft', 'HEAD~1'])
}

export function stashPush(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['stash', 'push', '-u'])
}

export interface Worktree {
  path: string
  branch: string | null
}

// Not `localBranchName` on the branch line: the porcelain writes a full ref, so `feat/x` → `heads/feat/x`.
export function worktrees(cwd: string): Worktree[] {
  const run = git(cwd, ['worktree', 'list', '--porcelain'], 5000)
  if (run.status !== 0) {
    return []
  }

  const found: Worktree[] = []
  for (const line of run.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      found.push({ branch: null, path: line.slice(9) })
    } else if (line.startsWith('branch ')) {
      const at = found.at(-1)
      if (at) {
        at.branch = line.slice(7).replace(/^refs\/heads\//u, '')
      }
    } else if (line === 'bare') {
      found.pop()
    }
  }
  return found
}

export function addWorktree(
  cwd: string,
  path: string,
  branch: string,
  create: boolean
): Promise<GitResult> {
  return mutate(
    cwd,
    create
      ? ['worktree', 'add', '-b', branch, path]
      : ['worktree', 'add', path, branch]
  )
}

export function removeWorktree(cwd: string, path: string): Promise<GitResult> {
  return mutate(cwd, ['worktree', 'remove', path])
}

export interface StashEntry {
  ref: string
  message: string
}

export function stashList(cwd: string): StashEntry[] {
  const run = git(cwd, ['stash', 'list', '--format=%gd%x1f%gs'], 5000)
  if (run.status !== 0) {
    return []
  }
  return run.stdout
    .split('\n')
    .filter((line) => line.includes('\u001F'))
    .map((line) => {
      const [ref = '', message = ''] = line.split('\u001F')
      return { message, ref }
    })
}

export function stashApply(cwd: string, ref: string): Promise<GitResult> {
  return mutate(cwd, ['stash', 'apply', ref])
}

export function stashPop(cwd: string, ref?: string): Promise<GitResult> {
  return mutate(cwd, ref ? ['stash', 'pop', ref] : ['stash', 'pop'])
}

export function stashDrop(cwd: string, ref: string): Promise<GitResult> {
  return mutate(cwd, ['stash', 'drop', ref])
}

export function listTags(cwd: string): string[] {
  const run = git(cwd, ['tag', '--sort=-creatordate'], 5000)
  if (run.status !== 0) {
    return []
  }
  return run.stdout.split('\n').filter((line) => line.length > 0)
}

export function createTag(cwd: string, name: string): Promise<GitResult> {
  return mutate(cwd, ['tag', '--', name])
}

export function deleteTag(cwd: string, name: string): Promise<GitResult> {
  return mutate(cwd, ['tag', '-d', '--', name])
}

export interface Remote {
  name: string
  url: string
}

export function listRemotes(cwd: string): Remote[] {
  const run = git(cwd, ['remote', '-v'], 5000)
  if (run.status !== 0) {
    return []
  }
  const remotes: Remote[] = []
  for (const line of run.stdout.split('\n')) {
    const match = /^(\S+)\t(\S+) \(fetch\)$/u.exec(line)
    if (match) {
      remotes.push({ name: match[1]!, url: match[2]! })
    }
  }
  return remotes
}

// A remote's web root: the scp-like form git prints for SSH has no scheme to parse.
function webRoot(remote: string): URL | null {
  const clean = remote
    .trim()
    .replace(/\/+$/u, '')
    .replace(/\.git$/u, '')
  if (!clean) {
    return null
  }
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/u.exec(clean)
  if (scp) {
    return new URL(`https://${scp[1]}/${scp[2]}`)
  }
  if (!/^[a-z][\w+.-]*:\/\//iu.test(clean)) {
    return null
  }
  let url: URL
  try {
    url = new URL(clean)
  } catch {
    return null
  }
  if (!url.hostname) {
    return null
  }
  const web = url.protocol === 'http:' ? 'http:' : 'https:'
  // An ssh port is not the web one; an http(s) remote's is.
  const port =
    url.protocol === 'http:' || url.protocol === 'https:' ? url.port : ''
  return new URL(
    `${web}//${url.hostname}${port ? `:${port}` : ''}${url.pathname}`
  )
}

export function forgeCommitUrl(remote: string, oid: string): string | null {
  const root = webRoot(remote)
  if (!root || root.pathname === '/') {
    return null
  }
  const host = root.hostname
  const path = host.includes('bitbucket')
    ? 'commits'
    : host.includes('gitlab')
      ? '-/commit'
      : 'commit'
  return `${root.toString().replace(/\/$/u, '')}/${path}/${oid}`
}

export function commitUrl(cwd: string, oid: string): string | null {
  const remotes = listRemotes(cwd)
  const remote = remotes.find((entry) => entry.name === 'origin') ?? remotes[0]
  return remote ? forgeCommitUrl(remote.url, oid) : null
}

export function addRemote(
  cwd: string,
  name: string,
  url: string
): Promise<GitResult> {
  return mutate(cwd, ['remote', 'add', '--', name, url])
}

export function removeRemote(cwd: string, name: string): Promise<GitResult> {
  return mutate(cwd, ['remote', 'remove', name])
}

export function fileHistory(cwd: string, relPath: string): LogEntry[] {
  return parseLog(
    git(
      cwd,
      [
        'log',
        '--follow',
        '-n',
        String(LOG_CAP),
        '--format=%H %s',
        '--',
        literal(relPath),
      ],
      5000
    )
  )
}

export interface GraphCommit {
  oid: string
  shortOid: string
  subject: string
  refs: string[]
  author: string
  date: string
}

// A row with no commit is one of git's own connector lines (`|\`, `|/`).
export interface GraphRow {
  graph: string
  commit: GraphCommit | null
}

const GRAPH_CAP = 500

// A unit separator, not NUL: argv is NUL-terminated, so `%x00` would truncate the format.
const FIELD = '\u001F'

export async function commitGraph(cwd: string): Promise<GraphRow[]> {
  const run = await gitAsync(cwd, [
    'log',
    '--graph',
    '--all',
    // git's own advice: with --graph, date order can draw a child above its parent.
    '--topo-order',
    '--decorate=full',
    '--date=short',
    '-n',
    String(GRAPH_CAP),
    `--format=${FIELD}%H${FIELD}%h${FIELD}%s${FIELD}%D${FIELD}%an${FIELD}%ad`,
  ])
  if (run.status !== 0) {
    return []
  }
  return run.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const at = line.indexOf(FIELD)
      if (at === -1) {
        return { commit: null, graph: line }
      }
      const [
        oid = '',
        shortOid = '',
        subject = '',
        refs = '',
        author = '',
        date = '',
      ] = line.slice(at + 1).split(FIELD)
      return {
        commit: {
          author,
          date,
          oid,
          refs: refs ? refs.split(', ') : [],
          shortOid,
          subject,
        },
        graph: line.slice(0, at),
      }
    })
}

export function push(
  cwd: string,
  branch: string,
  hasUpstream: boolean
): Promise<GitResult> {
  return mutate(
    cwd,
    hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch]
  )
}

export async function pullAndPush(
  cwd: string,
  branch: string,
  hasUpstream: boolean
): Promise<GitResult> {
  const pulled = await mutate(cwd, ['pull', '--no-rebase', '--no-edit'])
  if (!pulled.ok) {
    return pulled
  }
  return push(cwd, branch, hasUpstream)
}

export function fetchRemote(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['fetch'])
}

export function pull(cwd: string): Promise<GitResult> {
  // --ff-only: a real merge opens an editor druk cannot host.
  return mutate(cwd, ['pull', '--ff-only'])
}

export function createBranch(
  cwd: string,
  name: string,
  from: string | null
): Promise<GitResult> {
  return mutate(
    cwd,
    from ? ['checkout', '-b', name, from] : ['checkout', '-b', name]
  )
}

// `carry` is git's own three-way checkout: it takes the uncommitted changes along, leaving
// conflict markers in the tree (and a stash of them behind) where the two sides disagree.
export function switchBranch(
  cwd: string,
  name: string,
  remote: boolean,
  carry = false
): Promise<GitResult> {
  const merge = carry ? ['-m'] : []
  if (!remote) {
    return mutate(cwd, ['checkout', ...merge, name])
  }
  const local = localBranchName(name)
  return branchExists(cwd, local)
    ? mutate(cwd, ['checkout', ...merge, local])
    : mutate(cwd, ['checkout', ...merge, '-b', local, '--track', name])
}

export function branchExists(cwd: string, name: string): boolean {
  return (
    git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], 3000)
      .status === 0
  )
}

export function renameBranch(
  cwd: string,
  from: string,
  to: string
): Promise<GitResult> {
  return mutate(cwd, ['branch', '-m', from, to])
}

export function deleteBranch(
  cwd: string,
  name: string,
  force: boolean
): Promise<GitResult> {
  return mutate(cwd, ['branch', force ? '-D' : '-d', name])
}

export function mergeBranch(cwd: string, name: string): Promise<GitResult> {
  // --no-edit: a merge commit otherwise opens an editor druk cannot host.
  return mutate(cwd, ['merge', '--no-edit', name])
}
