import { describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { planProjectReplace, replaceProject } from '../src/core/search'
import { fixture } from './helpers'

const files = (count: number, perFile: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `f${i}.ts`,
      Array.from({ length: perFile }, () => 'const value = OLD\n').join(''),
    ]),
  )

describe('planProjectReplace', () => {
  test('counts every match, not the first 200', () => {
    const dir = fixture(files(30, 10)) // 300 matches
    const { targets, matches } = planProjectReplace(dir, 'OLD')
    expect(matches).toBe(300)
    expect(targets.length).toBe(30)
  })

  test('an open buffer is counted instead of its disk copy', () => {
    const dir = fixture({ 'a.ts': 'OLD OLD\n' })
    const path = join(dir, 'a.ts')
    const buffers = new Map([[path, 'OLD once, edited away the other\n']])
    const { matches } = planProjectReplace(dir, 'OLD', {}, buffers)
    expect(matches).toBe(1)
  })

  test('an invalid regex plans nothing', () => {
    const dir = fixture({ 'a.ts': 'OLD\n' })
    expect(planProjectReplace(dir, '(', { regex: true }).matches).toBe(0)
  })
})

describe('replaceProject', () => {
  test('buffered paths come back as content, disk untouched', () => {
    const dir = fixture({ 'a.ts': 'disk OLD\n' })
    const path = join(dir, 'a.ts')
    const buffers = new Map([[path, 'buffer OLD OLD\n']])
    const result = replaceProject([path], 'OLD', 'NEW', {}, buffers)

    expect(result.replaced).toEqual([{ path, count: 2, content: 'buffer NEW NEW\n' }])
    expect(readFileSync(path, 'utf8')).toBe('disk OLD\n')
  })

  test('a buffer that no longer holds the query is left alone', () => {
    const dir = fixture({ 'a.ts': 'disk OLD\n' })
    const path = join(dir, 'a.ts')
    const buffers = new Map([[path, 'the buffer moved on\n']])
    const result = replaceProject([path], 'OLD', 'NEW', {}, buffers)

    expect(result.replaced).toEqual([])
    expect(result.matches).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('disk OLD\n')
  })

  test('CRLF and BOM files keep their spelling', () => {
    const dir = fixture({})
    const crlf = join(dir, 'crlf.ts')
    const bom = join(dir, 'bom.ts')
    writeFileSync(crlf, 'one OLD\r\ntwo\r\n')
    writeFileSync(bom, '﻿OLD here\n')

    const result = replaceProject([crlf, bom], 'OLD', 'NEW')
    expect(result.matches).toBe(2)
    expect(readFileSync(crlf, 'utf8')).toBe('one NEW\r\ntwo\r\n')
    expect(readFileSync(bom, 'utf8')).toBe('﻿NEW here\n')
  })

  test('counts are apply-time, not plan-time', () => {
    const dir = fixture({ 'a.ts': 'OLD\n' })
    const path = join(dir, 'a.ts')
    const plan = planProjectReplace(dir, 'OLD')
    expect(plan.matches).toBe(1)

    writeFileSync(path, 'OLD OLD OLD\n') // grows between plan and apply
    const result = replaceProject(
      plan.targets.map(t => t.path),
      'OLD',
      'NEW',
    )
    expect(result.matches).toBe(3)
  })

  test('a vanished file is named, the rest still land', () => {
    const dir = fixture({ 'gone.ts': 'OLD\n', 'stays.ts': 'OLD\n' })
    const gone = join(dir, 'gone.ts')
    const stays = join(dir, 'stays.ts')
    rmSync(gone)

    const result = replaceProject([gone, stays], 'OLD', 'NEW')
    expect(result.failed.length).toBe(1)
    expect(result.failed[0]).toContain('gone.ts')
    expect(readFileSync(stays, 'utf8')).toBe('NEW\n')
  })

  test('an unwritable file is named, the ones after it still land', () => {
    const dir = fixture({ 'locked.ts': 'OLD\n', 'open.ts': 'OLD\n' })
    const locked = join(dir, 'locked.ts')
    const open = join(dir, 'open.ts')
    chmodSync(locked, 0o444)

    const result = replaceProject([locked, open], 'OLD', 'NEW')
    chmodSync(locked, 0o644)
    // Root ignores file modes; the write "succeeds" there and the test has nothing to see.
    if (process.getuid?.() !== 0) {
      expect(result.failed.length).toBe(1)
      expect(result.failed[0]).toContain('locked.ts')
      expect(readFileSync(locked, 'utf8')).toBe('OLD\n')
    }
    expect(readFileSync(open, 'utf8')).toBe('NEW\n')
  })

  test('$& and $1 land literally, as in-file replace pins', () => {
    const dir = fixture({ 'a.ts': 'OLD\n' })
    const path = join(dir, 'a.ts')
    replaceProject([path], 'OLD', '$&$1')
    expect(readFileSync(path, 'utf8')).toBe('$&$1\n')
  })

  test('a zero-width regex replaces matches, not every column', () => {
    const dir = fixture({ 'a.ts': 'baa b\n' })
    const path = join(dir, 'a.ts')
    replaceProject([path], 'a*', 'X', { regex: true })
    expect(readFileSync(path, 'utf8')).toBe('bX b\n')
  })

  // The confirm states a count before anything is written, so a pattern counted per
  // line and replaced per file would promise matches the pass never makes.
  test('an anchored regex replaces every line it was counted on', () => {
    const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' })
    const path = join(dir, 'a.ts')
    expect(planProjectReplace(dir, '^const', { regex: true }).matches).toBe(3)

    const result = replaceProject([path], '^const', 'let', { regex: true })
    expect(result.matches).toBe(3)
    expect(readFileSync(path, 'utf8')).toBe('let a = 1\nlet b = 2\nlet c = 3\n')
  })

  test('a trailing anchor counts and replaces alike', () => {
    const dir = fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' })
    const path = join(dir, 'a.ts')
    const result = replaceProject([path], String.raw`\d$`, 'N', { regex: true })
    expect(result.matches).toBe(2)
    expect(readFileSync(path, 'utf8')).toBe('const a = N\nconst b = N\n')
  })
})
