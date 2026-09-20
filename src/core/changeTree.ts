import type { ChangeArea, FileStatus } from './git'

export interface Change {
  path: string
  rel: string
  status: FileStatus
  area: ChangeArea
}

export interface FileRow {
  kind: 'file'
  depth: number
  label: string
  change: Change
}

export interface DirRow {
  kind: 'dir'
  depth: number
  label: string
  rel: string
  area: ChangeArea
  collapsed: boolean
  files: number
}

export interface SectionRow {
  kind: 'section'
  depth: 0
  label: string
  area: ChangeArea
  collapsed: boolean
  files: number
}

export type CommitGroup = 'incoming' | 'outgoing'

export interface UpstreamCommit {
  oid: string
  subject: string
}

interface CommitRow {
  kind: 'commit'
  depth: 1
  label: string
  oid: string
  group: CommitGroup
}

export interface CommitSectionRow {
  kind: 'commitSection'
  depth: 0
  label: string
  group: CommitGroup
  collapsed: boolean
  count: number
}

export type ChangeRow = FileRow | DirRow | SectionRow | CommitRow | CommitSectionRow

// Area is part of the key: a half-staged path has a folder row under both headings.
export const foldKey = (area: ChangeArea | CommitGroup, rel: string) => `${area}:${rel}`

export const rowArea = (row: ChangeRow): ChangeArea | CommitGroup =>
  row.kind === 'file'
    ? row.change.area
    : row.kind === 'commit' || row.kind === 'commitSection'
      ? row.group
      : row.area

export const rowRel = (row: ChangeRow): string =>
  row.kind === 'file' ? row.change.rel : row.kind === 'dir' ? row.rel : ''

export function ancestorDirs(rel: string): string[] {
  const parts = rel.split('/')
  return parts.slice(0, -1).map((_, at) => parts.slice(0, at + 1).join('/'))
}

const SECTION_LABEL: Record<ChangeArea, string> = {
  merge: 'Merge Changes',
  staged: 'Staged Changes',
  unstaged: 'Changes',
}

const AREAS: ChangeArea[] = ['merge', 'staged', 'unstaged']

export function changeRows(
  changes: readonly Change[],
  mode: 'list' | 'tree',
  collapsed: ReadonlySet<string> = new Set(),
  sections = true,
): ChangeRow[] {
  if (!sections) return rowsFor(changes, mode, collapsed)

  const rows: ChangeRow[] = []
  for (const area of AREAS) {
    const mine = changes.filter(change => change.area === area)
    if (mine.length === 0) continue
    const shut = collapsed.has(foldKey(area, ''))
    rows.push({
      kind: 'section',
      depth: 0,
      label: SECTION_LABEL[area],
      area,
      collapsed: shut,
      files: mine.length,
    })
    if (shut) continue
    for (const row of rowsFor(mine, mode, collapsed)) rows.push({ ...row, depth: row.depth + 1 })
  }
  return rows
}

function rowsFor(
  changes: readonly Change[],
  mode: 'list' | 'tree',
  collapsed: ReadonlySet<string>,
): (FileRow | DirRow)[] {
  if (mode === 'list') {
    return changes.map(change => ({ kind: 'file', depth: 0, label: change.rel, change }))
  }

  const rows: (FileRow | DirRow)[] = []
  const emitted = new Map<string, { depth: number }>()

  for (const change of changes) {
    const dirs = ancestorDirs(change.rel)
    // The folder walk runs before the skip: a hidden file's folder row still has to be emitted.
    let hidden = false
    let depth = 0
    for (const dir of dirs) {
      if (hidden) break
      const seen = emitted.get(dir)
      if (seen) {
        depth = seen.depth + 1
      } else {
        const folded = foldable(changes, dir)
        rows.push({
          kind: 'dir',
          depth,
          label: folded.slice(dir.lastIndexOf('/') + 1),
          rel: dir,
          area: change.area,
          collapsed: collapsed.has(foldKey(change.area, dir)),
          files: changes.filter(c => c.rel.startsWith(`${dir}/`)).length,
        })
        emitted.set(dir, { depth })
        for (const joined of ancestorsUnder(dir, folded)) emitted.set(joined, { depth })
        depth += 1
      }
      if (collapsed.has(foldKey(change.area, dir))) hidden = true
    }
    if (hidden) continue
    rows.push({
      kind: 'file',
      depth,
      label: change.rel.slice(change.rel.lastIndexOf('/') + 1),
      change,
    })
  }
  return rows
}

function foldable(changes: readonly Change[], dir: string): string {
  let at = dir
  for (;;) {
    const under = changes.filter(change => change.rel.startsWith(`${at}/`))
    const next = new Set(under.map(change => change.rel.slice(at.length + 1).split('/')[0]!))
    if (next.size !== 1) return at
    const only = [...next][0]!
    if (under.some(change => change.rel === `${at}/${only}`)) return at
    at = `${at}/${only}`
  }
}

function ancestorsUnder(dir: string, folded: string): string[] {
  if (folded === dir) return []
  return ancestorDirs(`${folded}/x`).filter(rel => rel.length > dir.length)
}

export function parentRow(rows: readonly ChangeRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0
  for (let up = at - 1; up >= 0; up--) {
    const row = rows[up]!
    if (row.kind !== 'file' && row.depth < depth) return up
  }
  return at
}

// Folded or not — hence the change list and not the rows, which omit a folded folder's files.
export function changesFor(changes: readonly Change[], row: ChangeRow): Change[] {
  if (row.kind === 'file') return [row.change]
  if (row.kind === 'commit' || row.kind === 'commitSection') return []
  const area = rowArea(row)
  const mine = changes.filter(change => change.area === area)
  return row.kind === 'section' ? mine : mine.filter(c => c.rel.startsWith(`${row.rel}/`))
}

const COMMIT_SECTION_LABEL: Record<CommitGroup, string> = {
  incoming: 'Incoming',
  outgoing: 'Outgoing',
}

export function commitRows(
  incoming: readonly UpstreamCommit[],
  outgoing: readonly UpstreamCommit[],
  collapsed: ReadonlySet<string> = new Set(),
): ChangeRow[] {
  const rows: ChangeRow[] = []
  const groups: [CommitGroup, readonly UpstreamCommit[]][] = [
    ['incoming', incoming],
    ['outgoing', outgoing],
  ]
  for (const [group, commits] of groups) {
    if (commits.length === 0) continue
    const shut = collapsed.has(foldKey(group, ''))
    rows.push({
      kind: 'commitSection',
      depth: 0,
      label: COMMIT_SECTION_LABEL[group],
      group,
      collapsed: shut,
      count: commits.length,
    })
    if (shut) continue
    for (const commit of commits) {
      rows.push({ kind: 'commit', depth: 1, label: commit.subject, oid: commit.oid, group })
    }
  }
  return rows
}
