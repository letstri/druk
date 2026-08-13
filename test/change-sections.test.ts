import { expect, test } from 'bun:test'

import { slotKey, takeChangeSections } from '../src/app/changeSections'
import type { Change } from '../src/core/changeTree'
import { unifiedDiff } from '../src/core/diff'
import { changesSummary } from '../src/ui/ChangesView'
import type { DiffFile } from '../src/ui/DiffView'

const change = (rel: string): Change => ({
  path: `/proj/${rel}`,
  rel,
  status: 'modified',
  area: 'unstaged',
})

const file = (rel: string, oldText: string, newText: string): DiffFile => ({
  path: `/proj/${rel}`,
  rel,
  status: 'modified',
  oldText,
  newText,
})

const filesFor = (entries: Change[], oldText: string, newText: string) => {
  const files = new Map(entries.map(entry => [entry.path, file(entry.rel, oldText, newText)]))
  return (entry: Change) => files.get(entry.path) ?? null
}

test('files past the row cap are omitted unless they are the cursor file', () => {
  const ordered = [change('a.ts'), change('b.ts'), change('c.ts')]
  const budget = unifiedDiff('a.ts', 'old\n', 'new\n').lines
  const fileFor = filesFor(ordered, 'old\n', 'new\n')

  const omitted = takeChangeSections(ordered, fileFor, new Map(), null, budget)
  expect(omitted.sections.map(s => s.rel)).toEqual(['a.ts'])

  const pinned = takeChangeSections(
    ordered,
    fileFor,
    new Map(),
    slotKey(ordered[2]!.path, ordered[2]!.area),
    budget,
  )
  expect(pinned.sections.map(s => s.rel)).toEqual(['a.ts', 'c.ts'])
})

test('a section whose texts have not moved is the previous object', () => {
  const a = change('a.ts')
  const fileFor = filesFor([a], 'old\n', 'new\n')
  const first = takeChangeSections([a], fileFor, new Map(), null)
  const second = takeChangeSections(
    [a],
    fileFor,
    new Map(first.sections.map(section => [section.key, section])),
    null,
  )
  expect(second.sections[0]).toBe(first.sections[0])
})

test('the truncated header names how many of the files are on screen', () => {
  expect(changesSummary('Uncommitted', 1, { total: 3, adds: 2, dels: 2 })).toBe(
    'Uncommitted · showing 1 of 3 files · +2 −2',
  )
  expect(changesSummary('Uncommitted', 3, { total: 3, adds: 4, dels: 1 })).toBe(
    'Uncommitted · 3 files · +4 −1',
  )
})
