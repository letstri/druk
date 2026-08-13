import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRoot } from 'solid-js'

import { createTree } from '../src/app/tree'
import { fixture } from './helpers'

test('a refresh keeps the TreeNode identity of unchanged rows', () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
  createRoot(dispose => {
    const tree = createTree(dir, { expanded: [], selected: null })
    const before = tree.nodes()

    writeFileSync(join(dir, 'c.ts'), 'const c = 3\n')
    tree.refreshTree()
    const after = tree.nodes()

    // The tree's <For> keys rows by object: a fresh object per path would tear
    // down and rebuild every visible row on every watcher tick.
    expect(after.length).toBe(before.length + 1)
    for (const node of before) {
      expect(after.find(other => other.path === node.path)).toBe(node)
    }
    dispose()
  })
})

test('a changed row gets a fresh object', () => {
  const dir = fixture({ sub: '' })
  createRoot(dispose => {
    const tree = createTree(dir, { expanded: [], selected: null })
    const before = tree.nodes().find(node => node.name === 'sub')!
    expect(before.isDir).toBe(false)

    Bun.spawnSync(['rm', join(dir, 'sub')])
    Bun.spawnSync(['mkdir', join(dir, 'sub')])
    tree.refreshTree()
    const after = tree.nodes().find(node => node.name === 'sub')!

    expect(after.isDir).toBe(true)
    expect(after).not.toBe(before)
    dispose()
  })
})
