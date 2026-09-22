import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { symbolChain } from '../src/lsp/symbols'
import { fixture, launch, servedBy, untilFrame } from './helpers'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

test('the chain is the symbols the line sits inside', () => {
  const symbols = [
    {
      children: [
        {
          name: 'ring',
          range: {
            end: { character: 3, line: 2 },
            start: { character: 2, line: 1 },
          },
        },
      ],
      name: 'Bell',
      range: {
        end: { character: 1, line: 3 },
        start: { character: 0, line: 0 },
      },
    },
  ]
  expect(symbolChain(symbols, 2)).toEqual(['Bell', 'ring'])
  expect(symbolChain(symbols, 0)).toEqual(['Bell'])
  expect(symbolChain(symbols, 9)).toEqual([])
  expect(symbolChain(null, 0)).toEqual([])
})

test('the row under the tabs carries the path and the symbol at the caret', async () => {
  const dir = fixture({ 'src/app/a.ts': 'class Bell {\n  ring() {}\n}\n' })
  const t = await launch(
    dir,
    { ...servedBy(process.execPath, FAKE), breadcrumbs: true },
    { height: 20, width: 100 },
    { openFile: join(dir, 'src/app/a.ts'), openLine: 1 }
  )

  // The tab carries the name; the crumbs are the folders and then the symbols.
  await untilFrame(t, 'src › app', 15_000)
  await untilFrame(t, 'Bell › ring', 15_000)
}, 40_000)

test('breadcrumbs off leaves the row out', async () => {
  const dir = fixture({ 'src/app/a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    {},
    { height: 20, width: 100 },
    { openFile: join(dir, 'src/app/a.ts') }
  )
  expect(t.captureCharFrame()).not.toContain('src › app')
})
