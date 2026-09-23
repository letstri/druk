import { expect, test } from 'bun:test'

import { fileScore } from '../src/core/search'

const rank = (paths: string[], query: string) =>
  paths
    .map((path) => ({ path, score: fileScore(path, query) }))
    .filter((hit): hit is { path: string; score: number } => hit.score !== null)
    .toSorted((a, b) => a.score - b.score)
    .map((hit) => hit.path)

test('a match in the file name outranks one in the folders', () => {
  expect(
    rank(
      ['packages/ai/env.ts', 'apps/api/package.json', 'package.json'],
      'packag'
    )
  ).toEqual(['package.json', 'apps/api/package.json', 'packages/ai/env.ts'])
})

test('a query spanning folders still matches the path', () => {
  expect(rank(['src/db/index.ts', 'src/ui/list.ts'], 'db/index')).toEqual([
    'src/db/index.ts',
  ])
})
