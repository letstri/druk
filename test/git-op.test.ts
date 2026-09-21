import { expect, test } from 'bun:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { createRoot } from 'solid-js'

import { createGit, createGitOp } from '../src/app/git'
import { createStatus } from '../src/app/status'
import type { Workspace } from '../src/app/workspace'

test('a running command occupies the busy slot until it settles', async () => {
  const root = createRoot((dispose) => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {} as Workspace
    return {
      dispose,
      git,
      gitOp: createGitOp({ git, status, workspace }),
      status,
    }
  })
  const { promise: pending, resolve: finish } = Promise.withResolvers<{
    ok: true
    detail: string
  }>()

  root.gitOp('Committing', () => pending)

  expect(root.git.gitBusy()).toBe(true)
  expect(root.status.busy()).toEqual({ label: 'Committing' })

  finish({ detail: 'ok', ok: true })
  await sleep(0)

  expect(root.git.gitBusy()).toBe(false)
  expect(root.status.busy()).toBeNull()
  expect(root.status.status()).toEqual({ msg: 'ok', tone: 'info' })
  root.dispose()
})

test('git operations refuse concurrent commands before invoking them', () => {
  const root = createRoot((dispose) => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {} as Workspace
    return {
      dispose,
      git,
      gitOp: createGitOp({ git, status, workspace }),
      status,
    }
  })
  let invoked = false
  root.git.setGitBusy(true)

  root.gitOp('Discarding', () => {
    invoked = true
    return Promise.resolve({ detail: '', ok: true })
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
  const root = createRoot((dispose) => {
    const git = createGit('/repo', () => 'list')
    git.setRepos(['/repo'])
    const status = createStatus()
    const workspace = {
      clashWarning: () => null,
      followDisk: (path: string) => {
        followed.push(path)
      },
      syncFromDisk: () => {
        synced = true
        return { changed: [], deleted: [] }
      },
    } as unknown as Workspace
    return { dispose, gitOp: createGitOp({ git, status, workspace }) }
  })

  root.gitOp('Discarding', () => Promise.resolve({ detail: '', ok: true }), {
    touchesTree: {
      kind: 'followDisk',
      paths: ['/repo/a.ts', '/repo/old-a.ts'],
    },
  })
  await sleep(0)

  expect(followed).toEqual(['/repo/a.ts', '/repo/old-a.ts'])
  expect(synced).toBe(false)
  root.dispose()
})
