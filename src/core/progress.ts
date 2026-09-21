export type ProgressState =
  | { kind: 'off' }
  | { kind: 'indeterminate' }
  | { kind: 'percent'; value: number }

export const PROGRESS_ENV = 'DRUK_PROGRESS'

const BEL = '\u0007'

export function encodeProgress(state: ProgressState): string {
  if (state.kind === 'off') {
    return `\u001B]9;4;0${BEL}`
  }
  if (state.kind === 'indeterminate') {
    return `\u001B]9;4;3${BEL}`
  }
  const value = Math.max(0, Math.min(100, Math.round(state.value)))
  return `\u001B]9;4;1;${value}${BEL}`
}

export function progressFromBusy(
  busy: { done?: number; total?: number } | null
): ProgressState {
  if (!busy) {
    return { kind: 'off' }
  }
  if (busy.total !== null && busy.total !== undefined && busy.total > 0) {
    return { kind: 'percent', value: (100 * (busy.done ?? 0)) / busy.total }
  }
  return { kind: 'indeterminate' }
}

export function supportsProgress(
  env: NodeJS.ProcessEnv = process.env,
  tty = Boolean(process.stdout.isTTY)
): boolean {
  if (!tty) {
    return false
  }
  const forced = env[PROGRESS_ENV]
  if (forced === '0' || forced === 'off') {
    return false
  }
  if (forced === '1' || forced === 'on') {
    return true
  }
  if (env.WT_SESSION) {
    return true
  }
  if (env.ConEmuANSI === 'ON') {
    return true
  }
  if (env.KITTY_WINDOW_ID) {
    return true
  }
  const program = env.TERM_PROGRAM
  if (
    program === 'ghostty' ||
    program === 'WezTerm' ||
    program === 'iTerm.app'
  ) {
    return true
  }
  const term = env.TERM ?? ''
  if (term.includes('ghostty') || term.includes('kitty')) {
    return true
  }
  const vte = Number(env.VTE_VERSION ?? 0)
  return vte >= 7900
}

let last = ''
let exitHookInstalled = false

// Once, on first use: a listener per report would trip Node's ten-listener warning.
function installExitHook(): void {
  if (exitHookInstalled) {
    return
  }
  exitHookInstalled = true
  process.on('exit', () => reportProgress({ kind: 'off' }))
}

export function reportProgress(
  state: ProgressState,
  write: (text: string) => void = (text) => {
    process.stdout.write(text)
  },
  env: NodeJS.ProcessEnv = process.env,
  tty = Boolean(process.stdout.isTTY)
): void {
  if (!supportsProgress(env, tty)) {
    return
  }
  const sequence = encodeProgress(state)
  if (sequence === last) {
    return
  }
  last = sequence
  write(sequence)
  if (state.kind !== 'off') {
    installExitHook()
  }
}

export function resetProgress(): void {
  last = ''
}
