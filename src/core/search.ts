import { listDir, readFile, readTextFile, writeFile } from './fs'
import { ignoredPaths } from './git'

export interface Match {
  path: string
  /** 0-based line index. */
  line: number
  /** 0-based column of the match start. */
  col: number
  /** Characters matched — equals the query's length except in regex mode. */
  length: number
  text: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

/**
 * The query as a per-line RegExp, or null when it is an invalid pattern.
 * One place builds it so search, replace-one and replace-all can never
 * disagree about what a match is.
 */
export function buildQuery(query: string, options: SearchOptions = {}): RegExp | null {
  const escaped = options.regex ? query : query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  const wrapped = options.wholeWord ? `\\b(?:${escaped})\\b` : escaped
  try {
    // `m` because searchText counts per line while replaceAll runs over the whole
    // file: without it `^`/`$` anchor to the string, so an anchored regex is counted
    // on every line and replaced on one — a confirm promising matches it never makes.
    return new RegExp(wrapped, options.caseSensitive ? 'gm' : 'gim')
  } catch {
    return null
  }
}

/** Lines around a match, for a preview. */
export interface Context {
  /** 0-based index of `lines[0]`. */
  start: number
  lines: string[]
}

/**
 * `radius` lines either side of `line`. The text is passed in rather than carried on
 * every `Match`: a 200-match scan would drag the surroundings of each along, and only
 * the selected one is ever shown.
 */
export function contextIn(text: string, line: number, radius: number): Context {
  const lines = text.split('\n')
  const start = Math.max(0, line - radius)
  return { start, lines: lines.slice(start, line + radius + 1) }
}

const DEFAULT_LIMIT = 200

/** Directories never worth walking, for both the search and the fuzzy finder. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.turbo',
  '.cache',
])

export function searchText(
  text: string,
  query: string,
  path: string,
  options: SearchOptions = {},
  limit = DEFAULT_LIMIT,
): Match[] {
  if (!query) return []
  const pattern = buildQuery(query, options)
  if (!pattern) return []
  const matches: Match[] = []

  const lines = text.split('\n')
  for (let line = 0; line < lines.length && matches.length < limit; line++) {
    const raw = lines[line]!
    pattern.lastIndex = 0
    for (let hit = pattern.exec(raw); hit && matches.length < limit; hit = pattern.exec(raw)) {
      // A pattern like `a*` matches the empty string at every column; skipping
      // those (and stepping past them) is what keeps this loop finite.
      if (hit[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      matches.push({ path, line, col: hit.index, length: hit[0].length, text: raw })
    }
  }
  return matches
}

/*
 * Breadth-first, so the files nearest the root are found before any limit cuts off.
 *
 * Git-ignored entries are left out whatever `respectGitignore` says — that setting
 * is about what the tree *shows*, and a build directory or a worktree checkout
 * parked inside the project is nobody's search result either way. `ignoredPaths`
 * collapses a fully-ignored directory to a single entry, which is all this needs:
 * a directory that is skipped is never queued, so nothing under it is walked.
 */
function* filesUnder(root: string): Generator<string> {
  const ignored = ignoredPaths(root)
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.shift()!
    for (const node of listDir(dir)) {
      if (ignored.has(node.path)) continue
      if (node.isDir) {
        if (!SKIPPED_DIRS.has(node.name)) queue.push(node.path)
      } else {
        yield node.path
      }
    }
  }
}

/**
 * Search every text file under `root`, breadth-first, stopping at the limit.
 * `buffers` overlays open-buffer text over the disk copy, so what the results
 * show is what a replace would act on — scanning disk under an edited buffer
 * lists matches the buffer no longer has, and misses the ones it gained.
 */
export function searchProject(
  root: string,
  query: string,
  options: SearchOptions = {},
  limit = DEFAULT_LIMIT,
  buffers?: ReadonlyMap<string, string>,
): Match[] {
  if (!query) return []
  const matches: Match[] = []

  for (const path of filesUnder(root)) {
    if (matches.length >= limit) break
    let content: string
    const open = buffers?.get(path)
    if (open != null) {
      content = open
    } else {
      try {
        content = readFile(path)
      } catch {
        continue // binary or unreadable
      }
    }
    matches.push(...searchText(content, query, path, options, limit - matches.length))
  }
  return matches
}

/** One file a project replace would touch, counted on the text the apply will see. */
export interface ReplaceTarget {
  path: string
  count: number
}

/**
 * Every file a project replace would touch, with true counts — deliberately not
 * `searchProject`, whose limit exists for a panel that shows 200 rows: a confirm
 * that says "N matches" must have counted all of them.
 */
export function planProjectReplace(
  root: string,
  query: string,
  options: SearchOptions = {},
  buffers?: ReadonlyMap<string, string>,
): { targets: ReplaceTarget[]; matches: number } {
  const targets: ReplaceTarget[] = []
  let matches = 0
  if (!query || !buildQuery(query, options)) return { targets, matches }

  for (const path of filesUnder(root)) {
    let content: string
    const open = buffers?.get(path)
    if (open != null) {
      content = open
    } else {
      try {
        content = readFile(path)
      } catch {
        continue
      }
    }
    const count = searchText(content, query, path, options, Infinity).length
    if (count === 0) continue
    targets.push({ path, count })
    matches += count
  }
  return { targets, matches }
}

/** A file transformed by `replaceProject`; `content` means the caller owns applying it. */
export interface ReplacedFile {
  path: string
  /** Occurrences replaced, counted on the text actually transformed. */
  count: number
  /**
   * New text for a path the caller supplied a buffer for. The write is the
   * caller's: a buffered file's truth is the buffer, and writing its disk copy
   * here would hand the watcher an edit the buffer does not have.
   */
  content?: string
}

export interface ReplaceProjectResult {
  replaced: ReplacedFile[]
  /** Occurrences replaced across every file — apply-time counts, not the plan's. */
  matches: number
  /** `path — reason` for every file that could not be read or written. */
  failed: string[]
}

/**
 * Replace across the planned `paths`. Each file is re-read at apply time and
 * counted on the text actually transformed — the plan's counts age the moment
 * the confirm goes up, and only what happened here is worth reporting. Files
 * that appeared after the plan are not touched: the confirm approved a set.
 * Failures are collected, never thrown — the files before them are already
 * written, so stopping would neither undo nor finish.
 */
export function replaceProject(
  paths: readonly string[],
  query: string,
  replacement: string,
  options: SearchOptions = {},
  buffers?: ReadonlyMap<string, string>,
): ReplaceProjectResult {
  const replaced: ReplacedFile[] = []
  const failed: string[] = []
  let matches = 0

  for (const path of paths) {
    const open = buffers?.get(path)
    if (open != null) {
      const count = searchText(open, query, path, options, Infinity).length
      if (count === 0) continue
      replaced.push({ path, count, content: replaceAll(open, query, replacement, options) })
      matches += count
      continue
    }
    let text: string
    let encoding
    try {
      ;({ text, encoding } = readTextFile(path))
    } catch (error) {
      failed.push(`${path} — ${error instanceof Error ? error.message : 'unreadable'}`)
      continue
    }
    const count = searchText(text, query, path, options, Infinity).length
    if (count === 0) continue
    // The encoding read is written back: a CRLF or BOM file rewritten with the
    // default would diff on every line, not just the replaced ones.
    const error = writeFile(path, replaceAll(text, query, replacement, options), encoding)
    if (error) {
      failed.push(`${path} — ${error}`)
      continue
    }
    replaced.push({ path, count })
    matches += count
  }
  return { replaced, matches, failed }
}

/**
 * Subsequence match, VS Code style: every character of `query` must appear in
 * order. Returns a score (lower is better) or null when it does not match.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let score = 0
  let at = -1
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1)
    if (next < 0) return null
    score += next - at - 1 // reward characters that sit close together
    at = next
  }
  // Prefer matches late in the path (the file name) and shorter paths.
  return score + text.length - at
}

/** Every file under `root`, breadth-first, so the nearest ones survive the limit. */
export function listFiles(root: string, limit = 5000): string[] {
  const files: string[] = []
  for (const path of filesUnder(root)) {
    if (files.length >= limit) break
    files.push(path)
  }
  return files
}

/** Replace every occurrence, matching exactly what `searchText` matched. */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): string {
  if (!query) return text
  const pattern = buildQuery(query, options)
  if (!pattern) return text
  // Function form, so `$&` and `$1` in the replacement are inserted literally.
  return text.replace(pattern, hit => (hit.length === 0 ? hit : replacement))
}

/**
 * Replace the one occurrence `match` points at, leaving every other alone.
 * A match whose line has since changed is refused rather than applied at a
 * drifted offset.
 */
export function replaceMatch(text: string, match: Match, replacement: string): string | null {
  const lines = text.split('\n')
  if (lines[match.line] !== match.text) return null
  const line = lines[match.line]!
  lines[match.line] = line.slice(0, match.col) + replacement + line.slice(match.col + match.length)
  return lines.join('\n')
}
