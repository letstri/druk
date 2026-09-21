import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { blobTexts } from '../src/core/git'
import { initRepo } from './repo'
import { tempDir } from './temp'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' })

function repo() {
  const dir = tempDir('druk-blobs-')
  initRepo(dir)
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  // The batch header counts bytes, not string length.
  writeFileSync(join(dir, 'b.txt'), 'héllo — ünïcode\n')
  writeFileSync(join(dir, 'c.txt'), 'crlf\r\nlines\r\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return dir
}

describe('blobTexts', () => {
  test('reads every spec from one batch, in order', () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    git(dir, 'add', 'a.txt')

    const texts = blobTexts(dir, [
      'HEAD:./a.txt',
      'HEAD:./b.txt',
      ':./a.txt',
      'HEAD:./missing.txt',
      'HEAD:./c.txt',
    ])

    expect(texts.get('HEAD:./a.txt')).toBe('one\ntwo\n')
    expect(texts.get('HEAD:./b.txt')).toBe('héllo — ünïcode\n')
    expect(texts.get(':./a.txt')).toBe('one\ntwo\nthree\n')
    expect(texts.get('HEAD:./missing.txt')).toBeNull()
    expect(texts.get('HEAD:./c.txt')).toBe('crlf\nlines\n')
  })

  test('no specs asks git nothing', () => {
    expect(blobTexts(repo(), []).size).toBe(0)
  })

  test('outside a repository every spec is null', () => {
    const texts = blobTexts(tempDir('druk-blobs-'), ['HEAD:./a.txt'])

    expect(texts.get('HEAD:./a.txt')).toBeNull()
  })
})
