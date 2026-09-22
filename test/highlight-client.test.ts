import { expect, test } from 'bun:test'

import { getTreeSitterClient } from '@opentui/core'

import {
  computeHighlights,
  highlightClient,
  STALE,
} from '../src/languages/highlight'

const keywords = async (source: string) => {
  const parsed = await computeHighlights(source, 'typescript')
  if (parsed === STALE) {
    throw new TypeError('unreachable')
  }
  return parsed.ordered.filter((capture) => capture.group === 'keyword')
}

test('an init a destroy cut short does not kill highlighting for the process', async () => {
  const pending = highlightClient()
  // What a renderer teardown does to the shared client while druk is still starting it up.
  await getTreeSitterClient().destroy()
  await pending

  expect(await keywords('const one = 1\n')).not.toBeEmpty()
})

test('a destroyed client is replaced rather than handed on', async () => {
  const client = await highlightClient()
  expect(client).not.toBeNull()
  await client?.destroy()

  expect(await highlightClient()).not.toBeNull()
  expect(await keywords('const two = 2\n')).not.toBeEmpty()
})
