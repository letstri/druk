import { dirname, resolve } from 'node:path'

import { exists, isDirectory } from './fs'
import { currentVersion } from './update'

export const HELP = `druk — terminal code editor

Usage: druk [path]
       druk update

  path            file or directory to open (default: the current directory)
  update          upgrade druk itself, however it was installed

Options:
  -h, --help      show this help
  -v, --version   show the version
`

export function flagOutput(arg: string | undefined): string | null {
  if (arg === '-h' || arg === '--help') return HELP
  if (arg === '-v' || arg === '--version') return `${currentVersion()}\n`
  return null
}

export interface Target {
  rootDir: string
  openFile: string | null
  line: number | null
  col: number | null
}

export function resolveTarget(arg: string | undefined, cwd: string): Target | null {
  const target = resolve(cwd, arg ?? '.')
  if (exists(target)) {
    if (isDirectory(target)) return { rootDir: target, openFile: null, line: null, col: null }
    return { rootDir: dirname(target), openFile: target, line: null, col: null }
  }

  // Lazy, so `file.ts:42:7` reads as line 42 column 7, not a file named `file.ts:42`.
  const at = /^(.+?):(\d+)(?::(\d+))?$/.exec(arg ?? '')
  if (at) {
    const file = resolve(cwd, at[1]!)
    if (exists(file) && !isDirectory(file)) {
      return {
        rootDir: dirname(file),
        openFile: file,
        line: Math.max(0, Number(at[2]) - 1),
        col: at[3] ? Math.max(0, Number(at[3]) - 1) : null,
      }
    }
  }
  return null
}
