import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadNotes, readNotes, saveNotes } from '../src/core/review'
import type { ReviewNote } from '../src/core/review'

const notesFile = () => join(mkdtempSync(join(tmpdir(), 'druk-review-store-')), 'review.json')

const note = (id: string, over: Partial<ReviewNote> = {}): ReviewNote => ({
  id,
  path: '/p/src/a.ts',
  line: 1,
  endLine: 1,
  kind: 'issue',
  body: id,
  at: 1,
  ...over,
})

test('a save keeps the note another writer added meanwhile', () => {
  const file = notesFile()
  // The agent wrote first; this session has never seen "theirs".
  saveNotes('/p', [note('theirs')], { file })
  saveNotes('/p', [note('mine')], { seen: new Set(['mine']), file })
  expect(
    loadNotes('/p', file)
      .map(held => held.id)
      .toSorted(),
  ).toEqual(['mine', 'theirs'])
})

test('a note removed this session stays removed', () => {
  const file = notesFile()
  saveNotes('/p', [note('a'), note('b')], { file })
  // Both were seen; "a" is gone from the list because this session removed it.
  saveNotes('/p', [note('b')], { seen: new Set(['a', 'b']), file })
  expect(loadNotes('/p', file).map(held => held.id)).toEqual(['b'])
})

test("the file's copy wins for an id both sides hold", () => {
  const file = notesFile()
  saveNotes('/p', [note('a', { body: 'rewritten elsewhere', line: 9, endLine: 9 })], { file })
  // This session still holds the original — its copy is the stale one.
  saveNotes('/p', [note('a')], { seen: new Set(['a']), file })
  const held = loadNotes('/p', file)
  expect(held).toHaveLength(1)
  expect(held[0]!.body).toBe('rewritten elsewhere')
  expect(held[0]!.line).toBe(9)
})

test('a clear does not delete the note another writer just added', () => {
  const file = notesFile()
  saveNotes('/p', [note('theirs')], { file })
  saveNotes('/p', [], { seen: new Set(['mine']), file })
  expect(loadNotes('/p', file).map(held => held.id)).toEqual(['theirs'])
  // With nothing external left either, the entry itself goes.
  saveNotes('/p', [], { seen: new Set(['mine', 'theirs']), file })
  expect(readFileSync(file, 'utf8')).not.toContain('/p')
})

test("another project's entry passes through a save untouched", () => {
  const file = notesFile()
  saveNotes('/other', [note('x', { path: '/other/b.ts' })], { file })
  saveNotes('/p', [note('mine')], { seen: new Set(['mine']), file })
  expect(loadNotes('/other', file)).toEqual([note('x', { path: '/other/b.ts' })])
})

test('an unreadable file is set aside, never rewritten from nothing', () => {
  const file = notesFile()
  writeFileSync(file, '{ torn mid-write')
  saveNotes('/p', [note('mine')], { seen: new Set(['mine']), now: 7, file })
  const dir = join(file, '..')
  const aside = readdirSync(dir).find(name => name.startsWith('review.json.corrupt-'))
  expect(aside).toBeDefined()
  expect(readFileSync(join(dir, aside!), 'utf8')).toBe('{ torn mid-write')
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
  saveNotes('/p', [note('mine')], { seen: new Set(['mine']), file })
  expect(readdirSync(join(file, '..'))).toEqual(['review.json'])
})

test('the trim drops the least recently touched project, not the most', () => {
  const file = notesFile()
  for (let i = 1; i <= 21; i++) {
    saveNotes(`/p${i}`, [note(`n${i}`, { path: `/p${i}/a.ts` })], { now: i, file })
  }
  expect(loadNotes('/p1', file)).toEqual([])
  expect(loadNotes('/p2', file)).toHaveLength(1)
  expect(loadNotes('/p21', file)).toHaveLength(1)
})

test('an entry saved without touchedAt is fresh, not the first casualty', () => {
  const file = notesFile()
  for (let i = 1; i <= 20; i++) {
    saveNotes(`/p${i}`, [note(`n${i}`, { path: `/p${i}/a.ts` })], { now: i, file })
  }
  // An agent wrote an entry with no touchedAt at all.
  const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  all['/agent'] = { notes: [note('theirs', { path: '/agent/a.ts' })] }
  writeFileSync(file, JSON.stringify(all))
  saveNotes('/p1', [note('n1', { path: '/p1/a.ts' })], { seen: new Set(['n1']), now: 22, file })
  expect(loadNotes('/agent', file)).toHaveLength(1)
  // The eldest stamped entry paid for the trim instead.
  expect(loadNotes('/p2', file)).toEqual([])
})
