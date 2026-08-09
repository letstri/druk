/**
 * The OS light/dark appearance, for `themeSync`.
 *
 * There is no portable way to subscribe to the change — macOS needs a native
 * notification observer and the Linux desktops disagree — so this polls a cheap
 * per-platform command instead.
 */
import { spawnSync } from 'node:child_process'

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

/** The current OS appearance, or `null` when nothing here can answer. */
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

  const poll = () => {
    const now = detectAppearance()
    if (!now || now === last) return
    last = now
    onChange(now)
  }

  poll()
  const timer = setInterval(poll, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
