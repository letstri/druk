/**
 * `druk update` — upgrading the copy that is running, however it was installed.
 *
 * There are three ways to get druk and they are upgraded in three different ways.
 * Running the wrong one is worse than doing nothing: `npm install -g druk` on a
 * Homebrew install puts a second druk somewhere the user's `PATH` may not even
 * look, and then neither copy is obviously the one that runs.
 *
 * So the install is identified from where the running executable sits, and the
 * package-manager case asks nypm for the right command rather than assuming npm.
 */
import { homedir } from 'node:os'

import { addDependencyCommand } from 'nypm'
import type { PackageManagerName } from 'nypm'

export type InstallKind = 'brew' | 'script' | 'system' | 'package'

export interface Install {
  kind: InstallKind
  /** Which manager owns it, when `kind` is 'package'. */
  manager?: PackageManagerName
}

/** Path fragments each manager puts its global binaries under. */
const MANAGER_PATHS: ReadonlyArray<readonly [PackageManagerName, RegExp]> = [
  ['pnpm', /[/\\](?:\.?pnpm|pnpm-global)[/\\]/],
  ['bun', /[/\\]\.bun[/\\]/],
  ['yarn', /[/\\]\.?yarn[/\\]/],
  ['deno', /[/\\]\.deno[/\\]/],
  ['npm', /[/\\](?:npm|node_modules)[/\\]/],
]

/**
 * Which install is running, from the path of the executable and of the script it
 * was started with. Both matter: a compiled binary is its own `execPath`, while
 * the npm package is a shim that node or bun runs, so only `argv[1]` names it.
 */
export function detectInstall(
  execPath: string,
  scriptPath: string,
  home: string,
  fallback: PackageManagerName = 'npm',
): Install {
  const paths = `${execPath}\n${scriptPath}`
  if (/[/\\](?:Cellar|homebrew|linuxbrew)[/\\]/.test(paths)) return { kind: 'brew' }
  // Where the curl installer puts it; nothing else owns that directory.
  if (paths.includes(`${home}/.druk`)) return { kind: 'script' }
  // The compiled binary at the packaged path: our .deb/.rpm put it there, and so
  // do other system packagings (the AUR's druk-bin) — hence "a system package
  // manager" and not a package by name. execPath alone: an npm shim at
  // /usr/bin/druk runs under node, whose execPath this is not. Ahead of the
  // manager fallbacks, whose npm default would install a second druk beside
  // the system one — the exact failure this module exists to avoid.
  if (execPath === '/usr/bin/druk') return { kind: 'system' }

  for (const [manager, pattern] of MANAGER_PATHS) {
    if (pattern.test(paths)) return { kind: 'package', manager }
  }
  return { kind: 'package', manager: fallback }
}

/** Where the packages live; a system install is pointed here, never run for. */
export const RELEASES_URL = 'https://github.com/letstri/druk/releases/latest'

/** The shell command that upgrades this install, ready to print and to run. */
export function upgradeCommand(install: Install): string {
  if (install.kind === 'brew') return 'brew upgrade letstri/tap/druk'
  if (install.kind === 'script') return 'curl -fsSL https://druk.letstri.dev/install | bash'
  // Not runnable: no repository is hosted, and the manager that installed it is
  // not ours to invoke. The URL is the honest answer.
  if (install.kind === 'system') return RELEASES_URL
  return addDependencyCommand(install.manager ?? 'npm', 'druk@latest', { global: true })
}

/** What was detected, said plainly, so a wrong guess is obvious before it runs. */
const DESCRIPTION: Record<InstallKind, (install: Install) => string> = {
  brew: () => 'Updating the Homebrew install.',
  script: () => 'Re-running the install script.',
  system: () => 'Installed by a system package manager.',
  package: install => `Updating the global ${install.manager ?? 'npm'} install.`,
}

/** The package filenames for this machine, so the pointer names what to take. */
const packageNames = (arch: string) =>
  arch === 'arm64' ? 'the arm64 .deb or aarch64 .rpm' : 'the amd64 .deb or x86_64 .rpm'

/**
 * Run the upgrade, with the child's output going straight to the terminal — the
 * package managers and brew both report progress, and hiding it behind a spinner
 * of our own would only make a slow step look like a hang.
 *
 * Returns the exit code to leave with.
 */
export async function runUpgrade(
  write: (text: string) => void = text => process.stdout.write(text),
  // Injectable for the tests, which cannot present /usr/bin/druk as their own
  // execPath; the defaults are the process's, as before.
  detection: { execPath?: string; scriptPath?: string; home?: string; arch?: string } = {},
): Promise<number> {
  const install = detectInstall(
    detection.execPath ?? process.execPath,
    detection.scriptPath ?? process.argv[1] ?? '',
    detection.home ?? homedir(),
  )

  // Nothing safe to run: updating through the manager that installed it is the
  // user's move, and running a package manager of our own choosing beside it is
  // the two-copies failure described at the top of this file.
  if (install.kind === 'system') {
    write(
      `${DESCRIPTION.system(install)}\nUpdate it through that manager, or take ` +
        `${packageNames(detection.arch ?? process.arch)} from:\n${RELEASES_URL}\n`,
    )
    return 0
  }

  const command = upgradeCommand(install)

  write(`${DESCRIPTION[install.kind](install)}\n$ ${command}\n\n`)
  try {
    // No `sh` on Windows, where druk ships too.
    const shell = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c']
    const child = Bun.spawn([...shell, command], { stdout: 'inherit', stderr: 'inherit' })
    const code = await child.exited
    if (code !== 0) write(`\ndruk: update failed (exit ${code})\n`)
    return code
  } catch (error) {
    // No shell to run it with. Report the command so it can be run by hand,
    // rather than letting a spawn failure print a stack trace and exit 0.
    write(`\ndruk: could not run the update — ${(error as Error).message}\n`)
    return 1
  }
}
