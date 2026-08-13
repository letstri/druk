import { describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { flattenVisible, listDir } from '../src/core/fs'
import { launch, openFile, press } from './helpers'
import { tempDir } from './temp'

/** A project holding a real directory and file, plus symlinks to each. */
function linked() {
  const base = tempDir('druk-link-')
  const target = join(base, 'target')
  const project = join(base, 'project')
  mkdirSync(target)
  mkdirSync(project)
  writeFileSync(join(target, 'inside.ts'), 'const inside = 1\n')
  writeFileSync(join(base, 'real.ts'), 'const real = 2\n')

  symlinkSync(target, join(project, 'skills'))
  symlinkSync(join(base, 'real.ts'), join(project, 'linked.ts'))
  symlinkSync(join(base, 'nowhere.ts'), join(project, 'broken.ts'))
  return { project, target }
}

describe('listing symlinks', () => {
  test('a link to a directory is a directory', () => {
    // The dirent describes the link, so this used to come back as a file — and
    // opening it raised "EISDIR: illegal operation on a directory, read".
    const { project } = linked()
    const skills = listDir(project).find(node => node.name === 'skills')

    expect(skills?.isDir).toBe(true)
    expect(skills?.symlink).toBe(true)
  })

  test('a link to a file is a file, and is marked as a link', () => {
    const { project } = linked()
    const link = listDir(project).find(node => node.name === 'linked.ts')

    expect(link?.isDir).toBe(false)
    expect(link?.symlink).toBe(true)
  })

  test('a broken link stays listed instead of disappearing', () => {
    const { project } = linked()
    const broken = listDir(project).find(node => node.name === 'broken.ts')

    expect(broken).toBeDefined()
    expect(broken?.isDir).toBe(false)
  })

  test('an ordinary entry is not marked', () => {
    const { project } = linked()
    writeFileSync(join(project, 'plain.ts'), 'const plain = 3\n')

    expect(listDir(project).find(node => node.name === 'plain.ts')?.symlink).toBeUndefined()
  })

  test('expanding a linked directory lists what it points at', () => {
    const { project } = linked()
    const rows = flattenVisible(project, new Set([join(project, 'skills')]))

    expect(rows.map(node => node.name)).toContain('inside.ts')
  })

  test('a link pointing at its own parent does not loop forever', () => {
    const { project } = linked()
    const loop = join(project, 'loop')
    symlinkSync(project, loop)

    // Every level expanded: without a cycle guard this never returns.
    const rows = flattenVisible(project, new Set([loop, join(loop, 'loop')]))
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('opening symlinks', () => {
  test('a linked directory expands rather than erroring', async () => {
    const { project } = linked()
    const t = await launch(project)

    await press(t, input => input.pressArrow('down')) // skills, the linked directory
    await press(t, input => input.pressEnter())

    expect(t.captureCharFrame()).toContain('inside.ts')
  })

  test('a linked file opens its target’s contents', async () => {
    const { project } = linked()
    const t = await launch(project)

    await openFile(t, 'linked.ts')

    expect(t.captureCharFrame()).toContain('const real = 2')
  })

  test('the tree marks a link so it reads as one', async () => {
    const { project } = linked()
    const t = await launch(project)

    expect(t.captureCharFrame()).toContain('↗')
  })
})
