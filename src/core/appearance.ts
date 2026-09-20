import { spawn, spawnSync } from 'node:child_process'

export type Appearance = 'dark' | 'light'

export const APPEARANCE_ENV = 'DRUK_OS_APPEARANCE'

interface Probe {
  command: string
  args: string[]
  read: (stdout: string, ok: boolean) => Appearance | null
}

const PROBES: Record<string, Probe[]> = {
  darwin: [
    {
      command: 'defaults',
      args: ['read', '-g', 'AppleInterfaceStyle'],
      // The key exists only while dark mode is on: a failed read means light.
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

// Synchronous: the poll must use detectAppearanceAsync, a probe subprocess costs 100ms.
export function detectAppearance(): Appearance | null {
  const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
  if (forced) return forced

  for (const probe of PROBES[process.platform] ?? []) {
    try {
      const run = spawnSync(probe.command, probe.args, { encoding: 'utf8', timeout: 2000 })
      const answer = probe.read(run.stdout ?? '', run.status === 0)
      if (answer) return answer
    } catch {
      // next probe
    }
  }
  return null
}

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

async function detectAppearanceAsync(): Promise<Appearance | null> {
  const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
  if (forced) return forced

  for (const probe of PROBES[process.platform] ?? []) {
    const answer = await runProbe(probe)
    if (answer) return answer
  }
  return null
}

const POLL_MS = 2000

// The timer is unrefed: a theme poll must never hold the process open.
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
    const forced = parseEnvAppearance(process.env[APPEARANCE_ENV])
    if (forced) return report(forced)
    if (inflight) return
    inflight = true
    void detectAppearanceAsync().then(now => {
      inflight = false
      report(now)
    })
  }

  // Synchronous: this read decides the first frame's theme, else it paints wrong and flips.
  report(detectAppearance())
  const timer = setInterval(poll, intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
