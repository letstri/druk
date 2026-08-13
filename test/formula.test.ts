import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

const root = join(import.meta.dir, '..')
// Never the repo's own dist/, for the reason release-notices.test.ts gives.
const dist = tempDir('druk-formula-')
afterAll(() => rmSync(dist, { recursive: true, force: true }))

const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const
// The tags brew asks for; a rename here is a formula nobody's machine matches.
const TAGS = ['arm64_ventura', 'ventura', 'arm64_linux', 'x86_64_linux'] as const

function run(script: string, args: string[] = []) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'run', `scripts/${script}`, ...args],
    cwd: root,
    env: { ...process.env, DRUK_DIST: dist },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
}

test('the formula pours bottles for every platform', () => {
  for (const target of TARGETS) {
    mkdirSync(join(dist, target), { recursive: true })
    writeFileSync(join(dist, target, 'druk'), `test binary ${target}`)
  }
  run('release.ts', [...TARGETS])
  run('formula.ts')

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const formula = readFileSync(join(dist, 'release/druk.rb'), 'utf8')
  expect(formula).toContain(
    `root_url "https://github.com/letstri/druk/releases/download/v${version}"`,
  )

  for (const tag of TAGS) {
    // The name brew builds from root_url: one dash before the version, not two.
    const path = join(dist, 'release', `druk-${version}.${tag}.bottle.tar.gz`)
    expect(existsSync(path)).toBe(true)

    const sum = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(formula).toContain(`sha256 cellar: :any_skip_relocation, ${tag}: "${sum}"`)

    const listed = Bun.spawnSync({ cmd: ['tar', '-tzf', path] }).stdout.toString()
    expect(listed).toContain(`druk/${version}/bin/druk`)
    expect(listed).not.toContain('._druk')
  }

  // A bottle per target, each carrying that target's binary rather than one of them four
  // times — the mistake a shared staging directory would make.
  const contents = TAGS.map(tag =>
    Bun.spawnSync({
      cmd: [
        'tar',
        '-xzOf',
        join(dist, 'release', `druk-${version}.${tag}.bottle.tar.gz`),
        `druk/${version}/bin/druk`,
      ],
    }).stdout.toString(),
  )
  expect(contents).toEqual(TARGETS.map(target => `test binary ${target}`))

  expect(existsSync(join(dist, 'bottle'))).toBe(false)
})
