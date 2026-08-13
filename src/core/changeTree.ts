import type { ChangeArea, FileStatus } from './git'

/** One changed file, as the source-control panel lists it. */
export interface Change {
  path: string
  /** Relative to the project root, `/`-separated — what the tree is built from. */
  rel: string
  status: FileStatus
  /** Which heading it sits under. A path edited after being staged has one of each. */
  area: ChangeArea
}

/**
 * A row of the source-control panel. Folder rows exist only in tree mode; the
 * panel and the keymap both walk this list, so a row's index is what the cursor
 * means — never an index into the changes themselves.
 */
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
  /** Path relative to the root — half of the key `collapsed` holds. */
  rel: string
  area: ChangeArea
  collapsed: boolean
  /** Changed files under it, which is what a folded row shows instead of them. */
  files: number
}

/** A `Staged Changes` / `Changes` heading — VS Code's two groups. */
export interface SectionRow {
  kind: 'section'
  depth: 0
  label: string
  area: ChangeArea
  collapsed: boolean
  files: number
}

/** Which side of the upstream distance a commit sits on — VS Code's sync views. */
export type CommitGroup = 'incoming' | 'outgoing'

/** One commit the branch is ahead or behind its upstream by. */
export interface UpstreamCommit {
  oid: string
  subject: string
}

/** A commit under its `Incoming` / `Outgoing` heading. */
export interface CommitRow {
  kind: 'commit'
  depth: 1
  label: string
  oid: string
  group: CommitGroup
}

/** An `Incoming` / `Outgoing` heading — what a pull would bring, a push would send. */
export interface CommitSectionRow {
  kind: 'commitSection'
  depth: 0
  label: string
  group: CommitGroup
  collapsed: boolean
  count: number
}

export type ChangeRow = FileRow | DirRow | SectionRow | CommitRow | CommitSectionRow

/**
 * What `collapsed` holds. A folder appears under both headings whenever a path
 * is half-staged, and folding it in one has nothing to do with the other, so the
 * area is part of the key rather than the rel alone. The commit groups share the
 * set — their names cannot collide with a `ChangeArea`.
 */
export const foldKey = (area: ChangeArea | CommitGroup, rel: string) => `${area}:${rel}`

/** The area a row's fold state is keyed under — its own, headings included. */
export const rowArea = (row: ChangeRow): ChangeArea | CommitGroup =>
  row.kind === 'file'
    ? row.change.area
    : row.kind === 'commit' || row.kind === 'commitSection'
      ? row.group
      : row.area

/** The rel a row's fold state is keyed under; a heading folds under its own name. */
export const rowRel = (row: ChangeRow): string =>
  row.kind === 'file' ? row.change.rel : row.kind === 'dir' ? row.rel : ''

/** Every folder on the way to `rel`, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestorDirs(rel: string): string[] {
  const parts = rel.split('/')
  return parts.slice(0, -1).map((_, at) => parts.slice(0, at + 1).join('/'))
}

const SECTION_LABEL: Record<ChangeArea, string> = {
  merge: 'Merge Changes',
  staged: 'Staged Changes',
  unstaged: 'Changes',
}

/** The order the headings are drawn in — conflicts first, then staged, as VS Code. */
const AREAS: ChangeArea[] = ['merge', 'staged', 'unstaged']

/**
 * The panel's rows for `changes`, which must already be sorted by `rel`.
 *
 * `list` is one row per change under its full path. `tree` nests them under
 * folder rows and hides the subtree of anything in `collapsed` — a folder's own
 * row stays, so there is something to press to bring it back. Folders with a
 * single child folder are joined into one row (`src/app` rather than two rows),
 * which is what keeps a deep project readable in a 24-column sidebar.
 *
 * `sections` draws the two headings over the whole thing. It is off against a
 * comparison base, where nothing can be staged and a lone `Changes` heading
 * would spend a row saying so.
 */
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
    // An empty group is not drawn at all — the heading of a section with nothing
    // in it is a row spent saying "nothing", which a 24-column sidebar cannot
    // afford and VS Code does not spend either.
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
    // Headings own a level of indent, so what is under them starts one in.
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
  /** Folder rows already emitted, by rel path, so a subtree is opened once. */
  const emitted = new Map<string, { depth: number }>()

  for (const change of changes) {
    const dirs = ancestorDirs(change.rel)
    // A collapsed ancestor hides this file, but its folder row still has to be
    // emitted — hence the walk below runs before the skip, not after.
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
        // The joined folders count as one row: everything under them sits one
        // level in, whatever their number.
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

/**
 * `dir` extended through every folder that is its only child: the rel path of the
 * deepest folder that carries all of `dir`'s files.
 */
function foldable(changes: readonly Change[], dir: string): string {
  let at = dir
  for (;;) {
    const under = changes.filter(change => change.rel.startsWith(`${at}/`))
    const next = new Set(under.map(change => change.rel.slice(at.length + 1).split('/')[0]!))
    if (next.size !== 1) return at
    const only = [...next][0]!
    // A file, not a folder: nothing left to join.
    if (under.some(change => change.rel === `${at}/${only}`)) return at
    at = `${at}/${only}`
  }
}

/** The folder rels between `dir` (exclusive) and `folded` (inclusive). */
function ancestorsUnder(dir: string, folded: string): string[] {
  if (folded === dir) return []
  return ancestorDirs(`${folded}/x`).filter(rel => rel.length > dir.length)
}

/** The row `rows[at]` sits under — its folder, else its heading, else itself.
 * ← walks out along this, and there is nowhere further to go from a heading. */
export function parentRow(rows: readonly ChangeRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0
  for (let up = at - 1; up >= 0; up--) {
    const row = rows[up]!
    if (row.kind !== 'file' && row.depth < depth) return up
  }
  return at
}

/**
 * The changes a row stands for: itself for a file, everything under it for a
 * folder or a heading — folded or not, which is why this reads the change list
 * rather than the rows.
 */
export function changesFor(changes: readonly Change[], row: ChangeRow): Change[] {
  if (row.kind === 'file') return [row.change]
  // A commit is not a change: there is nothing under it to stage or discard.
  if (row.kind === 'commit' || row.kind === 'commitSection') return []
  const area = rowArea(row)
  const mine = changes.filter(change => change.area === area)
  return row.kind === 'section' ? mine : mine.filter(c => c.rel.startsWith(`${row.rel}/`))
}

const COMMIT_SECTION_LABEL: Record<CommitGroup, string> = {
  incoming: 'Incoming',
  outgoing: 'Outgoing',
}

/**
 * The sync sections under the change list: the upstream commits a pull would
 * bring in and the local ones a push would send, each under its own foldable
 * heading and skipped entirely when empty, as the change headings are.
 */
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
