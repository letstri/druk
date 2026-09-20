import { appendFileSync } from 'node:fs'

appendFileSync(process.argv[2]!, 'spawned\n')
await import('./fake-lsp')
