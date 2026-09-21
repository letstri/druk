import { expect, test } from 'bun:test'

import { createRoot } from 'solid-js'

import { createStatus } from '../src/app/status'

test('a claim takes the free slot and its release gives it back', () => {
  const root = createRoot((dispose) => ({ dispose, status: createStatus() }))
  const release = root.status.claimBusy({ label: 'Installing eslint' })

  expect(root.status.busy()).toEqual({ label: 'Installing eslint' })
  release()
  expect(root.status.busy()).toBeNull()
  root.dispose()
})

test('an install that finds the slot taken never clears the counter in it', () => {
  const root = createRoot((dispose) => ({ dispose, status: createStatus() }))
  const { status } = root
  const deleting = status.claimBusy({ done: 0, label: 'Deleting', total: 500 })
  const installing = status.claimBusy({ label: 'Installing catppuccin' })

  expect(status.busy()).toEqual({ done: 0, label: 'Deleting', total: 500 })
  installing()
  expect(status.busy()).toEqual({ done: 0, label: 'Deleting', total: 500 })

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
