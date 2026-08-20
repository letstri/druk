import { mkdir, rm } from 'node:fs/promises'

import solidPlugin from '@opentui/solid/bun-plugin'

/**
 * Builds druk into a self-contained executable: the Bun runtime, OpenTUI's native
 * library and every tree-sitter grammar in one file, so installing druk never means
 * installing Bun first.
 *
 * Cross-compiling only works for platforms whose `@opentui/core-<platform>` package is
 * installed — `bun install` fetches the host's alone. Release builds therefore run one
 * native runner per target; see .github/workflows/release.yml.
 */
const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64',
  'windows-x64': 'bun-windows-x64',
  // Bun's default x64 builds are compiled for AVX2, so on a pre-2013 CPU (Sandy/Ivy
  // Bridge) they die at startup with "illegal hardware instruction" — issue #99. The
  // baseline variants target Nehalem and run anywhere; the npm shim and the install
  // script pick them on machines without avx2. No darwin pair: every Mac that runs a
  // macOS Bun supports has AVX2 (the 2013 Mac Pro is the lone exception, and Homebrew
  // cannot tell bottles apart by CPU feature anyway).
  'linux-x64-baseline': 'bun-linux-x64-baseline',
  'windows-x64-baseline': 'bun-windows-x64-baseline',
} as const

export type TargetName = keyof typeof TARGETS

export function hostTarget(): TargetName {
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const name = `${os}-${process.arch}`
  if (name in TARGETS) return name as TargetName
  throw new Error(`unsupported platform: ${name}`)
}

export function binaryName(target: TargetName): string {
  return target.startsWith('windows-') ? 'druk.exe' : 'druk'
}

export async function buildTarget(target: TargetName, version: string): Promise<string> {
  const outdir = `./dist/${target}`
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })

  const outfile = `${outdir}/${binaryName(target)}`
  const result = await Bun.build({
    entrypoints: ['./src/index.tsx'],
    target: 'bun',
    plugins: [solidPlugin],
    // There is no package.json to read the version from once this is one file.
    define: { __DRUK_VERSION__: JSON.stringify(version) },
    compile: {
      target: TARGETS[target],
      outfile,
      // druk is opened *inside* other people's projects, and a standalone binary
      // otherwise picks up the bunfig.toml sitting there — including its `preload`,
      // which then fails to resolve and kills startup before the editor draws.
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`build failed for ${target}`)
  }
  return outfile
}

if (import.meta.main) {
  const requested = process.argv.slice(2)
  for (const name of requested) {
    if (!(name in TARGETS)) {
      process.stderr.write(`unknown target: ${name}\nknown: ${Object.keys(TARGETS).join(', ')}\n`)
      process.exit(1)
    }
  }
  const targets = (requested.length ? requested : [hostTarget()]) as TargetName[]
  const { version } = await Bun.file('./package.json').json()

  for (const target of targets) {
    const outfile = await buildTarget(target, version)
    process.stdout.write(`built ${outfile}\n`)
  }
}
