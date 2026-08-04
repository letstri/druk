/**
 * One subprocess wrapper for everything druk shells out to asynchronously — git
 * mutations and comparison queries, the user's formatter, an npm install of a
 * language server.
 *
 * They all need the same four things, and each hand-rolled copy got one of them
 * subtly wrong at some point: a timeout that kills, output collected without
 * growing without bound, a spawn failure reported as itself rather than as
 * "exited with no output", and exactly one settle — `error` and `close` can both
 * fire, and whichever comes first has to be the answer.
 */
import { spawn } from 'node:child_process'

export interface ProcessResult {
  /** Exit status; null when the process was killed or never started at all. */
  status: number | null
  stdout: string
  stderr: string
  /** The timeout fired and the process was killed — the output is partial. */
  timedOut: boolean
  /** More than `maxOutput` bytes; killed, and the output is partial. */
  overflow: boolean
  /** The spawn itself failed. Nothing ran, so the streams say nothing. */
  error: NodeJS.ErrnoException | null
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Milliseconds before the process is killed. */
  timeout: number
  /** Bytes of combined output past which the process is killed. */
  maxOutput?: number
}

export function run(bin: string, args: string[], options: RunOptions): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let timedOut = false
    let overflow = false
    let settled = false
    // Declared before `finish`, which clears it: the timer's own callback is one
    // of the ways the process ends, so the two have to close over each other.
    let timer: ReturnType<typeof setTimeout>

    const finish = (status: number | null, error: NodeJS.ErrnoException | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        overflow,
        error,
      })
    }

    const collect = (target: Buffer[], chunk: Buffer) => {
      if (options.maxOutput !== undefined) {
        size += chunk.length
        if (size > options.maxOutput) {
          overflow = true
          child.kill('SIGKILL')
          return
        }
      }
      target.push(chunk)
    }

    timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeout)

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.on('error', error => finish(null, error))
    // Not `finish` itself: 'close' hands the listener (code, signal), and the
    // signal would land in `error` — a killed process would then report itself
    // as a spawn failure with no `.message`, swallowing the timeout it really is.
    child.on('close', code => finish(code))
  })
}

/** The program is not on PATH at all, as against having run and failed. */
export const notInstalled = (result: ProcessResult): boolean => result.error?.code === 'ENOENT'

/** The first non-empty line of `text`, which is the useful half of most tool output. */
export function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}
