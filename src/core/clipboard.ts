import { spawnSync } from 'node:child_process'

const COPY: [string, string[]][] = [
  ['pbcopy', []],
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']],
  ['xsel', ['--clipboard', '--input']],
  // Not `clip`, which reads its stdin as the console code page and mangles anything non-ASCII.
  ['powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard']],
]

const PASTE: [string, string[]][] = [
  ['pbpaste', []],
  ['wl-paste', ['--no-newline']],
  ['xclip', ['-selection', 'clipboard', '-o']],
  ['xsel', ['--clipboard', '--output']],
  // Windows: `clip` is write-only and `Get-Clipboard` without -Raw appends a newline per line.
  ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']],
]

export function copyToClipboard(text: string): boolean {
  for (const [command, args] of COPY) {
    // Spawning a missing binary costs a failed fork; a PATH lookup does not.
    if (!Bun.which(command)) {
      continue
    }
    const run = spawnSync(command, args, { input: text, timeout: 2000 })
    if (!run.error && run.status === 0) {
      return true
    }
  }
  return false
}

export function readClipboard(): string | null {
  for (const [command, args] of PASTE) {
    if (!Bun.which(command)) {
      continue
    }
    const run = spawnSync(command, args, { encoding: 'utf-8', timeout: 2000 })
    if (!run.error && run.status === 0) {
      return run.stdout
    }
  }
  return null
}
