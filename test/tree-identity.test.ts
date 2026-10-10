import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRoot } from 'solid-js'

import { createTree } from '../src/app/tree'
import { fixture } from './helpers'
import { initRepo } from './repo'

test('a refresh keeps the TreeNode identity of unchanged rows', () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
  createRoot((dispose) => {
    const tree = createTree(dir, { expanded: [], selected: null })
    const before = tree.nodes()

    writeFileSync(join(dir, 'c.ts'), 'const c = 3\n')
    tree.refreshTree()
    const after = tree.nodes()

    expect(after.length).toBe(before.length + 1)
    for (const node of before) {
      expect(after.find((other) => other.path === node.path)).toBe(node)
    }
    dispose()
  })
})

test('a changed row gets a fresh object', () => {
  const dir = fixture({ sub: '' })
  createRoot((dispose) => {
    const tree = createTree(dir, { expanded: [], selected: null })
    const before = tree.nodes().find((node) => node.name === 'sub')!
    expect(before.isDir).toBe(false)

    Bun.spawnSync(['rm', join(dir, 'sub')])
    Bun.spawnSync(['mkdir', join(dir, 'sub')])
    tree.refreshTree()
    const after = tree.nodes().find((node) => node.name === 'sub')!

    expect(after.isDir).toBe(true)
    expect(after).not.toBe(before)
    dispose()
  })
})

test('shutting a folder drops every expanded path under it, on disk or not', () => {
  const dir = fixture({ 'a.ts': '', 'src/deep/b.ts': '' })
  const src = join(dir, 'src')
  const outside = join(dir, 'srcish')
  createRoot((dispose) => {
    const tree = createTree(dir, {
      expanded: [src, join(src, 'deep'), join(src, 'ghost', 'gone'), outside],
      selected: null,
    })

    tree.setExpandedBelow(src, false)

    expect([...tree.expanded()]).toEqual([outside])
    dispose()
  })
})

test('opening everything below a folder leaves git-ignored folders listed but shut', () => {
  const dir = initRepo(
    fixture({
      '.gitignore': 'node_modules/\n',
      'pkg/node_modules/dep/lib/x.js': '',
      'pkg/src/deep/b.ts': '',
    })
  )
  const pkg = join(dir, 'pkg')
  createRoot((dispose) => {
    const tree = createTree(dir, { expanded: [], selected: null })

    tree.setExpandedBelow(pkg, true)

    expect([...tree.expanded()].toSorted()).toEqual([
      pkg,
      join(pkg, 'src'),
      join(pkg, 'src', 'deep'),
    ])
    expect(tree.nodes().map((node) => node.path)).toContain(
      join(pkg, 'node_modules')
    )
    dispose()
  })
})
