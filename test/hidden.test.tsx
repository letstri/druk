import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { listDir } from '../src/core/fs'
import { ignoredPaths } from '../src/core/git'
import { listFiles, searchProject } from '../src/core/search'
import { fixture, launch, toggleSetting } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

const PROJECT = {
  '.DS_Store': 'junk\n',
  '.gitignore': 'dist\n',
  'src/main.ts': 'const a = 1\n',
}

describe('the tree lists everything by default', () => {
  test('dotfiles included', async () => {
    const t = await launch(fixture(PROJECT))
    const frame = t.captureCharFrame()
    expect(frame).toContain('.gitignore')
    expect(frame).toContain('.DS_Store')
  })
})

describe('showDotfiles: false', () => {
  test('dotfiles leave the tree, ordinary files stay', async () => {
    const t = await launch(fixture(PROJECT), { showDotfiles: false })
    const frame = t.captureCharFrame()
    expect(frame).toContain('src')
    expect(frame).not.toContain('.gitignore')
    expect(frame).not.toContain('.DS_Store')
  })

  test('the settings page toggles it back on', async () => {
    const t = await launch(fixture(PROJECT), { showDotfiles: false })
    expect(t.captureCharFrame()).not.toContain('.DS_Store')
    await toggleSetting(t, 'Show dotfiles')
    expect(t.captureCharFrame()).toContain('.DS_Store')
  })
})

function ignoredRepo() {
  const dir = tempDir('druk-ignored-')
  initRepo(dir)
  writeFileSync(join(dir, '.gitignore'), 'dist\n*.log\n')
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  writeFileSync(join(dir, 'debug.log'), 'noise\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'bundle.js'), 'var a=1\n')
  return dir
}

describe('respectGitignore: true', () => {
  test('ignoredPaths reports files and collapsed directories, absolute', () => {
    const dir = ignoredRepo()
    const ignored = ignoredPaths(dir)
    expect(ignored).toEqual(
      new Set([join(dir, 'dist'), join(dir, 'debug.log')])
    )
  })

  test('ignoredPaths is empty outside a repository', () => {
    expect(ignoredPaths(fixture(PROJECT)).size).toBe(0)
  })

  test('ignored entries leave the tree, tracked and clean ones stay', async () => {
    const t = await launch(ignoredRepo(), { respectGitignore: true })
    const frame = t.captureCharFrame()
    expect(frame).toContain('a.ts')
    expect(frame).toContain('.gitignore')
    expect(frame).not.toContain('dist')
    expect(frame).not.toContain('debug.log')
  })

  test('off by default: ignored entries are listed', async () => {
    const t = await launch(ignoredRepo())
    const frame = t.captureCharFrame()
    expect(frame).toContain('dist')
    expect(frame).toContain('debug.log')
  })

  test('outside a repository nothing is hidden', async () => {
    const t = await launch(fixture(PROJECT), { respectGitignore: true })
    const frame = t.captureCharFrame()
    expect(frame).toContain('.DS_Store')
    expect(frame).toContain('.gitignore')
  })

  test('the settings page toggles it', async () => {
    const t = await launch(ignoredRepo())
    expect(t.captureCharFrame()).toContain('dist')
    await toggleSetting(t, 'Hide git-ignored')
    expect(t.captureCharFrame()).not.toContain('dist')
  })
})

function searchRepo() {
  const dir = tempDir('druk-searchignore-')
  initRepo(dir)
  writeFileSync(join(dir, '.gitignore'), 'generated\n.worktrees\n')
  writeFileSync(join(dir, 'a.ts'), 'const alpha = 1\n')
  mkdirSync(join(dir, 'generated'))
  writeFileSync(join(dir, 'generated', 'bundle.js'), 'var alpha = 1\n')
  mkdirSync(join(dir, '.worktrees', 'copy'), { recursive: true })
  writeFileSync(join(dir, '.worktrees', 'copy', 'a.ts'), 'const alpha = 1\n')
  return dir
}

describe('project search and the fuzzy picker skip ignored files', () => {
  test('a search finds the source file and neither copy of it', () => {
    const dir = searchRepo()
    const hits = searchProject(dir, 'alpha').map((match) =>
      match.path.slice(dir.length + 1)
    )
    expect(hits).toEqual(['a.ts'])
  })

  test('the picker lists neither', () => {
    const dir = searchRepo()
    const files = listFiles(dir).map((path) => path.slice(dir.length + 1))
    expect(files).toEqual(['.gitignore', 'a.ts'])
  })

  test('outside a repository everything is listed', () => {
    const dir = tempDir('druk-searchplain-')
    writeFileSync(join(dir, '.gitignore'), 'generated\n')
    mkdirSync(join(dir, 'generated'))
    writeFileSync(join(dir, 'generated', 'bundle.js'), 'var alpha = 1\n')
    expect(searchProject(dir, 'alpha')).toHaveLength(1)
  })
})

function vcsRepo() {
  const dir = tempDir('druk-vcs-')
  initRepo(dir)
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  writeFileSync(join(dir, '.gitignore'), 'dist\n')
  return dir
}

describe('the VCS store is not project content', () => {
  test('.git is left out of the tree, .gitignore is not', async () => {
    const t = await launch(vcsRepo())
    const frame = t.captureCharFrame()
    expect(frame).toContain('.gitignore')
    const rows = frame.split('\n').map((row) => row.slice(0, 30).trim())
    expect(rows).not.toContain('.git')
  })

  test('listDir drops it whatever the caller asks for', () => {
    const names = listDir(vcsRepo()).map((node) => node.name)
    expect(names).toContain('.gitignore')
    expect(names).not.toContain('.git')
  })

  test('the fuzzy picker and project search never walk into it', () => {
    const dir = vcsRepo()
    const files = listFiles(dir).map((path) => path.slice(dir.length + 1))
    expect(files).toContain('.gitignore')
    expect(files.some((path) => path.startsWith('.git/'))).toBe(false)
  })

  test('a file named like a VCS directory is still a file', () => {
    const dir = tempDir('druk-vcsfile-')
    writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere\n')
    expect(listDir(dir).map((node) => node.name)).toContain('.git')
  })
})
