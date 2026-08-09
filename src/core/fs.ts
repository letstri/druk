import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { errorMessage } from './errors'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  depth: number
  /** Points elsewhere: shown with a mark, opened as whatever it resolves to. */
  symlink?: boolean
}

/**
 * A version control system's own storage. Not project content: nothing in here is
 * meant to be browsed, searched or edited, and `.git` alone can hold more files than
 * everything else put together. Left out of every listing, and — with the exceptions
 * below — out of the watcher too.
 *
 * Ordinary dotfiles are *not* in this class. `.gitignore`, `.env` and `.github/` are
 * files someone wrote and will want to open.
 */
export const VCS_DIRS = new Set(['.git', '.svn', '.hg', '.jj'])

/**
 * The same list as a path matcher, for the watcher. Reading git status refreshes
 * `.git/index`, so watching all of `.git` closes a loop on itself: status → index
 * write → watcher → status, forever, at whatever rate the debounce allows.
 */
const UNWATCHED = new RegExp(
  // The leading dot has to be escaped, or `.git` would also match `agit`.
  `(?:^|[/\\\\])(?:${[...VCS_DIRS].map(dir => dir.replace('.', '\\.')).join('|')})(?:[/\\\\]|$)`,
)

/**
 * Where a package manager puts what it installed. Reported apart because a
 * language server resolves imports through these directories and reads them
 * once, at startup: a `bun install` run in another terminal is invisible to it
 * until it is restarted.
 */
const DEPENDENCY_DIRS = ['node_modules', 'vendor', '.venv', 'venv']

const DEPENDENCIES = new RegExp(
  `(?:^|[/\\\\])(?:${DEPENDENCY_DIRS.map(dir => dir.replace('.', '\\.')).join('|')})(?:[/\\\\]|$)`,
)

/** What a debounced burst of events touched. More than one can be true for a burst. */
export interface Changed {
  /** A file in the working tree. */
  tree: boolean
  /** `HEAD` or a ref moved: a commit, checkout or reset happened. */
  git: boolean
  /** Installed dependencies were written — an install, an update, a removal. */
  deps: boolean
}

/**
 * Watch `root` and call `onChange` (debounced) on any file event. Returns a stop
 * function. Best-effort — an unwatchable path is simply left unwatched.
 *
 * The kinds are reported apart because they cost different things to react to.
 * Re-reading ahead/behind is two subprocesses, and only history moving can change
 * it — running that on every keystroke-triggered save would be pure waste. A
 * dependency write costs a language server restart, which is dearer still.
 */
export function watchTree(root: string, onChange: (changed: Changed) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const empty = (): Changed => ({ tree: false, git: false, deps: false })
  let pending = empty()

  const schedule = (...kinds: (keyof Changed)[]) => {
    if (kinds.length === 0) return // a filtered-out event, not a quiet one
    for (const kind of kinds) pending[kind] = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const changed = pending
      pending = empty()
      onChange(changed)
    }, 80) // coalesce bursts of events
  }

  const watchers: fs.FSWatcher[] = []
  const watch = (
    path: string,
    options: fs.WatchOptions,
    classify: (name: string | undefined) => (keyof Changed)[],
  ) => {
    try {
      watchers.push(
        fs.watch(path, options, (_event, filename) => schedule(...classify(filename?.toString()))),
      )
    } catch {
      // best-effort: this path just goes unwatched
    }
  }

  watch(root, { recursive: true }, name => {
    if (!name) return ['tree']
    if (UNWATCHED.test(name)) return []
    // A dependency write is a tree write as well: the file tree lists
    // node_modules like any other directory, and it has just appeared.
    return DEPENDENCIES.test(name) ? ['tree', 'deps'] : ['tree']
  })

  const stopGit = watchGitRefs(root, () => schedule('git'))

  return () => {
    if (timer) clearTimeout(timer)
    stopGit()
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * Report a commit, checkout, reset or pack-refs in `repo`. Returns a stop
 * function; best-effort, so a directory that is not a repository simply goes
 * unwatched.
 *
 * Its own watchers, because a recursive watch on the working tree cannot cover
 * this. A commit or a checkout made in another terminal changes no working-tree
 * file at all, so without these the tree marks, the changed count and the branch
 * sit stale — and the recursive watch is no help: macOS coalesces everything
 * under `.git` down to `.git/index.lock`, which is precisely the file a plain
 * `git status` rewrites, so reacting to it would feed the watcher its own tail
 * forever.
 *
 * Watching HEAD and the refs directly reports all four — and, verified, nothing
 * that reading status does.
 */
export function watchGitRefs(repo: string, onChange: () => void): () => void {
  const watchers: fs.FSWatcher[] = []
  const watch = (path: string, options: fs.WatchOptions) => {
    try {
      watchers.push(fs.watch(path, options, () => onChange()))
    } catch {
      // best-effort: this path just goes unwatched
    }
  }
  const gitDir = join(repo, '.git')
  watch(join(gitDir, 'HEAD'), {})
  watch(join(gitDir, 'refs'), { recursive: true })
  return () => {
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * Directory entries, folders first then files, each alphabetical.
 *
 * Everything the directory holds, bar the VCS store: hiding a file the user can
 * see in their shell is a worse answer than showing it and refusing to open what
 * cannot be displayed. The opt-in dotfile/gitignore filters live in
 * `flattenVisible`, so every direct caller (project search, the fuzzy picker)
 * still sees the filesystem's truth.
 */
export function listDir(dir: string, depth = 0): TreeNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => !(e.isDirectory() && VCS_DIRS.has(e.name)))
    .map(e => {
      const path = join(dir, e.name)
      if (!e.isSymbolicLink()) return { name: e.name, path, isDir: e.isDirectory(), depth }
      // A dirent describes the link itself, so a symlinked directory answers
      // isDirectory() false — and the tree then tries to read it as a file.
      let isDir = false
      try {
        isDir = fs.statSync(path).isDirectory()
      } catch {
        // Broken link: nothing to resolve, so leave it looking like a file.
      }
      return { name: e.name, path, isDir, depth, symlink: true }
    })
    .toSorted((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** Where a path really lives, or the path itself when it cannot be resolved. */
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
  /** Rows to leave out. A hidden directory is also never descended into. */
  hidden?: (node: TreeNode) => boolean,
): TreeNode[] {
  const out: TreeNode[] = []
  // Real paths of the branch being walked. A symlink pointing at one of its own
  // ancestors is a cycle, and expanding into it would never come back.
  const branch = new Set<string>()
  const walk = (dir: string, depth: number) => {
    const real = realPath(dir)
    if (branch.has(real)) return
    branch.add(real)
    for (const node of listDir(dir, depth)) {
      if (hidden?.(node)) continue
      out.push(node)
      if (node.isDir && expanded.has(node.path)) walk(node.path, depth + 1)
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

/**
 * How a file's text was spelled on disk, so a save can put it back that way.
 *
 * druk holds text as LF without a BOM, because that is the only shape that
 * survives the edit buffer: OpenTUI's Zig core drops the `\r` of a CRLF break
 * and rejoins lines with `\n`, and `TextDecoder` eats a leading BOM. Keeping the
 * raw text in the buffer instead would mean every CRLF or BOM file came back
 * from the engine different from what was read, which reads as an edit — a file
 * dirty the moment it opened, and a save that rewrote every line of it.
 */
export interface TextEncoding {
  eol: '\n' | '\r\n'
  bom: boolean
}

export const DEFAULT_ENCODING: TextEncoding = { eol: '\n', bom: false }

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1

/** Strip the BOM and the CRs, reporting what was taken off so a write can restore it. */
export function decodeText(raw: string): { text: string; encoding: TextEncoding } {
  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  // Majority rather than first-break-wins: one stray CRLF in an LF file must not
  // convert the whole file on the next save, and the same the other way round.
  const crlf = countOf(body, '\r\n')
  const eol = crlf > 0 && crlf * 2 >= countOf(body, '\n') ? '\r\n' : '\n'
  return { text: eol === '\r\n' ? body.replaceAll('\r\n', '\n') : body, encoding: { eol, bom } }
}

/** Put back what `decodeText` took off. */
export function encodeText(text: string, encoding: TextEncoding): string {
  // Normalized first, not converted straight to `eol`: a paste can carry CRLF into
  // an LF buffer, and `\n` → `\r\n` over that text would double every CR.
  const lf = text.includes('\r\n') ? text.replaceAll('\r\n', '\n') : text
  const body = encoding.eol === '\r\n' ? lf.replaceAll('\n', '\r\n') : lf
  return encoding.bom ? `\uFEFF${body}` : body
}

const SNIFF = 8192
/**
 * How far in a real binary format is allowed to hide its first NUL. Every one of
 * them puts a length, a magic number or a padded field near the top — PNG at byte
 * 8, JPEG at 4, wasm at 1, gzip at 3, tar in its padded name field, UTF-16 at 1 —
 * so a window this small catches them all while leaving a stray NUL deep inside
 * an otherwise-text file alone. VS Code sniffs 512 bytes for the same reason.
 */
const NUL_HEADER = 512
/**
 * NUL share of the sniffed bytes that says binary even with a text-looking header.
 * Compressed content averages 1/256 zero bytes (~0.4%), so this sits above the
 * noise a header-less deflate stream would produce and far above what a text file
 * carrying a sentinel or two ever reaches.
 */
const NUL_DENSITY = 0.01

/**
 * Read a text file with the BOM and the CRs taken off, reporting both so a save
 * can put them back, and refusing binary content.
 *
 * Deliberately *not* git's rule — a NUL anywhere in the first 8 KB. A source file
 * with one NUL in a string literal is text that every other editor opens, and
 * refusing all of it over one byte is the worse answer; git only has to decide
 * whether to print a diff. So: a NUL in the header, or NULs dense enough to be
 * data rather than a stray.
 *
 * The sniff is a positional read rather than a slice of the whole file: the tree
 * happily offers a 2 GB video, and reading it before rejecting it would allocate
 * all of it and throw ERR_FS_FILE_TOO_LARGE instead of BinaryFileError.
 */
export function readTextFile(path: string): { text: string; encoding: TextEncoding } {
  const fd = fs.openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(SNIFF)
    const read = fs.readSync(fd, buffer, 0, SNIFF, 0)
    const head = buffer.subarray(0, read)
    if (head.subarray(0, NUL_HEADER).includes(0)) throw new BinaryFileError()
    let nuls = 0
    for (const byte of head) if (byte === 0) nuls++
    if (nuls > 0 && nuls >= read * NUL_DENSITY) throw new BinaryFileError()
  } finally {
    fs.closeSync(fd)
  }
  return decodeText(fs.readFileSync(path, 'utf8'))
}

/** As `readTextFile`, for the readers with nothing to write back. */
export function readFile(path: string): string {
  return readTextFile(path).text
}

/** Size in bytes, or 0 when the file is missing/unreadable. */
export function sizeOf(path: string): number {
  try {
    return fs.statSync(path).size
  } catch {
    return 0
  }
}

/** Last-modified time in ms, or 0 when the file is missing/unreadable. */
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

/** Result helper: `null` on success, otherwise a human-readable message. */
export type FsResult = string | null

const attempt = (run: () => void): FsResult => {
  try {
    run()
    return null
  } catch (e) {
    return errorMessage(e)
  }
}

const taken = (path: string): FsResult =>
  fs.existsSync(path) ? `already exists: ${basename(path)}` : null

export const writeFile = (
  path: string,
  content: string,
  encoding: TextEncoding = DEFAULT_ENCODING,
): FsResult =>
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, encodeText(content, encoding), 'utf8')
  })

export const createFile = (path: string): FsResult =>
  taken(path) ??
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, '', 'utf8')
  })

export const createDir = (path: string): FsResult =>
  taken(path) ?? attempt(() => void fs.mkdirSync(path, { recursive: true }))

export const remove = (path: string): FsResult =>
  attempt(() => fs.rmSync(path, { recursive: true, force: true }))

export const rename = (from: string, to: string): FsResult =>
  taken(to) ??
  attempt(() => {
    fs.mkdirSync(dirname(to), { recursive: true })
    fs.renameSync(from, to)
  })

export const copy = (from: string, to: string): FsResult =>
  taken(to) ??
  attempt(() => {
    fs.mkdirSync(dirname(to), { recursive: true })
    // `errorOnExist` with `force: false` so a race that creates the destination
    // between the check above and here fails loudly instead of overwriting it.
    fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true })
  })

/**
 * `dir/name`, or the first `name copy`, `name copy 2`, … that nothing occupies.
 *
 * Pasting a copy beside the original is the ordinary case, so a free name has to be
 * found rather than refused — and the suffix goes before the extension, where the
 * eye expects it and where tooling still sees a `.ts` file.
 */
export function freePath(dir: string, name: string): string {
  if (!fs.existsSync(join(dir, name))) return join(dir, name)
  const dot = name.lastIndexOf('.')
  // A leading dot is the whole name of a dotfile, not an extension.
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = join(dir, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
}
