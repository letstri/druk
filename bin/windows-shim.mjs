// PowerShell matches npm's extensionless launcher before PATHEXT and hands it to ShellExecute.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

// Launchers sit in the prefix, not prefix/bin; npm_config_prefix is set only when non-default.
export function removeWindowsBareShim({
  platform = process.platform,
  global: isGlobal = process.env.npm_config_global,
  location = process.env.npm_config_location,
  prefix = process.env.npm_config_global_prefix || process.env.npm_config_prefix,
} = {}) {
  if (platform !== 'win32' || !prefix) return
  if (isGlobal !== 'true' && location !== 'global') return
  try {
    rmSync(join(prefix, 'druk'))
  } catch {
    // best-effort: druk.cmd and druk.ps1 remain the Windows entry points
  }
}
