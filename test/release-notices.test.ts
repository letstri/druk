import { afterAll, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

const root = join(import.meta.dir, '..')
// Never the repo's own dist/: a killed over-cap file leaves the developer's binaries moved aside.
const dist = tempDir('druk-release-')
afterAll(() => rmSync(dist, { force: true, recursive: true }))

test('release artifacts carry the third-party notices', () => {
  mkdirSync(join(dist, 'windows-x64'), { recursive: true })
  writeFileSync(join(dist, 'windows-x64', 'druk.exe'), 'test binary')

  const result = Bun.spawnSync({
    cmd: [process.execPath, 'run', 'scripts/release.ts', 'windows-x64'],
    cwd: root,
    env: { ...process.env, DRUK_DIST: dist },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)

  const archive = readFileSync(
    join(dist, 'release/druk-windows-x64.zip')
  ).toString('latin1')
  expect(archive).toContain('THIRD_PARTY_NOTICES.md')
  const npm = join(dist, 'npm/druk')
  expect(existsSync(join(npm, 'THIRD_PARTY_NOTICES.md'))).toBe(true)
  const notice = readFileSync(join(npm, 'THIRD_PARTY_NOTICES.md'), 'utf-8')
  expect(notice).toContain('tree-sitter')
  expect(notice).toContain('OpenTUI')
  expect(
    JSON.parse(readFileSync(join(npm, 'package.json'), 'utf-8')).files
  ).toEqual(['bin', 'THIRD_PARTY_NOTICES.md'])
})
