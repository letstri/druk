import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadNotes, readNotes, saveNotes } from '../src/core/review'
import type { ReviewNote } from '../src/core/review'
import { tempDir } from './temp'

const notesFile = () => join(tempDir('druk-review-store-'), 'review.json')

const note = (id: string, over: Partial<ReviewNote> = {}): ReviewNote => ({
  at: 1,
  body: id,
  endLine: 1,
  id,
  kind: 'issue',
  line: 1,
  path: '/p/src/a.ts',
  ...over,
})

test('a save keeps the note another writer added meanwhile', () => {
  const file = notesFile()
  saveNotes('/p', [note('theirs')], { file })
  saveNotes('/p', [note('mine')], { file, seen: new Set(['mine']) })
  expect(
    loadNotes('/p', file)
      .map((held) => held.id)
      .toSorted()
  ).toEqual(['mine', 'theirs'])
})

test('a reply survives the round trip, and keeps who wrote it', () => {
  const file = notesFile()
  const answer = note('r1', {
    author: 'claude',
    body: 'fixed',
    kind: 'note',
    parent: 'a',
  })
  saveNotes('/p', [note('a'), answer], { file })
  const held = loadNotes('/p', file)
  expect(held).toHaveLength(2)
  expect(held[1]).toMatchObject({ author: 'claude', parent: 'a' })
  expect(held[0]!.parent).toBeUndefined()
})

test('an agent may answer a note this session is holding', () => {
  const file = notesFile()
  saveNotes('/p', [note('a')], { file, seen: new Set(['a']) })
  saveNotes('/p', [note('a'), note('r1', { author: 'claude', parent: 'a' })], {
    file,
  })
  saveNotes('/p', [note('a')], { file, seen: new Set(['a']) })
  expect(loadNotes('/p', file).map((held) => held.id)).toEqual(['a', 'r1'])
})

test('a note removed this session stays removed', () => {
  const file = notesFile()
  saveNotes('/p', [note('a'), note('b')], { file })
  saveNotes('/p', [note('b')], { file, seen: new Set(['a', 'b']) })
  expect(loadNotes('/p', file).map((held) => held.id)).toEqual(['b'])
})

test("the file's copy wins for an id both sides hold", () => {
  const file = notesFile()
  saveNotes(
    '/p',
    [note('a', { body: 'rewritten elsewhere', endLine: 9, line: 9 })],
    { file }
  )
  saveNotes('/p', [note('a')], { file, seen: new Set(['a']) })
  const held = loadNotes('/p', file)
  expect(held).toHaveLength(1)
  expect(held[0]!.body).toBe('rewritten elsewhere')
  expect(held[0]!.line).toBe(9)
})

test('a clear does not delete the note another writer just added', () => {
  const file = notesFile()
  saveNotes('/p', [note('theirs')], { file })
  saveNotes('/p', [], { file, seen: new Set(['mine']) })
  expect(loadNotes('/p', file).map((held) => held.id)).toEqual(['theirs'])
  saveNotes('/p', [], { file, seen: new Set(['mine', 'theirs']) })
  expect(readFileSync(file, 'utf-8')).not.toContain('/p')
})

test("another project's entry passes through a save untouched", () => {
  const file = notesFile()
  saveNotes('/other', [note('x', { path: '/other/b.ts' })], { file })
  saveNotes('/p', [note('mine')], { file, seen: new Set(['mine']) })
  expect(loadNotes('/other', file)).toEqual([
    note('x', { path: '/other/b.ts' }),
  ])
})

test('an unreadable file is set aside, never rewritten from nothing', () => {
  const file = notesFile()
  writeFileSync(file, '{ torn mid-write')
  saveNotes('/p', [note('mine')], { file, now: 7, seen: new Set(['mine']) })
  const dir = join(file, '..')
  const aside = readdirSync(dir).find((name) =>
    name.startsWith('review.json.corrupt-')
  )
  expect(aside).toBeDefined()
  expect(readFileSync(join(dir, aside!), 'utf-8')).toBe('{ torn mid-write')
  expect(loadNotes('/p', file)).toEqual([note('mine')])
})

test('reading tells "unreadable" apart from "missing"', () => {
  const file = notesFile()
  expect(readNotes('/p', file)).toEqual([])
  writeFileSync(file, 'not json')
  expect(readNotes('/p', file)).toBeNull()
  expect(loadNotes('/p', file)).toEqual([])
})

test('no temp file outlives a save', () => {
  const file = notesFile()
  saveNotes('/p', [note('mine')], { file, seen: new Set(['mine']) })
  expect(readdirSync(join(file, '..'))).toEqual(['review.json'])
})

test('the trim drops the least recently touched project, not the most', () => {
  const file = notesFile()
  for (let i = 1; i <= 21; i += 1) {
    saveNotes(`/p${i}`, [note(`n${i}`, { path: `/p${i}/a.ts` })], {
      file,
      now: i,
    })
  }
  expect(loadNotes('/p1', file)).toEqual([])
  expect(loadNotes('/p2', file)).toHaveLength(1)
  expect(loadNotes('/p21', file)).toHaveLength(1)
})

test('an entry saved without touchedAt is fresh, not the first casualty', () => {
  const file = notesFile()
  for (let i = 1; i <= 20; i += 1) {
    saveNotes(`/p${i}`, [note(`n${i}`, { path: `/p${i}/a.ts` })], {
      file,
      now: i,
    })
  }
  const all = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
  all['/agent'] = { notes: [note('theirs', { path: '/agent/a.ts' })] }
  writeFileSync(file, JSON.stringify(all))
  saveNotes('/p1', [note('n1', { path: '/p1/a.ts' })], {
    file,
    now: 22,
    seen: new Set(['n1']),
  })
  expect(loadNotes('/agent', file)).toHaveLength(1)
  expect(loadNotes('/p2', file)).toEqual([])
})
