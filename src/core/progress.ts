/**
 * The terminal's own progress indicator — OSC 9;4, the tab/title-bar loader
 * Ghostty, WezTerm, iTerm2, kitty, Windows Terminal and recent VTE draw.
 *
 * Always emitting it would be the obvious thing, but old VTE treats OSC 9 as a
 * notification and prints the rest, so a commit would spray `4;3` into the
 * buffer. Only terminals that actually implement the sequence get one.
 */
export type ProgressState =
  | { kind: 'off' }
  | { kind: 'indeterminate' }
  | { kind: 'percent'; value: number }

/** Force the indicator on or off, for tests and for a terminal we cannot detect. */
export const PROGRESS_ENV = 'DRUK_PROGRESS'

const BEL = '\x07'

export function encodeProgress(state: ProgressState): string {
  if (state.kind === 'off') return `\x1B]9;4;0${BEL}`
  if (state.kind === 'indeterminate') return `\x1B]9;4;3${BEL}`
  const value = Math.max(0, Math.min(100, Math.round(state.value)))
  return `\x1B]9;4;1;${value}${BEL}`
}

export function progressFromBusy(busy: { done?: number; total?: number } | null): ProgressState {
  if (!busy) return { kind: 'off' }
  if (busy.total != null && busy.total > 0) {
    return { kind: 'percent', value: (100 * (busy.done ?? 0)) / busy.total }
  }
  return { kind: 'indeterminate' }
}

export function supportsProgress(
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (!tty) return false
  const forced = env[PROGRESS_ENV]
  if (forced === '0' || forced === 'off') return false
  if (forced === '1' || forced === 'on') return true
  if (env.WT_SESSION) return true
  if (env.ConEmuANSI === 'ON') return true
  if (env.KITTY_WINDOW_ID) return true
  const program = env.TERM_PROGRAM
  if (program === 'ghostty' || program === 'WezTerm' || program === 'iTerm.app') return true
  const term = env.TERM ?? ''
  if (term.includes('ghostty') || term.includes('kitty')) return true
  const vte = Number(env.VTE_VERSION ?? 0)
  return vte >= 7900
}

let last = ''
let exitHookInstalled = false

/**
 * The indicator is the terminal's state rather than ours, so it outlives us: a
 * throw or a `process.exit` while an operation is counting leaves the tab lit
 * until something else resets it. `App`'s `onCleanup` covers the ordinary quit
 * alone. Installed on first use and once, as `src/lsp/client.ts` installs its
 * own — a run that never lit the indicator adds no listener, and a listener per
 * report would trip Node's ten-listener warning over the TUI's frame. A signal
 * that kills us outright still gets no say: `exit` is not emitted then, and a
 * handler for it would be restoring the alt screen too, which is its own job.
 */
function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => reportProgress({ kind: 'off' }))
}

/** Write the sequence for `state`, skipping a no-op repeat and unsupported terminals. */
export function reportProgress(
  state: ProgressState,
  write: (text: string) => void = text => {
    process.stdout.write(text)
  },
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean = Boolean(process.stdout.isTTY),
): void {
  if (!supportsProgress(env, tty)) return
  const sequence = encodeProgress(state)
  if (sequence === last) return
  last = sequence
  write(sequence)
  if (state.kind !== 'off') installExitHook()
}

/** So a test can assert one run without the next inheriting its last sequence. */
export function resetProgress(): void {
  last = ''
}
