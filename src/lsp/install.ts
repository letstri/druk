import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { firstLine, notInstalled, run } from '../core/process'
import type { ProcessResult } from '../core/process'
import type { ServerInstall } from './servers'

const INSTALL_TIMEOUT_MS = 180_000

export type PackageManager = 'npm' | 'bun' | 'pnpm'

// Best first (the choice modal's cursor). No yarn: Berry writes no `node_modules`.
const MANAGERS: PackageManager[] = ['npm', 'bun', 'pnpm']

const MANAGER_FILE = '.manager'

export const SERVER_ROOT = join(
  process.env.XDG_DATA_HOME ?? join(os.homedir(), '.local', 'share'),
  'druk',
  'lsp'
)

export function availablePackageManagers(root = SERVER_ROOT): PackageManager[] {
  if (!which('node')) {
    return []
  }
  const chosen = savedManager(root)
  if (chosen) {
    return which(chosen) ? [chosen] : []
  }
  return MANAGERS.filter((manager) => which(manager))
}

// `Bun.which` reads the real environment, not `process.env`, so PATH is handed over.
function which(bin: string): string | null {
  return Bun.which(bin, { PATH: process.env.PATH ?? '' })
}

function savedManager(root: string): PackageManager | null {
  try {
    const saved = readFileSync(join(root, MANAGER_FILE), 'utf-8').trim()
    return MANAGERS.find((manager) => manager === saved) ?? null
  } catch {
    return null
  }
}

function rememberManager(root: string, manager: PackageManager): void {
  try {
    writeFileSync(join(root, MANAGER_FILE), manager)
  } catch {
    // the next removal falls back to npm
  }
}

// npm prunes a package the manifest omits, so an existing manifest is backfilled and not just a missing one.
function ensureManifest(root: string): void {
  const manifest = join(root, 'package.json')
  let raw = ''
  let body: Record<string, unknown> = {
    name: 'druk-language-servers',
    private: true,
    version: '0.0.0',
  }
  try {
    raw = readFileSync(manifest, 'utf-8')
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // absent or unreadable
  }
  const declared = (body.dependencies ?? {}) as Record<string, string>
  const dependencies = { ...installedPackages(root), ...declared }
  const next = `${JSON.stringify({ ...body, dependencies }, null, 2)}\n`
  if (next === raw) {
    return
  }
  try {
    writeFileSync(manifest, next)
  } catch {
    // the manager prunes, and the servers it takes are offered again next launch
  }
}

function installedPackages(root: string): Record<string, string> {
  const modules = join(root, 'node_modules')
  const found: Record<string, string> = {}
  const add = (dir: string) => {
    try {
      const { name, version } = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf-8')
      )
      if (typeof name === 'string' && typeof version === 'string') {
        found[name] = version
      }
    } catch {
      // not a package
    }
  }
  for (const entry of readdirOrNone(modules)) {
    if (entry.startsWith('.')) {
      continue
    }
    if (entry.startsWith('@')) {
      for (const scoped of readdirOrNone(join(modules, entry))) {
        add(join(modules, entry, scoped))
      }
      continue
    }
    add(join(modules, entry))
  }
  return found
}

function readdirOrNone(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// No `--no-save`: npm prunes what the manifest omits, and bun/pnpm need the entry for `remove`.
const INSTALL_ARGS: Record<PackageManager, (root: string) => string[]> = {
  bun: (root) => ['add', '--cwd', root],
  npm: (root) => ['install', '--prefix', root, '--no-audit', '--no-fund'],
  pnpm: (root) => ['add', '--dir', root],
}

const REMOVE_ARGS: Record<PackageManager, (root: string) => string[]> = {
  bun: (root) => ['remove', '--cwd', root],
  npm: (root) => ['uninstall', '--prefix', root, '--no-audit', '--no-fund'],
  pnpm: (root) => ['remove', '--dir', root],
}

function failureOf(
  result: ProcessResult,
  manager: PackageManager
): string | null {
  if (result.error) {
    return notInstalled(result)
      ? `${manager} is not installed, or not on PATH`
      : result.error.message
  }
  if (result.timedOut) {
    return `${manager} timed out`
  }
  if (result.status === 0) {
    return null
  }
  return (
    firstLine(result.stderr) || `${manager} exited with code ${result.status}`
  )
}

export function installedCommand(
  command: string[],
  root = SERVER_ROOT
): string[] | null {
  const [executable, ...args] = command
  if (!executable) {
    return null
  }
  // npm's bare-name launcher is a sh script; only the `.cmd` spawns on Windows.
  for (const name of process.platform === 'win32'
    ? [`${executable}.cmd`, executable]
    : [executable]) {
    const local = join(root, 'node_modules', '.bin', name)
    if (existsSync(local)) {
      return [local, ...args]
    }
  }
  const downloaded = join(
    root,
    'bin',
    process.platform === 'win32' ? `${executable}.exe` : executable
  )
  return existsSync(downloaded) ? [downloaded, ...args] : null
}

export async function removeServer(
  install: ServerInstall,
  executable: string,
  root = SERVER_ROOT
): Promise<string | null> {
  if (install.kind === 'download') {
    const target = join(
      root,
      'bin',
      process.platform === 'win32' ? `${executable}.exe` : executable
    )
    try {
      rmSync(target, { force: true })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  if (install.kind !== 'npm') {
    return 'druk did not install it'
  }
  const manager = savedManager(root) ?? 'npm'
  // A removal prunes what the manifest does not list, exactly as an install does.
  ensureManifest(root)
  const result = await run(
    manager,
    [...REMOVE_ARGS[manager](root), ...install.packages],
    {
      timeout: INSTALL_TIMEOUT_MS,
    }
  )
  const failure = failureOf(result, manager)
  if (failure) {
    return failure
  }
  // npm exits 0 for a package that was not there.
  return installedCommand([executable], root)
    ? `${executable} is still in ${root}`
    : null
}

export async function installServer(
  packages: string[],
  root = SERVER_ROOT,
  manager: PackageManager = 'npm'
): Promise<string | null> {
  // pnpm refuses a directory that is not there.
  mkdirSync(root, { recursive: true })
  ensureManifest(root)
  const result = await run(
    manager,
    [...INSTALL_ARGS[manager](root), ...packages],
    {
      timeout: INSTALL_TIMEOUT_MS,
    }
  )
  const failure = failureOf(result, manager)
  if (failure) {
    return failure
  }
  rememberManager(root, manager)
  return null
}

export async function downloadServer(
  url: string,
  name: string,
  root = SERVER_ROOT
): Promise<string | null> {
  const target = join(
    root,
    'bin',
    process.platform === 'win32' ? `${name}.exe` : name
  )
  // A transfer that dies mid-stream must not leave a truncated file where `installedCommand` looks.
  const partial = `${target}.part`
  try {
    mkdirSync(join(root, 'bin'), { recursive: true })
    const response = await fetch(url, {
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    })
    if (!response.ok) {
      return `HTTP ${response.status}`
    }
    await Bun.write(partial, response)
    if (process.platform !== 'win32') {
      chmodSync(partial, 0o755)
    }
    renameSync(partial, target)
    return null
  } catch (error) {
    rmSync(partial, { force: true })
    return error instanceof Error ? error.message : String(error)
  }
}
