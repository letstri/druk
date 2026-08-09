/**
 * Per-project workspace state — which files were open and which folders were
 * expanded — so reopening a project looks the way you left it.
 *
 * Stored next to the config as `sessions.json`, keyed by absolute project path.
 * Everything here is best-effort: a missing, unreadable or stale entry just
 * means druk starts empty.
 */
import fs from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_FILE } from './config'
import { exists } from './fs'

const SESSIONS_FILE = join(dirname(CONFIG_FILE), 'sessions.json')

/** Projects remembered before the oldest entries are dropped. */
const MAX_PROJECTS = 20

export interface Session {
  tabs: string[]
  activePath: string | null
  expanded: string[]
  sidebar: boolean
}

const EMPTY_SESSION: Session = {
  tabs: [],
  activePath: null,
  expanded: [],
  sidebar: true,
}

type SessionFile = Record<string, Session & { touchedAt: number }>

function readAll(): SessionFile {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
    return typeof raw === 'object' && raw !== null ? (raw as SessionFile) : {}
  } catch {
    return {}
  }
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : []

export function loadSession(rootDir: string): Session {
  const entry = readAll()[rootDir]
  if (!entry) return { ...EMPTY_SESSION }

  const tabs = strings(entry.tabs).filter(path => exists(path))
  const activePath = typeof entry.activePath === 'string' ? entry.activePath : null
  return {
    tabs,
    activePath: activePath && tabs.includes(activePath) ? activePath : (tabs[0] ?? null),
    expanded: strings(entry.expanded).filter(path => exists(path)),
    sidebar: entry.sidebar !== false,
  }
}

export function saveSession(rootDir: string, session: Session, now = Date.now()): void {
  try {
    const all = readAll()
    all[rootDir] = { ...session, touchedAt: now }

    const trimmed = Object.entries(all)
      .toSorted((a, b) => (b[1].touchedAt ?? 0) - (a[1].touchedAt ?? 0))
      .slice(0, MAX_PROJECTS)

    fs.mkdirSync(dirname(SESSIONS_FILE), { recursive: true })
    fs.writeFileSync(SESSIONS_FILE, `${JSON.stringify(Object.fromEntries(trimmed), null, 2)}\n`)
  } catch {
    // best-effort — losing the session is never worth interrupting the editor
  }
}
