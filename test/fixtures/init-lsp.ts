import { writeFileSync } from 'node:fs'

import { createDecoder } from '../../src/lsp/transport'

const dump = process.argv[2]!
process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method !== 'initialize') return
    const params = message.params as { initializationOptions?: unknown } | undefined
    writeFileSync(dump, JSON.stringify(params?.initializationOptions ?? null))
  }),
)

await import('./fake-lsp')
