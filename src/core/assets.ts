import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Synchronous throughout: an await here would let `@opentui/core` evaluate before OTUI_ASSET_ROOT is set.

const here = import.meta.filename
const compiled = here.includes('$bunfs') || /^B:[\\/]~BUN/iu.test(here)

function findAssetRoot(): string | null {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i += 1) {
    const nm = join(dir, 'node_modules')
    if (
      existsSync(join(nm, 'web-tree-sitter', 'tree-sitter.wasm')) &&
      existsSync(join(nm, `@opentui/core-${process.platform}-${process.arch}`))
    ) {
      return nm
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  try {
    const wasm = fileURLToPath(
      import.meta.resolve('web-tree-sitter/tree-sitter.wasm')
    )
    return dirname(dirname(wasm))
  } catch {
    return null
  }
}

const NATIVE_FILE: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libopentui.dylib',
  linux: 'libopentui.so',
  win32: 'opentui.dll',
}

type EmbeddedFile = Blob & { name?: string }

function embeddedNativeLibraries(file: string): EmbeddedFile[] {
  const dot = file.lastIndexOf('.')
  const stem = file.slice(0, dot)
  const ext = file.slice(dot)
  const found: EmbeddedFile[] = []
  for (const blob of Bun.embeddedFiles as readonly EmbeddedFile[]) {
    const name = blob.name ?? ''
    if (name === file || (name.startsWith(`${stem}-`) && name.endsWith(ext))) {
      found.push(blob)
    }
  }
  return found
}

function assetKey(): string | null {
  const key = `@opentui/core-${process.platform}-${process.arch}`
  if (process.platform !== 'linux') {
    return key
  }
  const libc = process.env.OPENTUI_LIBC
  if (!libc || libc === 'glibc') {
    return key
  }
  return libc === 'musl' ? `${key}-musl` : null
}

// NUL-terminated as in .dynstr: without it 'libc.so' also matches glibc, and dlopen dies on the wrong library.
const LIBC_NEEDED = { glibc: 'libc.so.6\0', musl: 'libc.so\0' } as const

export async function forLibc<T extends Blob>(
  libs: T[],
  libc: keyof typeof LIBC_NEEDED
): Promise<T | null> {
  const matches: T[] = []
  for (const lib of libs) {
    if (
      Buffer.from(await lib.arrayBuffer()).includes(
        LIBC_NEEDED[libc],
        0,
        'latin1'
      )
    ) {
      matches.push(lib)
    }
  }
  return matches.length === 1 ? matches[0]! : null
}

function cacheHome(): string {
  return process.env.XDG_CACHE_HOME ?? join(os.homedir(), '.cache')
}

function sweepStaleCaches(base: string, keep: string): void {
  try {
    for (const entry of readdirSync(base)) {
      if (entry !== keep) {
        rmSync(join(base, entry), { force: true, recursive: true })
      }
    }
  } catch {
    // best-effort
  }
}

let stagedRoot: string | null = null

function stageCompiledRoot(): void {
  const file = NATIVE_FILE[process.platform]
  const key = assetKey()
  if (!file || !key) {
    return
  }
  try {
    const libs = embeddedNativeLibraries(file)
    const names = libs.map((lib) => lib.name)
    if (!names.length || names.some((name) => !name)) {
      return
    }
    const base = join(cacheHome(), 'druk', 'native')
    const root = join(base, names.toSorted().join('+'))
    const dest = join(root, key, file)
    if (
      existsSync(dest) &&
      libs.some((lib) => statSync(dest).size === lib.size)
    ) {
      process.env.OTUI_ASSET_ROOT = root
      stagedRoot = root
      return
    }
    void (async () => {
      try {
        const wanted =
          process.platform === 'linux'
            ? await forLibc(libs, key.endsWith('-musl') ? 'musl' : 'glibc')
            : libs[0]!
        if (!wanted) {
          return
        }
        mkdirSync(dirname(dest), { recursive: true })
        const tmp = `${dest}.${process.pid}.tmp`
        await Bun.write(tmp, wanted)
        renameSync(tmp, dest)
        sweepStaleCaches(base, root.slice(base.length + 1))
      } catch {
        // best-effort
      }
    })()
  } catch {
    // best-effort
  }
}

if (!process.env.OTUI_ASSET_ROOT) {
  if (compiled) {
    stageCompiledRoot()
  } else {
    const root = findAssetRoot()
    if (root) {
      process.env.OTUI_ASSET_ROOT = root
    }
  }
}

// Must run once `@opentui/core` has imported: the staged root holds only the native library, and
// OpenTUI requires every later asset lookup to exist under OTUI_ASSET_ROOT.
export function releaseAssetRoot(): void {
  if (stagedRoot && process.env.OTUI_ASSET_ROOT === stagedRoot) {
    delete process.env.OTUI_ASSET_ROOT
  }
  stagedRoot = null
}
