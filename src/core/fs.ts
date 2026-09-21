import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { errorMessage } from './errors'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  depth: number
  symlink?: boolean
}

const VCS_DIRS = new Set(['.git', '.svn', '.hg', '.jj'])

// Watching all of `.git` loops on itself: git status rewrites `.git/index` → watcher → status.
const UNWATCHED = new RegExp(
  `(?:^|[/\\\\])(?:${[...VCS_DIRS].map((dir) => dir.replace('.', '\\.')).join('|')})(?:[/\\\\]|$)`,
  'u'
)

const DEPENDENCY_DIRS = ['node_modules', 'vendor', '.venv', 'venv']

const DEPENDENCIES = new RegExp(
  `(?:^|[/\\\\])(?:${DEPENDENCY_DIRS.map((dir) => dir.replace('.', '\\.')).join('|')})(?:[/\\\\]|$)`,
  'u'
)

export interface Changed {
  tree: boolean
  git: boolean
  deps: boolean
}

// A recursive watch reports a directory it cannot add (ENOSPC) as an `error`, thrown at the process
// if unhandled.
export function watchPath(
  path: string,
  options: fs.WatchOptions,
  listener: (event: fs.WatchEventType, filename: string | Buffer | null) => void
): fs.FSWatcher | null {
  try {
    const watcher = fs.watch(path, options, listener)
    watcher.on('error', () => watcher.close())
    return watcher
  } catch {
    return null
  }
}

export function watchTree(
  root: string,
  onChange: (changed: Changed) => void
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const empty = (): Changed => ({ deps: false, git: false, tree: false })
  let pending = empty()

  const schedule = (...kinds: (keyof Changed)[]) => {
    if (kinds.length === 0) {
      return
      // a filtered-out event, not a quiet one
    }
    for (const kind of kinds) {
      pending[kind] = true
    }
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      const changed = pending
      pending = empty()
      onChange(changed)
      // coalesce bursts
    }, 80)
  }

  const watchers: fs.FSWatcher[] = []
  const watch = (
    path: string,
    options: fs.WatchOptions,
    classify: (name: string | undefined) => (keyof Changed)[]
  ) => {
    const watcher = watchPath(path, options, (_event, filename) =>
      schedule(...classify(filename?.toString()))
    )
    if (watcher) {
      watchers.push(watcher)
    }
  }

  watch(root, { recursive: true }, (name) => {
    if (!name) {
      return ['tree']
    }
    if (UNWATCHED.test(name)) {
      return []
    }
    return DEPENDENCIES.test(name) ? ['tree', 'deps'] : ['tree']
  })

  const stopGit = watchGitRefs(root, () => schedule('git'))

  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    stopGit()
    for (const watcher of watchers) {
      watcher.close()
    }
  }
}

// HEAD and refs only: macOS coalesces everything under `.git` to `index.lock`, which git status
// rewrites, so a watch on the directory feeds itself.
export function watchGitRefs(repo: string, onChange: () => void): () => void {
  const watchers: fs.FSWatcher[] = []
  const watch = (path: string, options: fs.WatchOptions) => {
    const watcher = watchPath(path, options, () => onChange())
    if (watcher) {
      watchers.push(watcher)
    }
  }
  const gitDir = join(repo, '.git')
  watch(join(gitDir, 'HEAD'), {})
  watch(join(gitDir, 'refs'), { recursive: true })
  return () => {
    for (const watcher of watchers) {
      watcher.close()
    }
  }
}

export function listDir(dir: string, depth = 0): TreeNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !(e.isDirectory() && VCS_DIRS.has(e.name)))
    .map((e) => {
      const path = join(dir, e.name)
      if (!e.isSymbolicLink()) {
        return { depth, isDir: e.isDirectory(), name: e.name, path }
      }
      // A dirent describes the link itself, so a symlinked directory answers isDirectory() false.
      let isDir = false
      try {
        isDir = fs.statSync(path).isDirectory()
      } catch {
        // broken link
      }
      return { depth, isDir, name: e.name, path, symlink: true }
    })
    .toSorted((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
}

function realPath(path: string): string {
  try {
    return fs.realpathSync(path)
  } catch {
    return path
  }
}

export function flattenVisible(
  root: string,
  expanded: Set<string>,
  hidden?: (node: TreeNode) => boolean
): TreeNode[] {
  const out: TreeNode[] = []
  // Real paths of the branch being walked: a symlink into an ancestor would recurse forever.
  const branch = new Set<string>()
  const walk = (dir: string, depth: number) => {
    const real = realPath(dir)
    if (branch.has(real)) {
      return
    }
    branch.add(real)
    for (const node of listDir(dir, depth)) {
      if (hidden?.(node)) {
        continue
      }
      out.push(node)
      if (node.isDir && expanded.has(node.path)) {
        walk(node.path, depth + 1)
      }
    }
    branch.delete(real)
  }
  walk(root, 0)
  return out
}

export class BinaryFileError extends Error {
  constructor() {
    super('binary file')
    this.name = 'BinaryFileError'
  }
}

export interface TextEncoding {
  eol: '\n' | '\r\n'
  bom: boolean
}

export const DEFAULT_ENCODING: TextEncoding = { bom: false, eol: '\n' }

const countOf = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

export function decodeText(raw: string): {
  text: string
  encoding: TextEncoding
} {
  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  // Majority, not first-wins: one stray CRLF must not convert the whole file on the next save.
  const crlf = countOf(body, '\r\n')
  const eol = crlf > 0 && crlf * 2 >= countOf(body, '\n') ? '\r\n' : '\n'
  return {
    encoding: { bom, eol },
    text: eol === '\r\n' ? body.replaceAll('\r\n', '\n') : body,
  }
}

export function encodeText(text: string, encoding: TextEncoding): string {
  // Normalize first: a paste can carry CRLF into an LF buffer, and `\n` → `\r\n` would double its CRs.
  const lf = text.includes('\r\n') ? text.replaceAll('\r\n', '\n') : text
  const body = encoding.eol === '\r\n' ? lf.replaceAll('\n', '\r\n') : lf
  return encoding.bom ? `\uFEFF${body}` : body
}

const SNIFF = 8192
const NUL_HEADER = 512
const NUL_DENSITY = 0.01

// Positional read, not a whole-file slice: a 2 GB video would throw ERR_FS_FILE_TOO_LARGE first.
export function readTextFile(path: string): {
  text: string
  encoding: TextEncoding
} {
  const fd = fs.openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(SNIFF)
    const read = fs.readSync(fd, buffer, 0, SNIFF, 0)
    const head = buffer.subarray(0, read)
    if (head.subarray(0, NUL_HEADER).includes(0)) {
      throw new BinaryFileError()
    }
    let nuls = 0
    for (const byte of head) {
      if (byte === 0) {
        nuls += 1
      }
    }
    if (nuls > 0 && nuls >= read * NUL_DENSITY) {
      throw new BinaryFileError()
    }
  } finally {
    fs.closeSync(fd)
  }
  return decodeText(fs.readFileSync(path, 'utf-8'))
}

export function readFile(path: string): string {
  return readTextFile(path).text
}

export function sizeOf(path: string): number {
  try {
    return fs.statSync(path).size
  } catch {
    return 0
  }
}

export function mtimeOf(path: string): number {
  try {
    return fs.statSync(path).mtimeMs
  } catch {
    return 0
  }
}

export function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function exists(path: string): boolean {
  return fs.existsSync(path)
}

export type FsResult = string | null

const attempt = (run: () => void): FsResult => {
  try {
    run()
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

const taken = (path: string): FsResult =>
  fs.existsSync(path) ? `already exists: ${basename(path)}` : null

export const writeFile = (
  path: string,
  content: string,
  encoding: TextEncoding = DEFAULT_ENCODING
): FsResult =>
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, encodeText(content, encoding), 'utf-8')
  })

export const createFile = (path: string): FsResult =>
  taken(path) ??
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, '', 'utf-8')
  })

export const createDir = (path: string): FsResult =>
  taken(path) ??
  attempt(() => {
    fs.mkdirSync(path, { recursive: true })
  })

export const rename = (from: string, to: string): FsResult =>
  taken(to) ??
  attempt(() => {
    fs.mkdirSync(dirname(to), { recursive: true })
    fs.renameSync(from, to)
  })

export function freePath(dir: string, name: string): string {
  if (!fs.existsSync(join(dir, name))) {
    return join(dir, name)
  }
  const dot = name.lastIndexOf('.')
  // `dot > 0`: a leading dot is a dotfile's whole name, not an extension.
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n += 1) {
    const candidate = join(dir, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!fs.existsSync(candidate)) {
      return candidate
    }
  }
}
