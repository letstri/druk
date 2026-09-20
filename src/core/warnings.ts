import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

const WARNINGS_LOG = join(
  process.env.XDG_STATE_HOME ?? join(os.homedir(), '.local', 'state'),
  'druk',
  'druk.log',
)

// Bun's own warning listener writes to stderr, i.e. the screen: only removing it silences it.
export function divertWarnings(file = WARNINGS_LOG): void {
  process.removeAllListeners('warning')
  process.on('warning', warning => {
    const text = warning.stack ?? `${warning.name}: ${warning.message}`
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${new Date().toISOString()} ${text}\n`)
    } catch {
      // best-effort
    }
  })
}
