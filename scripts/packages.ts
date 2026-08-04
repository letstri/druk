import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'

/**
 * Turns the Linux binaries in dist/<target>/ into .deb and .rpm packages in
 * dist/release/, for the publish job to upload beside the archives.
 *
 * nfpm reads one YAML config per invocation; the config is built here rather
 * than committed, so the pure part runs under `bun run check` and
 * package.json stays the only place a version lives. nfpm itself is fetched
 * by the workflow, pinned by version and checksum — this script only ever
 * finds it on PATH or says it could not.
 */

export type LinuxTarget = 'linux-x64' | 'linux-arm64'
export type PackageFormat = 'deb' | 'rpm'

export const LINUX_TARGETS: LinuxTarget[] = ['linux-x64', 'linux-arm64']
export const FORMATS: PackageFormat[] = ['deb', 'rpm']

/** nfpm takes Go's arch names and translates per packager. */
const GOARCH: Record<LinuxTarget, string> = {
  'linux-x64': 'amd64',
  'linux-arm64': 'arm64',
}

/** What the file is called in each ecosystem's own vocabulary and shape. */
const FILE_ARCH: Record<PackageFormat, Record<LinuxTarget, string>> = {
  deb: { 'linux-x64': 'amd64', 'linux-arm64': 'arm64' },
  rpm: { 'linux-x64': 'x86_64', 'linux-arm64': 'aarch64' },
}

export function packageFileName(
  format: PackageFormat,
  target: LinuxTarget,
  version: string,
): string {
  const arch = FILE_ARCH[format][target]
  // rpm's own naming is name-version-release.arch; mirroring deb's underscores
  // there would read as foreign to every rpm tool and user.
  return format === 'deb' ? `druk_${version}_${arch}.deb` : `druk-${version}-1.${arch}.rpm`
}

/** The nfpm config for one target — the same for both formats it packages. */
export function nfpmConfig(target: LinuxTarget, version: string, distDir = './dist'): string {
  return [
    `name: druk`,
    `arch: ${GOARCH[target]}`,
    `platform: linux`,
    `version: ${version}`,
    `maintainer: Valerii Strilets`,
    `homepage: https://github.com/letstri/druk`,
    `license: MIT`,
    `description: >-`,
    `  A terminal code editor — file tree, tabs, tree-sitter syntax highlighting`,
    `  and search; keyboard and mouse driven.`,
    `contents:`,
    `  - src: ${distDir}/${target}/druk`,
    `    dst: /usr/bin/druk`,
    `    file_info:`,
    `      mode: 0755`,
    `  - src: ./LICENSE`,
    `    dst: /usr/share/doc/druk/LICENSE`,
    `  - src: ./THIRD_PARTY_NOTICES.md`,
    `    dst: /usr/share/doc/druk/THIRD_PARTY_NOTICES.md`,
    `  - src: ./third_party/PDFIUM_LICENSE`,
    `    dst: /usr/share/doc/druk/PDFIUM_LICENSE`,
    ``,
  ].join('\n')
}

if (import.meta.main) {
  const distDir = process.env.DRUK_DIST ?? './dist'
  const { version } = await Bun.file('./package.json').json()

  for (const target of LINUX_TARGETS) {
    const binary = `${distDir}/${target}/druk`
    if (!existsSync(binary)) {
      process.stderr.write(`missing binary: ${binary} — run the ${target} build first\n`)
      process.exit(1)
    }
  }
  if (!Bun.which('nfpm')) {
    process.stderr.write('nfpm is not on PATH — the release workflow installs it pinned\n')
    process.exit(1)
  }

  const outDir = `${distDir}/release`
  await mkdir(outDir, { recursive: true })
  for (const target of LINUX_TARGETS) {
    const config = `${outDir}/nfpm-${target}.yaml`
    await writeFile(config, nfpmConfig(target, version, distDir))
    for (const format of FORMATS) {
      const out = `${outDir}/${packageFileName(format, target, version)}`
      await Bun.$`nfpm package -f ${config} -p ${format} -t ${out}`
      process.stdout.write(`packaged ${out}\n`)
    }
    // The config beside the uploads would ride the release's wildcard glob.
    await rm(config)
  }
}
