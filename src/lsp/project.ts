/**
 * The server a project brings with it, which beats anything installed globally:
 * a repository pinning its tooling means that copy, not whatever the machine
 * happens to have.
 *
 * TypeScript is why this exists at all. Since 7.0 the compiler is the Go port,
 * shipped as a platform binary with no `tsserver.js` — so
 * `typescript-language-server`, whose whole job is to drive one, cannot serve a
 * TypeScript 7 project at all. That compiler speaks LSP itself (`tsc --lsp
 * --stdio`), so the version installed in the project is what decides which of
 * the two servers gets spawned.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where npm, pnpm and bun all put executables for a project. */
const binDir = (rootDir: string) => join(rootDir, 'node_modules', '.bin')

/**
 * The major version of the TypeScript the project installed, or null when it
 * has none — a directory with no `node_modules`, or one that is not a
 * JavaScript project at all.
 */
export function typescriptMajor(rootDir: string): number | null {
  const manifest = join(rootDir, 'node_modules', 'typescript', 'package.json')
  try {
    const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
    const major = Number.parseInt(version ?? '', 10)
    return Number.isNaN(major) ? null : major
  } catch {
    return null // absent, unreadable, or not the manifest we expect
  }
}

/** The first TypeScript whose compiler is the Go port and speaks LSP itself. */
const NATIVE_TYPESCRIPT = 7

/**
 * The command to run `id`'s server out of the project, or null when the project
 * installed none. Callers fall back to druk's own copy and then to PATH.
 */
export function projectCommand(id: string, command: string[], rootDir: string): string[] | null {
  if (id === 'typescript') {
    const major = typescriptMajor(rootDir)
    // Only when the project is on 7: on 5 or 6 `tsc` has no `--lsp` at all, and
    // typescript-language-server is the server that drives it.
    if (major !== null && major >= NATIVE_TYPESCRIPT) {
      const tsc = join(binDir(rootDir), 'tsc')
      if (existsSync(tsc)) return [tsc, '--lsp', '--stdio']
    }
  }
  const [executable, ...args] = command
  if (!executable) return null
  const local = join(binDir(rootDir), executable)
  return existsSync(local) ? [local, ...args] : null
}

/** The npm package that teaches a tsserver to read a single-file component. */
export const VUE_TYPESCRIPT_PLUGIN = '@vue/typescript-plugin'

/**
 * A directory a tsserver can resolve `@vue/typescript-plugin` from: the
 * project's own copy first, then druk's install prefix. Null when neither holds
 * one — better than naming a path the plugin is not at, which tsserver reports
 * only into its own log.
 *
 * A *prefix*, not the package directory. tsserver resolves a plugin the way node
 * resolves a module, appending `node_modules` to the location and then to each
 * of its parents, so what it wants is the directory `node_modules` sits in.
 */
export function vuePluginLocation(rootDir: string, installRoot: string): string | null {
  const prefixes = [rootDir, installRoot]
  return (
    prefixes.find(prefix => existsSync(join(prefix, 'node_modules', VUE_TYPESCRIPT_PLUGIN))) ?? null
  )
}
