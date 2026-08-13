/**
 * The OS light/dark appearance, for `themeSync`.
 *
 * There is no portable way to subscribe to the change — macOS needs a native
 * notification observer and the Linux desktops disagree — so this polls a cheap
 * per-platform command instead.
 */
import { spawn, spawnSync } from 'node:child_process'

export type Appearance = 'dark' | 'light'

/** Forces an answer, for tests and for desktops none of the probes can read. */
export const APPEARANCE_ENV = 'DRUK_OS_APPEARANCE'

interface Probe {
  command: string
  args: string[]
  /** `null` when this probe cannot tell — the next probe gets a turn. */
  read: (stdout: string, ok: boolean) => Appearance | null
}

const PROBES: Record<string, Probe[]> = {
  darwin: [
    {
      command: 'defaults',
      args: ['read', '-g', 'AppleInterfaceStyle'],
      // The key only exists while dark mode is on, so a failed read means light.
      read: (stdout, ok) => (ok && stdout.trim() === 'Dark' ? 'dark' : 'light'),
    },
  ],
  linux: [
    {
      command: 'gsettings',
      args: ['get', 'org.gnome.desktop.interface', 'color-scheme'],
      read: (stdout, ok) => {
        if (!ok) return null
        const value = stdout.trim()
        if (value.includes('prefer-dark')) return 'dark'
        if (value.includes('prefer-light')) return 'light'
        // 'default' says nothing about the colors — fall through to the GTK theme.
        return null
      },
    },
    {
      command: 'gsettings',
      args: ['get', 'org.gnome.desktop.interface', 'gtk-theme'],
      read: (stdout, ok) =>
        ok ? (stdout.toLowerCase().includes('dark') ? 'dark' : 'light') : null,
    },
  ],
  win32: [
    {
      command: 'reg',
      args: [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'AppsUseLightTheme',
      ],
      read: (stdout, ok) => {
        if (!ok) return null
        const value = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout)?.[1]
        if (value === undefined) return null
        return Number.parseInt(value, 16) === 0 ? 'dark' : 'light'
      },
    },
  ],
}

function parseEnvAppearance(value: string | undefined): Appearance | null {
  const wanted = value?.trim().toLowerCase()
  return wanted === 'dark' || wanted === 'light' ? wanted : null
}

/**
 * The current OS appearance, or `null` when nothing here can answer.
 *
 * Synchronous, so only for one-shot calls on an explicit user action (the
 * settings toggle). The poll must use `detectAppearanceAsync`: a probe is a
 * subprocess that can take over 100ms on a loaded machine, and run with
 * `spawnSync` on the timer it froze the whole UI — input included — every
 * `POLL_MS`.
 */
export function detectAppearance(): Appearance | null {
  const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
  if (forced) return forced

  for (const probe of PROBES[process.platform] ?? []) {
    try {
      const run = spawnSync(probe.command, probe.args, { encoding: 'utf8', timeout: 2000 })
      const answer = probe.read(run.stdout ?? '', run.status === 0)
      if (answer) return answer
    } catch {
      // probe unavailable — try the next one
    }
  }
  return null
}

/** One probe, off the event loop. */
function runProbe(probe: Probe): Promise<Appearance | null> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(probe.command, probe.args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      })
    } catch {
      return resolve(null)
    }
    let stdout = ''
    child.stdout?.on('data', chunk => {
      stdout += chunk
    })
    child.on('error', () => resolve(null))
    child.on('close', status => resolve(probe.read(stdout, status === 0)))
  })
}

/** `detectAppearance` without blocking the event loop — what the poll uses. */
export async function detectAppearanceAsync(): Promise<Appearance | null> {
  const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
  if (forced) return forced

  for (const probe of PROBES[process.platform] ?? []) {
    const answer = await runProbe(probe)
    if (answer) return answer
  }
  return null
}

const POLL_MS = 2000

/**
 * Call `onChange` with the appearance now and on every change. Returns the stop
 * function. The timer is unrefed: a theme poll must never hold the process open.
 */
export function watchAppearance(
  onChange: (appearance: Appearance) => void,
  intervalMs = POLL_MS,
): () => void {
  let last: Appearance | null = null
  let stopped = false
  let inflight = false

  const report = (now: Appearance | null) => {
    if (stopped || !now || now === last) return
    last = now
    onChange(now)
  }

  const poll = () => {
    // The env override answers synchronously either way — the tests flip it and
    // watch the very next poll.
    const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
    if (forced) return report(forced)
    if (inflight) return
    inflight = true
    void detectAppearanceAsync().then(now => {
      inflight = false
      report(now)
    })
  }

  // The first read is synchronous on purpose: it decides the first frame's
  // theme, and read async the app paints in the wrong slot and flips a moment
  // later. Only the *recurring* poll must not block — it is the one that ran a
  // subprocess on the event loop every interval and froze input for its
  // duration each time.
  report(detectAppearance())
  const timer = setInterval(poll, intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
