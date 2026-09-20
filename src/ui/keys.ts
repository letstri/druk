import { createSignal } from 'solid-js'

type Pane = 'tree' | 'editor'

export type KeyScope = Pane | 'git' | 'review' | 'extensions'

export const ALT = process.platform === 'darwin' ? 'Opt' : 'Alt'

export interface KeyInfo {
  key: string
  label: string
  section: string
  where: KeyScope | 'all' | 'help'
  ids?: string[]
  hint?: { pane: KeyScope | 'all'; label: string; rank: number; key?: string }
  welcome?: { label: string; rank: number; key?: string }
}

export const KEYS: KeyInfo[] = [
  {
    // Ctrl+Shift+P reaches only kitty-protocol terminals; F1 works everywhere.
    key: `F1 · Ctrl+${ALT}+P`,
    label: 'Command palette (+ themes)',
    section: 'General',
    where: 'all',
    ids: ['palette'],
    hint: { pane: 'all', label: 'commands', rank: 0, key: 'F1' },
    welcome: { label: 'Run any command', rank: 2, key: 'F1' },
  },
  {
    key: 'Ctrl+K',
    label: 'Peek at every key for this pane',
    section: 'General',
    where: 'all',
    ids: ['peek'],
    hint: { pane: 'all', label: 'keys', rank: 1 },
    welcome: { label: 'Peek at every key', rank: 5 },
  },
  {
    key: 'Ctrl+P · Ctrl+O',
    label: 'Open file (fuzzy)',
    section: 'General',
    where: 'all',
    ids: ['open'],
    hint: { pane: 'all', label: 'open', rank: 8, key: 'Ctrl+P' },
    welcome: { label: 'Open a file by name', rank: 1, key: 'Ctrl+P' },
  },
  { key: 'Ctrl+G', label: 'Go to line', section: 'General', where: 'all', ids: ['goto'] },
  // Short labels: the help table only just fits a 60-row terminal (test/help-scroll.test.tsx).
  {
    key: `F12 / Ctrl+${ALT}+O`,
    label: 'Definition / file under cursor',
    section: 'General',
    where: 'editor',
    ids: ['goto.definition', 'goto.file'],
  },
  {
    key: `F8 / Ctrl+${ALT}+I`,
    label: 'Next problem / read it',
    section: 'General',
    where: 'editor',
    ids: ['problems.next', 'problems.detail'],
  },
  {
    key: `Ctrl+${ALT}+W`,
    label: 'Switch workspace',
    section: 'General',
    where: 'help',
    ids: ['workspace.switch'],
  },
  { key: 'Ctrl+Q', label: 'Quit', section: 'General', where: 'all', ids: ['quit'] },

  { key: 'Ctrl+S', label: 'Save file', section: 'Editing', where: 'editor', ids: ['save'] },
  { key: 'Ctrl+Z / Ctrl+Y', label: 'Undo / redo', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+A', label: 'Select all', section: 'Editing', where: 'editor' },
  {
    key: `Ctrl+${ALT}+B`,
    label: 'Line start · Ctrl+U deletes',
    section: 'Editing',
    where: 'editor',
    ids: ['editor.lineStart'],
  },
  { key: 'Ctrl+C', label: 'Copy selection — quits if none', section: 'Editing', where: 'all' },
  { key: 'Ctrl+X / Ctrl+V', label: 'Cut / paste', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+/ · Ctrl+L', label: 'Toggle comment', section: 'Editing', where: 'editor' },
  { key: `${ALT}+↑ / ↓`, label: 'Move line or selection', section: 'Editing', where: 'editor' },
  {
    key: `${ALT}+Shift+↑ / ↓`,
    label: 'Duplicate line or selection',
    section: 'Editing',
    where: 'editor',
  },
  {
    key: `Ctrl+${ALT}+D`,
    label: 'Delete line or selection',
    section: 'Editing',
    where: 'editor',
    ids: ['editor.deleteLine'],
  },
  {
    key: `Ctrl+${ALT}+L`,
    label: 'Format document',
    section: 'Editing',
    where: 'editor',
    ids: ['editor.format'],
  },
  { key: 'Shift+Tab', label: 'Outdent', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+Space', label: 'Autocomplete (Tab accepts)', section: 'Editing', where: 'editor' },
  {
    key: `Ctrl+${ALT}+S / E`,
    label: 'Fold / unfold block at cursor',
    section: 'Editing',
    where: 'editor',
    ids: ['editor.fold', 'editor.unfold'],
  },

  {
    key: 'Ctrl+F',
    label: 'Find in file (Tab to replace)',
    section: 'Search & replace',
    where: 'editor',
    ids: ['find.file'],
    hint: { pane: 'editor', label: 'find', rank: 3 },
  },
  {
    key: `Ctrl+${ALT}+F`,
    label: 'Find in project',
    section: 'Search & replace',
    where: 'all',
    ids: ['find.project'],
    welcome: { label: 'Search the project', rank: 3 },
  },
  {
    key: 'Enter / Ctrl+A',
    label: 'Replace this match / all (in replace)',
    section: 'Search & replace',
    where: 'help',
  },
  {
    key: `Ctrl+C / W / R`,
    label: 'Case / whole word / regex (in search)',
    section: 'Search & replace',
    where: 'help',
  },

  { key: 'Ctrl+N', label: 'New file', section: 'Files & tabs', where: 'all', ids: ['file.new'] },
  {
    key: `Ctrl+${ALT}+N`,
    label: 'New folder',
    section: 'Files & tabs',
    where: 'all',
    ids: ['file.newDir'],
  },
  {
    key: `Ctrl+${ALT}+C`,
    label: 'Copy path of this file',
    section: 'Files & tabs',
    where: 'all',
    ids: ['file.copyPath'],
  },
  { key: 'Ctrl+W', label: 'Close tab', section: 'Files & tabs', where: 'all', ids: ['tabs.close'] },
  {
    key: `Ctrl+${ALT}+T`,
    label: 'Reopen closed tab',
    section: 'Files & tabs',
    where: 'all',
    ids: ['tabs.reopen'],
  },
  {
    key: 'Ctrl+T',
    label: 'Switch to open tab',
    section: 'Files & tabs',
    where: 'all',
    ids: ['tabs.switch'],
  },
  {
    key: `Ctrl+${ALT}+← / →`,
    label: 'Previous / next tab',
    section: 'Files & tabs',
    where: 'all',
    ids: ['tabs.prev', 'tabs.next'],
  },
  {
    key: `Ctrl+${ALT}+Z / Y`,
    label: 'Go back / forward (← → on the strip)',
    section: 'Files & tabs',
    where: 'all',
    ids: ['nav.back', 'nav.forward'],
  },

  {
    key: 'Enter',
    label: 'Open file / toggle folder',
    section: 'File tree',
    where: 'tree',
    welcome: { label: 'Open what the tree has selected', rank: 0 },
  },
  { key: '↑↓', label: 'Move in tree / popup', section: 'File tree', where: 'tree' },
  { key: 'Shift+↑ / ↓', label: 'Select a range (in tree)', section: 'File tree', where: 'tree' },
  { key: '→ / ←', label: 'Expand / collapse folder', section: 'File tree', where: 'tree' },
  {
    key: 'h j k l',
    label: 'Move / collapse / expand (vim mode)',
    section: 'File tree',
    where: 'tree',
  },
  {
    key: 'Space · PgUp/Dn',
    label: 'Preview file, no tab · scroll it',
    section: 'File tree',
    where: 'tree',
    hint: { pane: 'tree', label: 'preview', rank: 3, key: 'Space' },
  },
  {
    key: 'a / A',
    label: 'New file / folder (in tree)',
    section: 'File tree',
    where: 'tree',
    hint: { pane: 'tree', label: 'new', rank: 4, key: 'a' },
  },
  {
    key: 'r / d',
    label: 'Rename / delete (in tree)',
    section: 'File tree',
    where: 'tree',
    hint: { pane: 'tree', label: 'rename', rank: 5, key: 'r' },
  },
  {
    key: 'x / c / p',
    label: 'Cut / copy / paste here (in tree)',
    section: 'File tree',
    where: 'tree',
  },
  { key: '[ / ]', label: 'Narrow / widen sidebar (in tree)', section: 'File tree', where: 'tree' },

  {
    key: `Ctrl+${ALT}+G`,
    label: 'Source control panel (git)',
    section: 'Source control',
    where: 'all',
    ids: ['view.git'],
    welcome: { label: 'Review changes and commit', rank: 4 },
  },
  {
    key: '↑↓ · Enter · →←',
    label: 'Diff a change · open it · fold',
    section: 'Source control',
    where: 'git',
  },
  {
    key: 'Space a c d p s b B Esc',
    label: 'Stage/commit/discard/push/sync/branch/compare/back',
    section: 'Source control',
    where: 'git',
  },
  {
    key: `Ctrl+${ALT}+U / J`,
    label: 'Resolve conflict · next one',
    section: 'Source control',
    where: 'editor',
    ids: ['git.conflictResolve', 'git.conflictNext'],
  },

  {
    key: `Ctrl+${ALT}+R / A`,
    label: 'Review panel / note this line',
    section: 'Review',
    where: 'all',
    ids: ['view.review', 'review.note'],
  },
  {
    key: 'Enter · r · ⌫ · Esc',
    label: 'Jump · reply · drop · back',
    section: 'Review',
    where: 'review',
  },

  {
    key: 'Ctrl+B',
    label: 'Show / hide sidebar',
    section: 'View',
    where: 'all',
    ids: ['view.sidebar'],
  },
  {
    key: `Ctrl+${ALT}+M`,
    label: 'Markdown: rendered / source',
    section: 'View',
    where: 'editor',
    ids: ['view.markdown'],
  },
  {
    key: 'PgUp/Dn · Ctrl+D',
    label: 'Scroll a page',
    section: 'View',
    where: 'editor',
  },
  {
    key: 'Tab / Shift+Tab',
    label: 'Tree → editor · walk views',
    section: 'View',
    where: 'all',
  },
  { key: 'Esc', label: 'Editor → tree', section: 'View', where: 'editor' },

  // Last: the help tests measure the window from the top.
  {
    key: `Ctrl+${ALT}+X`,
    label: 'Extensions panel',
    section: 'Extensions',
    where: 'all',
    ids: ['view.extensions'],
  },
  {
    key: 'Enter · →←',
    label: 'On/off or install · fold',
    section: 'Extensions',
    where: 'extensions',
  },
  {
    key: '/ · Bksp · u',
    label: 'Find · uninstall · update',
    section: 'Extensions',
    where: 'extensions',
  },
]

interface KeyOverride {
  key: string
  label: string
  changed: boolean
}

// A signal, not a plain object: the peek and the help table read it while rendering.
const [overrides, setOverrides] = createSignal<Record<string, KeyOverride>>({})

export { setOverrides as setKeyOverrides }

export const chordFor = (id: string): string => overrides()[id]?.key ?? ''

export const keyTip = (id: string): string => {
  const override = overrides()[id]
  return override?.key ? `${override.key} — ${override.label}` : ''
}

// '' when the user unbound the command, null while the default stands.
export const rebound = (id: string): string | null => {
  const override = overrides()[id]
  return override?.changed ? override.key : null
}

const UNBOUND = '—'

function displayKey(info: KeyInfo): string {
  const map = overrides()
  const ids = info.ids
  if (!ids?.some(id => map[id]?.changed)) return info.key
  const spellings = ids.map(id => map[id]?.key || UNBOUND)
  return joinKeys(spellings)
}

function joinKeys(spellings: string[]): string {
  if (spellings.length === 1) return spellings[0]!
  const split = spellings.map(spelling => {
    const at = spelling.lastIndexOf('+')
    return at < 0
      ? { prefix: '', key: spelling }
      : { prefix: spelling.slice(0, at + 1), key: spelling.slice(at + 1) }
  })
  const prefix = split[0]!.prefix
  if (prefix && split.every(part => part.prefix === prefix)) {
    return `${prefix}${split.map(part => part.key).join(' / ')}`
  }
  return spellings.join(' / ')
}

function entries(): KeyInfo[] {
  const map = overrides()
  const advertised = new Set(KEYS.flatMap(info => info.ids ?? []))
  const extra = Object.entries(map)
    .filter(([id, override]) => override.changed && override.key && !advertised.has(id))
    .map(([, override]) => ({
      key: override.key,
      label: override.label,
      section: 'Custom keys',
      where: 'all' as const,
    }))
  return [...KEYS.map(info => ({ ...info, key: displayKey(info) })), ...extra]
}

export const helpRows = (): [string, string][] =>
  entries().map(info => [info.key, info.label] as [string, string])

export interface HelpSection {
  title: string
  rows: [string, string][]
}

// Split where `section` changes: KEYS must keep a section contiguous.
const sectionsOf = (rows: KeyInfo[]): HelpSection[] =>
  rows.reduce<HelpSection[]>((out, info) => {
    if (out.at(-1)?.title !== info.section) out.push({ title: info.section, rows: [] })
    out.at(-1)!.rows.push([info.key, info.label])
    return out
  }, [])

export const helpSections = (): HelpSection[] => sectionsOf(entries())

const shortKey = (info: KeyInfo, short: string | undefined): string =>
  info.ids?.some(id => overrides()[id]?.changed) ? info.key : (short ?? info.key)

export interface Hint {
  key: string
  label: string
  id?: string
  rank: number
}

const PANEL_HINTS: (Hint & { pane: KeyScope })[] = [
  { pane: 'git', key: 'Space', label: 'stage', rank: 2 },
  { pane: 'git', key: 'c', label: 'commit', rank: 3 },
  { pane: 'git', key: 'd', label: 'discard', rank: 5 },
  { pane: 'git', key: 's', label: 'sync', rank: 6 },
  { pane: 'git', key: 'B', label: 'compare', rank: 7 },
  { pane: 'git', key: 'g', label: 'graph', rank: 8 },
  { pane: 'review', key: 'r', label: 'reply', rank: 2 },
  { pane: 'review', key: 'Bksp', label: 'drop', rank: 3 },
  { pane: 'extensions', key: '/', label: 'find', rank: 2 },
  { pane: 'extensions', key: 'Enter', label: 'install', rank: 3 },
  { pane: 'extensions', key: 'u', label: 'update', rank: 4 },
]

export function hintsFor(pane: KeyScope, extra: Hint[] = []): Hint[] {
  const fromTable = entries()
    .filter(info => info.hint && (info.hint.pane === pane || info.hint.pane === 'all'))
    .map(info => ({
      key: shortKey(info, info.hint!.key),
      label: info.hint!.label,
      id: info.ids?.[0],
      rank: info.hint!.rank,
    }))
  return [...fromTable, ...PANEL_HINTS.filter(hint => hint.pane === pane), ...extra].toSorted(
    (a, b) => a.rank - b.rank,
  )
}

export function welcomeKeys(): ReadonlyArray<readonly [string, string]> {
  return entries()
    .filter(info => info.welcome)
    .toSorted((a, b) => a.welcome!.rank - b.welcome!.rank)
    .map(info => [shortKey(info, info.welcome!.key), info.welcome!.label] as const)
}

function keysFor(pane: KeyScope): KeyInfo[] {
  return entries().filter(info => info.where === pane || info.where === 'all')
}

export const keySectionsFor = (pane: KeyScope): HelpSection[] => sectionsOf(keysFor(pane))
