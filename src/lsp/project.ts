// TypeScript 7 is the Go port: no `tsserver.js`, but `tsc --lsp --stdio` speaks LSP itself.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// npm's bare-name launcher is a sh script; only the `.cmd` spawns on Windows.
function binIn(dir: string, name: string): string | null {
  for (const candidate of process.platform === 'win32' ? [`${name}.cmd`, name] : [name]) {
    const path = join(dir, 'node_modules', '.bin', candidate)
    if (existsSync(path)) return path
  }
  return null
}

// The nearest `node_modules` above the *file*, not `rootDir`: tooling may live elsewhere.
function candidates(rootDir: string, from: string): string[] {
  const dirs: string[] = []
  for (let dir = from; ; dir = dirname(dir)) {
    dirs.push(dir)
    if (dirname(dir) === dir) break
  }
  if (!dirs.includes(rootDir)) dirs.push(rootDir)
  return dirs
}

const majorOf = (manifest: string): number | null => {
  try {
    const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
    const major = Number.parseInt(version ?? '', 10)
    return Number.isNaN(major) ? null : major
  } catch {
    return null
  }
}

export function typescriptMajor(dir: string): number | null {
  return majorOf(join(dir, 'node_modules', 'typescript', 'package.json'))
}

const NATIVE_TYPESCRIPT = 7

// The Go compiler before 7.0: a separate package whose `tsgo` speaks the same `--lsp`.
const NATIVE_PREVIEW = '@typescript/native-preview'

function nativeTypescript(dir: string): string[] | null {
  const major = typescriptMajor(dir)
  // On 5 or 6 `tsc` has no `--lsp` at all.
  if (major !== null && major >= NATIVE_TYPESCRIPT) {
    const tsc = binIn(dir, 'tsc')
    if (tsc) return [tsc, '--lsp', '--stdio']
  }
  if (existsSync(join(dir, 'node_modules', NATIVE_PREVIEW, 'package.json'))) {
    const tsgo = binIn(dir, 'tsgo')
    if (tsgo) return [tsgo, '--lsp', '--stdio']
  }
  return null
}

export function projectCommand(
  id: string,
  command: string[],
  rootDir: string,
  from = rootDir,
): string[] | null {
  const [executable, ...args] = command
  if (!executable) return null
  for (const dir of candidates(rootDir, from)) {
    if (id === 'typescript') {
      const native = nativeTypescript(dir)
      if (native) return native
    }
    const local = binIn(dir, executable)
    if (local) return [local, ...args]
  }
  return null
}

export const VUE_TYPESCRIPT_PLUGIN = '@vue/typescript-plugin'

// A *prefix*, not the package directory: tsserver appends `node_modules` to the location itself.
export function vuePluginLocation(rootDir: string, installRoot: string): string | null {
  const prefixes = [rootDir, installRoot]
  return (
    prefixes.find(prefix => existsSync(join(prefix, 'node_modules', VUE_TYPESCRIPT_PLUGIN))) ?? null
  )
}
