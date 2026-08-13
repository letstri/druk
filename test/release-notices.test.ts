import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

const root = join(import.meta.dir, '..')
// Never the repo's own dist/: a run killed partway through would otherwise leave the
// binaries a developer just built moved aside, and scripts/test.ts does kill a file
// that outlasts its cap.
const dist = tempDir('druk-release-')
afterAll(() => rmSync(dist, { recursive: true, force: true }))

test('release artifacts carry PDFium notices', () => {
  mkdirSync(join(dist, 'windows-x64'), { recursive: true })
  writeFileSync(join(dist, 'windows-x64', 'druk.exe'), 'test binary')

  const result = Bun.spawnSync({
    cmd: [process.execPath, 'run', 'scripts/release.ts', 'windows-x64'],
    cwd: root,
    env: { ...process.env, DRUK_DIST: dist },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)

  const archive = readFileSync(join(dist, 'release/druk-windows-x64.zip')).toString('latin1')
  expect(archive).toContain('THIRD_PARTY_NOTICES.md')
  expect(archive).toContain('PDFIUM_LICENSE')
  const npm = join(dist, 'npm/druk')
  expect(existsSync(join(npm, 'THIRD_PARTY_NOTICES.md'))).toBe(true)
  expect(existsSync(join(npm, 'PDFIUM_LICENSE'))).toBe(true)
  const notice = readFileSync(join(npm, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  expect(notice).toContain('Copyright (c) 2012-2023 Scott Chacon and others')
  expect(notice).toContain('Permission is hereby granted')
  expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  expect(JSON.parse(readFileSync(join(npm, 'package.json'), 'utf8')).files).toEqual([
    'bin',
    'THIRD_PARTY_NOTICES.md',
    'PDFIUM_LICENSE',
  ])
})
