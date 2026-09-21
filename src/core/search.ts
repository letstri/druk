import { listDir, readFile, readTextFile, realPath, writeFile } from './fs'
import { ignoredPaths } from './git'
import { isRepoRoot } from './repos'

export interface Match {
  path: string
  line: number
  col: number
  length: number
  text: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export function buildQuery(
  query: string,
  options: SearchOptions = {}
): RegExp | null {
  const escaped = options.regex
    ? query
    : query.replaceAll(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
  // `m`: searchText counts per line while replaceAll runs over the whole file.
  const flags = options.caseSensitive ? 'gm' : 'gim'
  if (options.wholeWord) {
    try {
      // JS `\b` is ASCII: a Cyrillic or CJK word inside its own run would never match. The `u`
      // flag those classes need rejects escapes a user's regex may legally carry, hence the fallback.
      return new RegExp(
        `(?<![\\p{L}\\p{N}_])(?:${escaped})(?![\\p{L}\\p{N}_])`,
        `${flags}u`
      )
    } catch {
      // an escape the `u` flag refuses
    }
  }
  try {
    return new RegExp(
      options.wholeWord ? `\\b(?:${escaped})\\b` : escaped,
      flags
    )
  } catch {
    return null
  }
}

export interface Context {
  start: number
  lines: string[]
}

export function contextIn(text: string, line: number, radius: number): Context {
  const lines = text.split('\n')
  const start = Math.max(0, line - radius)
  return { lines: lines.slice(start, line + radius + 1), start }
}

const DEFAULT_LIMIT = 200

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
  limit = DEFAULT_LIMIT
): Match[] {
  if (!query) {
    return []
  }
  const pattern = buildQuery(query, options)
  if (!pattern) {
    return []
  }
  const matches: Match[] = []

  const lines = text.split('\n')
  for (let line = 0; line < lines.length && matches.length < limit; line += 1) {
    const raw = lines[line]!
    pattern.lastIndex = 0
    for (
      let hit = pattern.exec(raw);
      hit && matches.length < limit;
      hit = pattern.exec(raw)
    ) {
      // `a*` matches the empty string at every column; stepping past is what keeps this finite.
      if (hit[0].length === 0) {
        pattern.lastIndex += 1
        continue
      }
      matches.push({
        col: hit.index,
        length: hit[0].length,
        line,
        path,
        text: raw,
      })
    }
  }
  return matches
}

// Ignore rules are picked up per repository: ignoredPaths(root) is empty for a folder of checkouts.
function* filesUnder(root: string): Generator<string> {
  const queue: [dir: string, ignored: Set<string>][] = [
    [root, ignoredPaths(root)],
  ]
  // Real paths of the directories already queued: a symlink loop would otherwise walk forever.
  const seen = new Set<string>([realPath(root)])
  while (queue.length > 0) {
    const [dir, ignored] = queue.shift()!
    for (const node of listDir(dir)) {
      if (ignored.has(node.path)) {
        continue
      }
      if (node.isDir) {
        if (SKIPPED_DIRS.has(node.name)) {
          continue
        }
        const real = realPath(node.path)
        if (seen.has(real)) {
          continue
        }
        seen.add(real)
        queue.push([
          node.path,
          isRepoRoot(node.path) ? ignoredPaths(node.path) : ignored,
        ])
      } else {
        yield node.path
      }
    }
  }
}

export function searchProject(
  root: string,
  query: string,
  options: SearchOptions = {},
  limit = DEFAULT_LIMIT,
  buffers?: ReadonlyMap<string, string>
): Match[] {
  if (!query) {
    return []
  }
  const matches: Match[] = []

  for (const path of filesUnder(root)) {
    if (matches.length >= limit) {
      break
    }
    let content: string
    const open = buffers?.get(path)
    if (open === null || open === undefined) {
      try {
        content = readFile(path)
      } catch {
        continue
      }
    } else {
      content = open
    }
    matches.push(
      ...searchText(content, query, path, options, limit - matches.length)
    )
  }
  return matches
}

export interface ReplaceTarget {
  path: string
  count: number
}

// True counts, not `searchProject`'s: a confirm saying "N matches" must have counted all of them.
export function planProjectReplace(
  root: string,
  query: string,
  options: SearchOptions = {},
  buffers?: ReadonlyMap<string, string>
): { targets: ReplaceTarget[]; matches: number } {
  const targets: ReplaceTarget[] = []
  let matches = 0
  if (!query || !buildQuery(query, options)) {
    return { matches, targets }
  }

  for (const path of filesUnder(root)) {
    let content: string
    const open = buffers?.get(path)
    if (open === null || open === undefined) {
      try {
        content = readFile(path)
      } catch {
        continue
      }
    } else {
      content = open
    }
    const count = searchText(content, query, path, options, Infinity).length
    if (count === 0) {
      continue
    }
    targets.push({ count, path })
    matches += count
  }
  return { matches, targets }
}

interface ReplacedFile {
  path: string
  count: number
  // Buffered paths only: writing the disk copy would hand the watcher an edit the buffer lacks.
  content?: string
}

export interface ReplaceProjectResult {
  replaced: ReplacedFile[]
  matches: number
  failed: string[]
}

// Failures are collected, never thrown: the files before them are already written.
export function replaceProject(
  paths: readonly string[],
  query: string,
  replacement: string,
  options: SearchOptions = {},
  buffers?: ReadonlyMap<string, string>
): ReplaceProjectResult {
  const replaced: ReplacedFile[] = []
  const failed: string[] = []
  let matches = 0

  for (const path of paths) {
    const open = buffers?.get(path)
    if (open !== null && open !== undefined) {
      const count = searchText(open, query, path, options, Infinity).length
      if (count === 0) {
        continue
      }
      replaced.push({
        content: replaceAll(open, query, replacement, options),
        count,
        path,
      })
      matches += count
      continue
    }
    let text: string
    let encoding
    try {
      ;({ text, encoding } = readTextFile(path))
    } catch (error) {
      failed.push(
        `${path} — ${error instanceof Error ? error.message : 'unreadable'}`
      )
      continue
    }
    const count = searchText(text, query, path, options, Infinity).length
    if (count === 0) {
      continue
    }
    // The encoding read is written back: a CRLF or BOM file would otherwise diff on every line.
    const error = writeFile(
      path,
      replaceAll(text, query, replacement, options),
      encoding
    )
    if (error) {
      failed.push(`${path} — ${error}`)
      continue
    }
    replaced.push({ count, path })
    matches += count
  }
  return { failed, matches, replaced }
}

export function fuzzyScore(text: string, query: string): number | null {
  if (!query) {
    return 0
  }
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let score = 0
  let at = -1
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1)
    if (next === -1) {
      return null
    }
    // sums the gaps, so a lower score is a closer match
    score += next - at - 1
    at = next
  }
  return score + text.length - at
}

export function listFiles(root: string, limit = 5000): string[] {
  const files: string[] = []
  for (const path of filesUnder(root)) {
    if (files.length >= limit) {
      break
    }
    files.push(path)
  }
  return files
}

export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): string {
  if (!query) {
    return text
  }
  const pattern = buildQuery(query, options)
  if (!pattern) {
    return text
  }
  // Line by line, as `searchText` counts them: a pattern with `\n` must not reach text no hit showed.
  // Function form, so `$&` and `$1` in the replacement are inserted literally.
  return text
    .split('\n')
    .map((line) =>
      line.replace(pattern, (hit) => (hit.length === 0 ? hit : replacement))
    )
    .join('\n')
}

export function replaceMatch(
  text: string,
  match: Match,
  replacement: string
): string | null {
  const lines = text.split('\n')
  if (lines[match.line] !== match.text) {
    return null
  }
  const line = lines[match.line]!
  lines[match.line] =
    line.slice(0, match.col) +
    replacement +
    line.slice(match.col + match.length)
  return lines.join('\n')
}
