#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

import {
  exe,
  fetchBinary,
  findBinary,
  supported,
  target,
  version,
} from './binary.mjs'

let binary = findBinary()

if (!binary) {
  if (!supported) {
    process.stderr.write(`druk: no binary is published for ${target}.\n`)
    process.exit(1)
  }
  // Bounded, so a stalled download ends in the actionable error below.
  process.stderr.write(`druk: fetching the ${target} binary for ${version}…\n`)
  binary = await fetchBinary({ timeout: 300_000 })
}

if (!binary) {
  process.stderr.write(
    `druk: could not fetch the ${target} binary for ${version}.\n` +
      `Download druk-${target} from https://github.com/letstri/druk/releases/tag/v${version}\n` +
      `and put it on your PATH as ${exe}, or install with:\n` +
      `  curl -fsSL https://druk.sh/install | bash\n`
  )
  process.exit(1)
}

const { status, signal, error } = spawnSync(binary, process.argv.slice(2), {
  stdio: 'inherit',
})

if (error) {
  process.stderr.write(`druk: could not run ${binary}: ${error.message}\n`)
  process.exit(1)
}
// Re-raise rather than exit(0): `$?` for a signalled child is 128 + signum, not 0.
if (signal) {
  process.kill(process.pid, signal)
}
process.exit(status ?? 1)
