/**
 * Format on save: run the user's own formatter over the file just written.
 * druk ships no formatter — the `formatters` setting maps extensions to a
 * command (prettier, eslint --fix, oxfmt, gofmt -w, …) that rewrites the file
 * in place, and the workspace pulls the result back into the buffer.
 */
import { existsSync } from 'node:fs'
import { extname, isAbsolute, join, sep } from 'node:path'

import { firstLine, notInstalled, run } from './process'

/** A formatter that hangs would otherwise hold the buffer's re-read forever. */
const FORMAT_TIMEOUT = 10_000

/**
 * The command for `path`, or null when nothing matches. Keys are comma-separated
 * extensions (`"ts,tsx"`); `"*"` matches any file but only when no extension key
 * did, so a catch-all and a specific entry can coexist. A leading dot is allowed
 * here even though the settings page strips it — a hand-written config.json says
 * `.ts` as often as `ts`, and the entry silently never matching is a bad answer.
 */
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

/**
 * Stands in for the file's path inside a formatter command. Appending the path is
 * right for most tools, but not for the ones that want it before a flag or inside
 * an argument (`--stdin-filepath={}`), so the token is what makes those sayable.
 */
export const FILE_TOKEN = '{}'

/**
 * The arguments the formatter runs with: the token replaced wherever it appears,
 * or the path appended when the command never mentions it.
 */
export function formatArgs(command: string[], path: string): string[] {
  const args = command.slice(1)
  return args.some(arg => arg.includes(FILE_TOKEN))
    ? args.map(arg => arg.replaceAll(FILE_TOKEN, path))
    : [...args, path]
}

/**
 * The program to spawn for `bin`: the project's own copy when it has one, the
 * name untouched otherwise. A repository that installed prettier means *that*
 * prettier — and `node_modules/.bin` is not on PATH, so spawning the bare name
 * would fail with ENOENT even though the tool is there. Same rule the language
 * servers follow (`lsp/project.ts`). A command that already spells out a path
 * is the user naming a program, so it is left alone.
 */
export function resolveBin(bin: string, cwd: string): string {
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) return bin
  const local = join(cwd, 'node_modules', '.bin', bin)
  return existsSync(local) ? local : bin
}

/**
 * Run `command` over `path`, from `cwd` so the tool finds its own project config.
 * Resolves to an error line for the status bar, or null on success — the caller
 * re-reads the file to see what the formatter did.
 */
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
