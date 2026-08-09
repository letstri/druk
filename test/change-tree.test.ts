import { expect, test } from 'bun:test'

import { changeRows, changesFor, foldKey, parentRow } from '../src/core/changeTree'
import type { Change } from '../src/core/changeTree'

const changes = (...rels: string[]): Change[] =>
  rels
    .toSorted((a, b) => a.localeCompare(b))
    .map(rel => ({
      path: `/root/${rel}`,
      rel,
      status: 'modified' as const,
      area: 'unstaged' as const,
    }))

const staged = (...rels: string[]): Change[] =>
  changes(...rels).map(change => ({ ...change, area: 'staged' as const }))

/** `kind:label@depth` per row — the shape a panel row renders from. */
const shape = (rows: ReturnType<typeof changeRows>) =>
  rows.map(row => `${row.kind}:${row.label}@${row.depth}`)

/** The rows without the headings, which most of these tests are not about. */
const plain = (list: Change[], mode: 'list' | 'tree', collapsed: ReadonlySet<string> = new Set()) =>
  changeRows(list, mode, collapsed, false)

test('the flat list is one row per change, under its whole path', () => {
  expect(shape(plain(changes('src/app/a.ts', 'b.ts'), 'list'))).toEqual([
    'file:b.ts@0',
    'file:src/app/a.ts@0',
  ])
})

test('the tree nests files under a folder row', () => {
  const rows = plain(changes('src/a.ts', 'src/b.ts', 'c.ts'), 'tree')

  expect(shape(rows)).toEqual(['file:c.ts@0', 'dir:src@0', 'file:a.ts@1', 'file:b.ts@1'])
})

test('a folder with one child folder is joined into one row', () => {
  // Two rows for `src` and `app` would spend half a narrow sidebar on folders
  // that say nothing on their own.
  const rows = plain(changes('src/app/a.ts', 'src/app/b.ts'), 'tree')

  expect(shape(rows)).toEqual(['dir:src/app@0', 'file:a.ts@1', 'file:b.ts@1'])
})

test('the join stops where the paths part', () => {
  const rows = plain(changes('src/app/a.ts', 'src/ui/b.ts'), 'tree')

  expect(shape(rows)).toEqual(['dir:src@0', 'dir:app@1', 'file:a.ts@2', 'dir:ui@1', 'file:b.ts@2'])
})

test('a collapsed folder keeps its row and hides its subtree', () => {
  const shut = new Set([foldKey('unstaged', 'src')])
  const rows = plain(changes('src/a.ts', 'src/b.ts', 'c.ts'), 'tree', shut)

  expect(shape(rows)).toEqual(['file:c.ts@0', 'dir:src@0'])
  // The count is what the row shows in place of the files it is hiding.
  expect(rows.find(row => row.kind === 'dir')).toMatchObject({ collapsed: true, files: 2 })
})

test('collapsing an outer folder hides the inner folders too', () => {
  const shut = new Set([foldKey('unstaged', 'a')])
  const rows = plain(changes('a/b/c.ts', 'a/d/e.ts', 'z.ts'), 'tree', shut)

  expect(shape(rows)).toEqual(['dir:a@0', 'file:z.ts@0'])
})

test('← walks a file out to the folder holding it', () => {
  const rows = plain(changes('src/app/a.ts', 'src/ui/b.ts'), 'tree')
  //             0: src   1: app   2: a.ts   3: ui   4: b.ts
  expect(parentRow(rows, 2)).toBe(1)
  expect(parentRow(rows, 1)).toBe(0)
  // Nothing outside the top level to walk to: the cursor stays put.
  expect(parentRow(rows, 0)).toBe(0)
})

test('the two headings each carry their own changes, staged first', () => {
  const rows = changeRows([...staged('a.ts'), ...changes('b.ts')], 'list')

  expect(shape(rows)).toEqual([
    'section:Staged Changes@0',
    'file:a.ts@1',
    'section:Changes@0',
    'file:b.ts@1',
  ])
})

test('a heading with nothing under it is not drawn', () => {
  expect(shape(changeRows(changes('a.ts'), 'list'))).toEqual(['section:Changes@0', 'file:a.ts@1'])
})

test('a heading folds away everything under it', () => {
  const list = [...staged('a.ts'), ...changes('b.ts')]
  const rows = changeRows(list, 'list', new Set([foldKey('staged', '')]))

  expect(shape(rows)).toEqual(['section:Staged Changes@0', 'section:Changes@0', 'file:b.ts@1'])
})

test('one path half-staged is a row under each heading', () => {
  const list = [...staged('a.ts'), ...changes('a.ts')]
  const rows = changeRows(list, 'list')

  expect(shape(rows)).toEqual([
    'section:Staged Changes@0',
    'file:a.ts@1',
    'section:Changes@0',
    'file:a.ts@1',
  ])
  // Folding one heading leaves the other's copy of the file alone.
  expect(shape(changeRows(list, 'list', new Set([foldKey('staged', '')])))).toEqual([
    'section:Staged Changes@0',
    'section:Changes@0',
    'file:a.ts@1',
  ])
})

test('a heading stands for every change in it, a folder for its subtree', () => {
  const list = [...staged('src/a.ts'), ...changes('src/b.ts', 'c.ts')]
  const rows = changeRows(list, 'tree')
  const rels = (at: number) => changesFor(list, rows[at]!).map(change => change.rel)

  //           0: Staged  1: src  2: a.ts  3: Changes  4: c.ts  5: src  6: b.ts
  expect(rels(0)).toEqual(['src/a.ts'])
  expect(rels(3)).toEqual(['c.ts', 'src/b.ts'])
  expect(rels(5)).toEqual(['src/b.ts'])
  expect(rels(6)).toEqual(['src/b.ts'])
})

test('← walks a top-level row out to its heading', () => {
  const rows = changeRows(changes('src/a.ts'), 'tree')
  //           0: Changes  1: src  2: a.ts
  expect(parentRow(rows, 2)).toBe(1)
  expect(parentRow(rows, 1)).toBe(0)
  expect(parentRow(rows, 0)).toBe(0)
})
