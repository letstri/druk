#!/usr/bin/env bun
import './core/assets'
import { flagOutput, resolveTarget } from './core/cli'
import { runUpgrade } from './core/upgrade'

// Dynamic import: bundled statically, @opentui/core runs before ./core/assets sets OTUI_ASSET_ROOT.

const flag = flagOutput(process.argv[2])
if (flag !== null) {
  process.stdout.write(flag)
  process.exit(0)
}

// Before the path handling: `update` is a command, not a directory to open.
if (process.argv[2] === 'update') {
  process.exit(await runUpgrade())
}

const target = resolveTarget(process.argv[2], process.cwd())
if (!target) {
  process.stderr.write(`druk: no such file or directory: ${process.argv[2]}\n`)
  process.exit(1)
}

const { main } = await import('./main')
await main(target)
