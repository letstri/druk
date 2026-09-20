import { homedir } from 'node:os'

type InstallKind = 'brew' | 'script' | 'system' | 'package'

const ADD_GLOBAL = {
  npm: 'npm install -g druk@latest',
  pnpm: 'pnpm add -g druk@latest',
  yarn: 'yarn global add druk@latest',
  bun: 'bun add -g druk@latest',
  deno: 'deno add -g npm:druk@latest',
} as const

export type PackageManagerName = keyof typeof ADD_GLOBAL

export interface Install {
  kind: InstallKind
  manager?: PackageManagerName
}

const MANAGER_PATHS: ReadonlyArray<readonly [PackageManagerName, RegExp]> = [
  ['pnpm', /[/\\](?:\.?pnpm|pnpm-global)[/\\]/],
  ['bun', /[/\\]\.bun[/\\]/],
  ['yarn', /[/\\]\.?yarn[/\\]/],
  ['deno', /[/\\]\.deno[/\\]/],
  ['npm', /[/\\](?:npm|node_modules)[/\\]/],
]

// A compiled binary is its own execPath; the npm package is a shim, so only argv[1] names it.
export function detectInstall(
  execPath: string,
  scriptPath: string,
  home: string,
  fallback: PackageManagerName = 'npm',
): Install {
  const paths = `${execPath}\n${scriptPath}`
  if (/[/\\](?:Cellar|homebrew|linuxbrew)[/\\]/.test(paths)) return { kind: 'brew' }
  if (paths.includes(`${home}/.druk`)) return { kind: 'script' }
  // execPath alone: an npm shim at /usr/bin/druk runs under node. Before the manager fallbacks.
  if (execPath === '/usr/bin/druk') return { kind: 'system' }

  for (const [manager, pattern] of MANAGER_PATHS) {
    if (pattern.test(paths)) return { kind: 'package', manager }
  }
  return { kind: 'package', manager: fallback }
}

const RELEASES_URL = 'https://github.com/letstri/druk/releases/latest'

export function upgradeCommand(install: Install): string {
  if (install.kind === 'brew') return 'brew upgrade letstri/tap/druk'
  if (install.kind === 'script') return 'curl -fsSL https://druk.letstri.dev/install | bash'
  if (install.kind === 'system') return RELEASES_URL
  return ADD_GLOBAL[install.manager ?? 'npm']
}

const DESCRIPTION: Record<InstallKind, (install: Install) => string> = {
  brew: () => 'Updating the Homebrew install.',
  script: () => 'Re-running the install script.',
  system: () => 'Installed by a system package manager.',
  package: install => `Updating the global ${install.manager ?? 'npm'} install.`,
}

const packageNames = (arch: string) =>
  arch === 'arm64' ? 'the arm64 .deb or aarch64 .rpm' : 'the amd64 .deb or x86_64 .rpm'

const SPINNER = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']

// The install script and brew both report a no-op on stdout; neither uses an exit code for it.
export const changedNothing = (output: string) => /already (?:installed|up-to-date)/i.test(output)

export async function withSpinner<T>(
  write: (text: string) => void,
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now()
  let frame = 0
  const draw = () => {
    const seconds = Math.round((Date.now() - started) / 1000)
    write(`\r\x1B[2K${SPINNER[frame++ % SPINNER.length]} ${label}  ${seconds}s`)
  }
  write('\x1B[?25l')
  draw()
  const tick = setInterval(draw, 80)
  try {
    return await run()
  } finally {
    clearInterval(tick)
    write('\r\x1B[2K\x1B[?25h')
  }
}

export async function runUpgrade(
  write: (text: string) => void = text => process.stdout.write(text),
  detection: { execPath?: string; scriptPath?: string; home?: string; arch?: string } = {},
): Promise<number> {
  const install = detectInstall(
    detection.execPath ?? process.execPath,
    detection.scriptPath ?? process.argv[1] ?? '',
    detection.home ?? homedir(),
  )

  // Nothing safe to run: a manager of our own choosing is the two-copies failure.
  if (install.kind === 'system') {
    write(
      `${DESCRIPTION.system(install)}\nUpdate it through that manager, or take ` +
        `${packageNames(detection.arch ?? process.arch)} from:\n${RELEASES_URL}\n`,
    )
    return 0
  }

  const command = upgradeCommand(install)
  const live = process.stdout.isTTY === true

  write(`${DESCRIPTION[install.kind](install)}\n$ ${command}\n${live ? '' : '\n'}`)
  try {
    const shell = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c']
    const child = Bun.spawn([...shell, command], {
      stdout: live ? 'pipe' : 'inherit',
      stderr: live ? 'pipe' : 'inherit',
    })
    // Both pipes drained together: a child filling one while we read the other blocks forever.
    const run = async () => {
      const [out, err] = child.stdout
        ? await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
        : ['', '']
      return { code: await child.exited, output: `${out}${err}` }
    }
    const { code, output } = live ? await withSpinner(write, 'Updating', run) : await run()
    if (code === 0) {
      if (live) write(changedNothing(output) ? '✓ Already up to date.\n' : '✓ Updated.\n')
    } else {
      if (output.trim()) write(`${output.trimEnd()}\n`)
      write(`\ndruk: update failed (exit ${code})\n`)
    }
    return code
  } catch (error) {
    write(`\ndruk: could not run the update — ${(error as Error).message}\n`)
    return 1
  }
}
