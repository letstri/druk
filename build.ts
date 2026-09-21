import { mkdir, rm } from 'node:fs/promises'

import solidPlugin from '@opentui/solid/bun-plugin'

// Cross-compiling needs the target's @opentui/core-<platform> package, which bun install skips.
const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64',
  // Bun's default x64 builds need AVX2 and die on a pre-2013 CPU (#99); no darwin pair needed.
  'linux-x64-baseline': 'bun-linux-x64-baseline',
  'windows-x64': 'bun-windows-x64',
  'windows-x64-baseline': 'bun-windows-x64-baseline',
} as const

export type TargetName = keyof typeof TARGETS

export function hostTarget(): TargetName {
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const name = `${os}-${process.arch}`
  if (name in TARGETS) {
    return name as TargetName
  }
  throw new Error(`unsupported platform: ${name}`)
}

export function binaryName(target: TargetName): string {
  return target.startsWith('windows-') ? 'druk.exe' : 'druk'
}

export async function buildTarget(
  target: TargetName,
  version: string
): Promise<string> {
  const outdir = `./dist/${target}`
  await rm(outdir, { force: true, recursive: true })
  await mkdir(outdir, { recursive: true })

  const outfile = `${outdir}/${binaryName(target)}`
  const result = await Bun.build({
    compile: {
      // druk opens inside other people's projects, whose bunfig.toml `preload` would kill startup.
      autoloadBunfig: false,
      autoloadDotenv: false,
      outfile,
      target: TARGETS[target],
    },
    // There is no package.json to read the version from once this is one file.
    define: { __DRUK_VERSION__: JSON.stringify(version) },
    entrypoints: ['./src/index.tsx'],
    plugins: [solidPlugin],
    target: 'bun',
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`build failed for ${target}`)
  }
  return outfile
}

if (import.meta.main) {
  const requested = process.argv.slice(2)
  for (const name of requested) {
    if (!(name in TARGETS)) {
      process.stderr.write(
        `unknown target: ${name}\nknown: ${Object.keys(TARGETS).join(', ')}\n`
      )
      process.exit(1)
    }
  }
  const targets = (
    requested.length ? requested : [hostTarget()]
  ) as TargetName[]
  const { version } = await Bun.file('./package.json').json()

  for (const target of targets) {
    const outfile = await buildTarget(target, version)
    process.stdout.write(`built ${outfile}\n`)
  }
}
