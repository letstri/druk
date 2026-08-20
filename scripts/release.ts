import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'

import { binaryName } from '../build'
import type { TargetName } from '../build'

/**
 * Packages the binaries built by build.ts:
 *   dist/npm/druk/              the one package published, a shim holding no binary
 *   dist/release/druk-<target>.{zip,tar.gz}   binaries + third-party notices
 *
 * The archives are the only place a binary is distributed: both the install script and
 * the npm shim pull them from the GitHub release. There used to be an npm package per
 * platform, listed as optional dependencies, which is the usual arrangement — but
 * publishing those needs a credential that can create new packages, while the release
 * workflow authenticates as GitHub and may only publish to `druk`. One package means
 * the whole release runs unattended.
 *
 * So the release must be uploaded *before* npm is published: an install landing in the
 * gap would find no asset to fetch.
 *
 * Run after `bun run build <targets>`; only targets with a built binary are packaged.
 */
// Only the *outputs* move with DRUK_DIST; the sources below stay relative to the repo.
// `test/release-notices.test.ts` packages into a temp directory through it, so the suite
// never rewrites the dist/ a developer just built into.
const DIST = process.env.DRUK_DIST ?? './dist'
const NPM_DIR = `${DIST}/npm`
const RELEASE_DIR = `${DIST}/release`
const NOTICE = './THIRD_PARTY_NOTICES.md'
const PDFIUM_LICENSE = './third_party/PDFIUM_LICENSE'

const { version } = await Bun.file('./package.json').json()

const ALL_TARGETS: TargetName[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linux-x64-baseline',
  'windows-x64',
  'windows-x64-baseline',
]

const requested = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
const publish = process.argv.includes('--publish')

const targets = (requested.length ? (requested as TargetName[]) : ALL_TARGETS).filter(target =>
  existsSync(`${DIST}/${target}/${binaryName(target)}`),
)

if (targets.length === 0) {
  process.stderr.write('no built binaries in dist/ — run `bun run build` first\n')
  process.exit(1)
}

await rm(NPM_DIR, { recursive: true, force: true })
await rm(RELEASE_DIR, { recursive: true, force: true })
await mkdir(RELEASE_DIR, { recursive: true })

for (const target of targets) {
  const [os] = target.split('-') as [string, string]
  const exe = binaryName(target)

  const archive = `${RELEASE_DIR}/druk-${target}.${os === 'linux' ? 'tar.gz' : 'zip'}`
  const from = `${DIST}/${target}`
  await cp(NOTICE, `${from}/THIRD_PARTY_NOTICES.md`)
  await cp(PDFIUM_LICENSE, `${from}/PDFIUM_LICENSE`)
  if (os === 'linux') {
    await Bun.$`tar -czf ${archive} -C ${from} ${exe} THIRD_PARTY_NOTICES.md PDFIUM_LICENSE`
  } else if (Bun.which('zip')) {
    await Bun.$`zip -qj ${archive} ${`${from}/${exe}`} ${`${from}/THIRD_PARTY_NOTICES.md`} ${`${from}/PDFIUM_LICENSE`}`
  } else {
    // Windows has no `zip`, but its bsdtar picks the format from the extension.
    await Bun.$`tar -a -cf ${archive} -C ${from} ${exe} THIRD_PARTY_NOTICES.md PDFIUM_LICENSE`
  }
  process.stdout.write(`packaged ${target} -> ${archive}\n`)
}

const rootDir = `${NPM_DIR}/druk`
await mkdir(`${rootDir}/bin`, { recursive: true })
await cp('./bin/druk.js', `${rootDir}/bin/druk.js`)
await cp('./bin/postinstall.mjs', `${rootDir}/bin/postinstall.mjs`)
await cp('./bin/binary.mjs', `${rootDir}/bin/binary.mjs`)
await cp('./bin/windows-shim.mjs', `${rootDir}/bin/windows-shim.mjs`)
await cp('./README.md', `${rootDir}/README.md`)
await cp(NOTICE, `${rootDir}/THIRD_PARTY_NOTICES.md`)
await cp(PDFIUM_LICENSE, `${rootDir}/PDFIUM_LICENSE`)
// Not in `files` below, and does not need to be: npm always packs README, LICENSE
// and package.json whatever `files` says.
await cp('./LICENSE', `${rootDir}/LICENSE`)

const rootPkg = await Bun.file('./package.json').json()
await Bun.write(
  `${rootDir}/package.json`,
  `${JSON.stringify(
    {
      ...rootPkg,
      // The repo itself is private so a stray `npm publish` at the root cannot ship a
      // shim with no binaries behind it; the staged copy is the publishable one.
      '//private': undefined,
      'private': undefined,
      'bin': { druk: './bin/druk.js' },
      'files': ['bin', 'THIRD_PARTY_NOTICES.md', 'PDFIUM_LICENSE'],
      // Nothing to build or check here; the one script fetches the binary so that
      // the first run does not have to.
      'scripts': { postinstall: 'node ./bin/postinstall.mjs' },
      // Node ships `fetch` from 18, which is what pulls the binary down.
      'engines': { node: '>=18' },
      'os': ['darwin', 'linux', 'win32'],
      'cpu': ['arm64', 'x64'],
      'devDependencies': undefined,
      // Every dependency is compiled into the binary, and the binary comes from the
      // GitHub release — so the published package holds only the shim and notices.
      'dependencies': undefined,
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(`packaged druk -> ${rootDir}\n`)

if (publish) {
  if (targets.length !== ALL_TARGETS.length) {
    const missing = ALL_TARGETS.filter(t => !targets.includes(t))
    process.stderr.write(
      `refusing to publish without every platform: missing ${missing.join(', ')}\n`,
    )
    process.exit(1)
  }
  // npm refuses a prerelease without an explicit tag, and rightly so: `1.0.0-beta.1`
  // on `latest` would become what every plain `npm install -g druk` gets. The
  // identifier is the tag, so a beta lands on `beta` and is installed on purpose.
  const tag = /-([a-z][\da-z]*)/i.exec(version)?.[1] ?? 'latest'

  /**
   * A version already on the registry is skipped rather than retried: npm forbids
   * republishing, so without this a rerun of a release that got as far as npm — to
   * fix a later step — could never succeed.
   */
  const onRegistry = async (name: string) =>
    (await Bun.$`npm view ${name}@${version} version`.quiet().nothrow()).exitCode === 0

  if (await onRegistry('druk')) {
    process.stdout.write(`druk@${version} is already published — skipped\n`)
  } else {
    await Bun.$`npm publish --access public --tag ${tag}`.cwd(rootDir)
  }
}
