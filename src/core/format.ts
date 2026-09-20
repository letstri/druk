import { existsSync } from 'node:fs'
import { extname, isAbsolute, join, sep } from 'node:path'

import { firstLine, notInstalled, run } from './process'

const FORMAT_TIMEOUT = 10_000

export function formatterFor(path: string, formatters: Record<string, string[]>): string[] | null {
  const ext = extname(path).slice(1).toLowerCase()
  const same = (part: string) => part.trim().replace(/^\./, '').toLowerCase() === ext
  let fallback: string[] | null = null
  for (const [key, command] of Object.entries(formatters)) {
    if (command.length === 0) continue
    if (key === '*') {
      fallback = command
      continue
    }
    if (ext && key.split(',').some(same)) return command
  }
  return fallback
}

export const FILE_TOKEN = '{}'

export function formatArgs(command: string[], path: string): string[] {
  const args = command.slice(1)
  return args.some(arg => arg.includes(FILE_TOKEN))
    ? args.map(arg => arg.replaceAll(FILE_TOKEN, path))
    : [...args, path]
}

// node_modules/.bin is not on PATH, so the bare name fails with ENOENT.
export function resolveBin(bin: string, cwd: string): string {
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) return bin
  const local = join(cwd, 'node_modules', '.bin', bin)
  return existsSync(local) ? local : bin
}

export async function runFormatter(
  command: string[],
  path: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const [bin] = command
  const result = await run(resolveBin(bin!, cwd), formatArgs(command, path), {
    cwd,
    timeout: FORMAT_TIMEOUT,
    signal,
  })
  if (signal?.aborted) return null
  if (result.error) {
    return notInstalled(result) ? `${bin} is not installed, or not on PATH` : result.error.message
  }
  if (result.timedOut) return `${bin} timed out`
  if (result.status === 0) return null
  return firstLine(result.stderr || result.stdout) || `${bin} exited with code ${result.status}`
}
