import { expect, test } from 'bun:test'

import { createRoot } from 'solid-js'

import { createStatus } from '../src/app/status'

test('a claim takes the free slot and its release gives it back', () => {
  const root = createRoot(dispose => ({ status: createStatus(), dispose }))
  const release = root.status.claimBusy({ label: 'Installing eslint' })

  expect(root.status.busy()).toEqual({ label: 'Installing eslint' })
  release()
  expect(root.status.busy()).toBeNull()
  root.dispose()
})

test('an install that finds the slot taken never clears the counter in it', () => {
  const root = createRoot(dispose => ({ status: createStatus(), dispose }))
  const { status } = root
  // A bulk delete has the slot; `whileFree` is what keeps a second one off the
  // tree while it runs, so an install releasing it would be reopening that gate.
  const deleting = status.claimBusy({ label: 'Deleting', done: 0, total: 500 })
  const installing = status.claimBusy({ label: 'Installing catppuccin' })

  expect(status.busy()).toEqual({ label: 'Deleting', done: 0, total: 500 })
  installing()
  expect(status.busy()).toEqual({ label: 'Deleting', done: 0, total: 500 })

  let ran = false
  status.whileFree(() => {
    ran = true
  })
  expect(ran).toBe(false)
  expect(status.status().msg).toBe('Deleting already — let it finish')

  deleting()
  expect(status.busy()).toBeNull()
  status.whileFree(() => {
    ran = true
  })
  expect(ran).toBe(true)
  root.dispose()
})
