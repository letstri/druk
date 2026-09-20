import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const QUOTES = new Set(['"', "'", '`'])

const PATH_CHAR = /[\w@~./\\#$+-]/

/** Source before compiled output, so `./foo` lands on `foo.ts` and not a built `foo.js`. */
const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.json',
  '.css',
  '.scss',
  '.md',
]

const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function quotedAt(lineText: string, col: number): string | null {
  for (let at = 0; at < lineText.length; at++) {
    const quote = lineText[at]!
    if (!QUOTES.has(quote)) continue
    const close = lineText.indexOf(quote, at + 1)
    if (close < 0) return null
    // Inclusive of both quotes: the caret sits *before* its character.
    if (col >= at && col <= close) return lineText.slice(at + 1, close)
    at = close
  }
  return null
}

export function pathTokenAt(lineText: string, col: number): string | null {
  const quoted = quotedAt(lineText, col)
  if (quoted !== null) return quoted.trim() || null

  const at = Math.max(0, Math.min(col, lineText.length))
  let start = at
  while (start > 0 && PATH_CHAR.test(lineText[start - 1]!)) start--
  let end = at
  while (end < lineText.length && PATH_CHAR.test(lineText[end]!)) end++
  // Sentence punctuation is the prose's: `see src/core/fs.ts.` names a file that exists.
  const token = lineText.slice(start, end).replace(/[.,;:]+$/, '')
  return token || null
}

function fileAt(candidate: string): string | null {
  if (isFile(candidate)) return candidate
  for (const ext of EXTENSIONS) {
    if (isFile(candidate + ext)) return candidate + ext
  }
  for (const ext of EXTENSIONS) {
    const index = join(candidate, `index${ext}`)
    if (isFile(index)) return index
  }
  return null
}

type Json = Record<string, unknown>

const objectAt = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null

// One pass: a regex stripping comments would gut a string holding a slash pair.
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!
    if (inString) {
      out += char
      if (char === '\\') out += text[++at] ?? ''
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at++
      out += '\n'
      continue
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      at = end < 0 ? text.length : end + 1
      continue
    }
    if (
      char === ',' &&
      (nextMeaningful(text, at + 1) === '}' || nextMeaningful(text, at + 1) === ']')
    )
      continue
    out += char
  }
  return JSON.parse(out)
}

function nextMeaningful(text: string, from: number): string {
  for (let at = from; at < text.length; at++) {
    const char = text[at]!
    if (/\s/.test(char)) continue
    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at++
      continue
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      if (end < 0) return ''
      at = end + 1
      continue
    }
    return char
  }
  return ''
}

interface Aliases {
  base: string
  paths: Record<string, string[]>
  baseUrl: string | null
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const list = value.filter((entry): entry is string => typeof entry === 'string')
  return list.length > 0 ? list : null
}

// Only a relative `extends` is followed: a package name would mean walking node_modules.
function loadAliases(file: string, depth = 0): Aliases | null {
  if (depth > 4 || !isFile(file)) return null
  let json: unknown
  try {
    json = parseJsonc(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const root = objectAt(json)
  if (!root) return null
  const dir = dirname(file)
  const options = objectAt(root.compilerOptions) ?? {}
  const baseUrl = typeof options.baseUrl === 'string' ? resolve(dir, options.baseUrl) : null
  const declared = objectAt(options.paths)
  const paths: Record<string, string[]> = {}
  for (const [pattern, targets] of Object.entries(declared ?? {})) {
    const list = stringList(targets)
    if (list) paths[pattern] = list
  }
  if (Object.keys(paths).length > 0 || baseUrl) {
    return { base: baseUrl ?? dir, paths, baseUrl }
  }
  const extend = root.extends
  if (typeof extend !== 'string' || !extend.startsWith('.')) return null
  // `extends: "./tsconfig.base"` already has an extname; the file is tsconfig.base.json.
  const parent = resolve(dir, extend.endsWith('.json') ? extend : `${extend}.json`)
  return loadAliases(parent, depth + 1)
}

function aliasCandidates(spec: string, rootDir: string): string[] {
  const aliases =
    loadAliases(join(rootDir, 'tsconfig.json')) ?? loadAliases(join(rootDir, 'jsconfig.json'))
  if (!aliases) return []
  const candidates: { length: number; path: string }[] = []
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const star = pattern.indexOf('*')
    if (star < 0) {
      if (pattern === spec) {
        candidates.push(...targets.map(target => ({ length: pattern.length, path: target })))
      }
      continue
    }
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue
    if (spec.length < prefix.length + suffix.length) continue
    const middle = spec.slice(prefix.length, spec.length - suffix.length)
    candidates.push(
      ...targets.map(target => ({ length: prefix.length, path: target.replace('*', middle) })),
    )
  }
  const resolved = candidates
    .toSorted((a, b) => b.length - a.length)
    .map(candidate => resolve(aliases.base, candidate.path))
  if (aliases.baseUrl) resolved.push(resolve(aliases.baseUrl, spec))
  return resolved
}

export function resolveImportPath(spec: string, fromDir: string, rootDir: string): string | null {
  const token = spec.trim()
  if (!token || URL_SCHEME.test(token)) return null

  const direct = token.startsWith('~/')
    ? [join(homedir(), token.slice(2))]
    : isAbsolute(token)
      ? [token]
      : [resolve(fromDir, token), resolve(rootDir, token)]
  for (const candidate of direct) {
    const found = fileAt(candidate)
    if (found) return found
  }

  // An alias never starts with `.` or `/`: those forms have had their answer.
  if (token.startsWith('.') || token.startsWith('~/') || isAbsolute(token)) return null
  for (const candidate of aliasCandidates(token, rootDir)) {
    const found = fileAt(candidate)
    if (found) return found
  }
  return null
}

const SPECIFIER_LINE = /\b(?:import|require|export|from)\b/

/**
 * Whether `goto.file` has anything to follow here — the footer's cue, so no disk access:
 * a bare specifier (`'bun'`) resolves through the language server and cannot be checked.
 */
export function hasPathAt(lineText: string, col: number): boolean {
  const token = pathTokenAt(lineText, col)
  if (!token || /\s/.test(token)) return false
  if (token.includes('/') || token.includes('\\')) return true
  return quotedAt(lineText, col) !== null && SPECIFIER_LINE.test(lineText)
}
