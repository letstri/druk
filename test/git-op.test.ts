import { expect, test } from 'bun:test'

import { createRoot } from 'solid-js'

import { createGit, createGitOp } from '../src/app/git'
import { createStatus } from '../src/app/status'
import type { Workspace } from '../src/app/workspace'

test('a running command occupies the busy slot until it settles', async () => {
  const root = createRoot(dispose => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {} as Workspace
    return { git, status, gitOp: createGitOp({ git, status, workspace }), dispose }
  })
  let finish!: (result: { ok: true; detail: string }) => void
  const pending = new Promise<{ ok: true; detail: string }>(resolve => {
    finish = resolve
  })

  root.gitOp('Committing', () => pending)

  expect(root.git.gitBusy()).toBe(true)
  expect(root.status.busy()).toEqual({ label: 'Committing' })

  finish({ ok: true, detail: 'ok' })
  await Bun.sleep(0)

  expect(root.git.gitBusy()).toBe(false)
  expect(root.status.busy()).toBeNull()
  expect(root.status.status()).toEqual({ msg: 'ok', tone: 'info' })
  root.dispose()
})

test('git operations refuse concurrent commands before invoking them', () => {
  const root = createRoot(dispose => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {} as Workspace
    return { git, status, gitOp: createGitOp({ git, status, workspace }), dispose }
  })
  let invoked = false
  root.git.setGitBusy(true)

  root.gitOp('Discarding', async () => {
    invoked = true
    return { ok: true, detail: '' }
  })

  expect(invoked).toBe(false)
  expect(root.status.status()).toEqual({
    msg: 'A git command is already running — let it finish',
    tone: 'warn',
  })
  root.dispose()
})

test('a confirmed row rewrite follows its paths instead of clash-safe tree sync', async () => {
  const followed: string[] = []
  let synced = false
  const root = createRoot(dispose => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {
      followDisk: (path: string) => {
        followed.push(path)
      },
      syncFromDisk: () => {
        synced = true
        return { changed: [], deleted: [] }
      },
      clashWarning: () => null,
    } as unknown as Workspace
    return { gitOp: createGitOp({ git, status, workspace }), dispose }
  })

  root.gitOp('Discarding', async () => ({ ok: true, detail: '' }), {
    touchesTree: { kind: 'followDisk', paths: ['/repo/a.ts', '/repo/old-a.ts'] },
  })
  await Bun.sleep(0)

  expect(followed).toEqual(['/repo/a.ts', '/repo/old-a.ts'])
  expect(synced).toBe(false)
  root.dispose()
})
