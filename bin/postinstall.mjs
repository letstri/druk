#!/usr/bin/env node
// Silent, and exit zero: installing something that merely depends on druk must not break.
import { fetchBinary, findBinary, supported, target } from './binary.mjs'
import { removeWindowsBareShim } from './windows-shim.mjs'

// Before the download: a cancelled install would leave the launcher PowerShell chokes on.
removeWindowsBareShim()

// Bounded: undici waits on a trickling body for hours; the shim fetches again on first run.
if (supported && !findBinary()) {
  process.stderr.write(`druk: fetching the ${target} binary…\n`)
  await fetchBinary({ timeout: 60_000 })
}
