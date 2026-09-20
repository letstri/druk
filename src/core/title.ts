import { basename } from 'node:path'

const TITLE_ENV = 'DRUK_TITLE'

const BEL = '\x07'

// These TERMs print the rest of an OSC string as text: a title would land in the buffer.
const NO_OSC_TERM = /^(dumb|linux|vt\d)/

export function supportsTitle(
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (!tty) return false
  const forced = env[TITLE_ENV]
  if (forced === '0' || forced === 'off') return false
  if (forced === '1' || forced === 'on') return true
  return !NO_OSC_TERM.test(env.TERM ?? '')
}

export function encodeTitle(title: string): string {
  // A control character ends the sequence early, and a filename may carry one.
  return `\x1B]0;${title.replaceAll(/\p{Cc}/gu, '')}${BEL}`
}

export function formatTitle(project: string, path: string | null, dirty: boolean): string {
  if (!path) return `${project} — druk`
  return `${dirty ? '● ' : ''}${basename(path)} — ${project} — druk`
}

const writeOut = (text: string): void => {
  process.stdout.write(text)
}

let last = ''
let pushed = false
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => restoreTerminalTitle())
}

export function setTerminalTitle(
  title: string,
  write: (text: string) => void = writeOut,
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean = Boolean(process.stdout.isTTY),
): void {
  if (!supportsTitle(env, tty)) return
  const sequence = encodeTitle(title)
  if (sequence === last) return
  last = sequence
  if (!pushed) {
    pushed = true
    write('\x1B[22;2t')
    installExitHook()
  }
  write(sequence)
}

export function restoreTerminalTitle(write: (text: string) => void = writeOut): void {
  if (!pushed) return
  pushed = false
  last = ''
  write('\x1B[23;2t')
}
