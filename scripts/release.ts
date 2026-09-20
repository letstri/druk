import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'

import { binaryName } from '../build'
import type { TargetName } from '../build'

// Only the *outputs* move with DRUK_DIST, so a test run never rewrites the dist/ just built.
const DIST = process.env.DRUK_DIST ?? './dist'
const NPM_DIR = `${DIST}/npm`
const RELEASE_DIR = `${DIST}/release`
const NOTICE = './THIRD_PARTY_NOTICES.md'

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
  if (os === 'linux') {
    await Bun.$`tar -czf ${archive} -C ${from} ${exe} THIRD_PARTY_NOTICES.md`
  } else if (Bun.which('zip')) {
    await Bun.$`zip -qj ${archive} ${`${from}/${exe}`} ${`${from}/THIRD_PARTY_NOTICES.md`}`
  } else {
    // Windows has no `zip`, but its bsdtar picks the format from the extension.
    await Bun.$`tar -a -cf ${archive} -C ${from} ${exe} THIRD_PARTY_NOTICES.md`
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
// Not in `files` below: npm packs README, LICENSE and package.json whatever it says.
await cp('./LICENSE', `${rootDir}/LICENSE`)

const rootPkg = await Bun.file('./package.json').json()
await Bun.write(
  `${rootDir}/package.json`,
  `${JSON.stringify(
    {
      ...rootPkg,
      // The repo is private so a stray root `npm publish` ships nothing; this copy is the real one.
      '//private': undefined,
      'private': undefined,
      'bin': { druk: './bin/druk.js' },
      'files': ['bin', 'THIRD_PARTY_NOTICES.md'],
      'scripts': { postinstall: 'node ./bin/postinstall.mjs' },
      // Node ships `fetch` from 18, which is what pulls the binary down.
      'engines': { node: '>=18' },
      'os': ['darwin', 'linux', 'win32'],
      'cpu': ['arm64', 'x64'],
      'devDependencies': undefined,
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
  // Without an explicit tag `1.0.0-beta.1` would land on `latest`; the prerelease id is the tag.
  const tag = /-([a-z][\da-z]*)/i.exec(version)?.[1] ?? 'latest'

  // npm forbids republishing, so a rerun of a release that already reached npm must skip it.
  const onRegistry = async (name: string) =>
    (await Bun.$`npm view ${name}@${version} version`.quiet().nothrow()).exitCode === 0

  if (await onRegistry('druk')) {
    process.stdout.write(`druk@${version} is already published — skipped\n`)
  } else {
    await Bun.$`npm publish --access public --tag ${tag}`.cwd(rootDir)
  }
}
