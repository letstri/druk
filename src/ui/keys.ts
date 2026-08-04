/**
 * Every keybinding druk advertises, in one table. The status-bar hints, the
 * help overlay and the Ctrl+K peek strip all render from here — a key added
 * anywhere else is a key one of them will not know about. The real handlers
 * live in App and EditorPane; `test/hotkeys.test.tsx` sweeps the two together.
 *
 * Entries sit grouped by `section`, which is what the help overlay and the Ctrl+K
 * peek render under headings — a new entry belongs beside its section mates, not at
 * the end. Both split the table where `section` changes, so an entry filed away from
 * its mates opens the heading a second time.
 *
 * A row that names bindable commands carries their `ids`, so a custom shortcut
 * shows up here instead of leaving the table advertising the key it replaced:
 * `src/app/settings.ts` pushes the effective spellings in through
 * `setKeyOverrides`, and `src/app/keymap.ts` owns the ids and their defaults.
 */
import { createSignal } from 'solid-js'

type Pane = 'tree' | 'editor'

/** The panes plus the sidebar's other views: the source-control, review and
 * extensions panels replace the tree's keys while they show, so the peek strip
 * has to tell them apart. */
export type KeyScope = Pane | 'git' | 'review' | 'extensions'

/** What the key next to the space bar is called on this machine's keyboard. */
export const ALT = process.platform === 'darwin' ? 'Opt' : 'Alt'

export interface KeyInfo {
  key: string
  label: string
  /** Heading the help overlay files this under. */
  section: string
  /** Pane(s) the key is alive in; 'help' rows show in the help table only. */
  where: KeyScope | 'all' | 'help'
  /** Bindable commands this row's key column spells out, in the order shown. */
  ids?: string[]
  /** Footer advertisement: which pane shows it, as what, in what order.
   * `key` overrides the display key where the full spelling is too wide. */
  hint?: { pane: Pane | 'all'; label: string; rank: number; key?: string }
  /** Row on the empty-editor welcome screen. Same `key` override as `hint`. */
  welcome?: { label: string; rank: number; key?: string }
}

export const KEYS: KeyInfo[] = [
  {
    // Ctrl+Shift+P reaches only kitty-protocol terminals; the Opt spelling and
    // F1 are what work everywhere, so F1 is the one the hint advertises.
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
    welcome: { label: 'Open a file by name', rank: 1, key: 'Ctrl+P' },
  },
  { key: 'Ctrl+G', label: 'Go to line', section: 'General', where: 'all', ids: ['goto'] },
  // One row for the pair, not two: the table is as tall as the terminals people
  // have, and `test/help-scroll.test.tsx` measures how tall one has to be for
  // the whole of it — every row added costs a row there.
  {
    key: `F12 / Ctrl+${ALT}+O`,
    label: 'Definition / file under cursor',
    section: 'General',
    where: 'editor',
    ids: ['goto.definition', 'goto.file'],
  },
  { key: 'Ctrl+Q', label: 'Quit', section: 'General', where: 'all', ids: ['quit'] },

  { key: 'Ctrl+S', label: 'Save file', section: 'Editing', where: 'editor', ids: ['save'] },
  { key: 'Ctrl+Z / Ctrl+Y', label: 'Undo / redo', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+A', label: 'Select all', section: 'Editing', where: 'editor' },
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
  },
  {
    key: 'Ctrl+R',
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
  // Deliberately without `ids`: the command is bindable, but its key here is the
  // tree's own Space, which no global chord can replace.
  {
    key: 'Space · PgUp/Dn',
    label: 'Preview file, no tab · scroll it',
    section: 'File tree',
    where: 'tree',
  },
  { key: 'a / A', label: 'New file / folder (in tree)', section: 'File tree', where: 'tree' },
  { key: 'r / d', label: 'Rename / delete (in tree)', section: 'File tree', where: 'tree' },
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
  // Short labels on purpose: a label that wraps costs the help table a second row,
  // and the table only just fits a 60-row terminal — `test/help-scroll.test.tsx`
  // measures exactly that.
  {
    key: '↑↓ · Enter · →←',
    label: 'Diff a change · open it · fold',
    section: 'Source control',
    where: 'git',
  },
  {
    key: 'c p b B r Esc',
    label: 'Commit/push/branch/review/back',
    section: 'Source control',
    where: 'git',
  },

  // One row for the pair, and short labels, as the source-control rows are: the
  // help table only just fits a 70-row terminal, and a wrapped label costs it a
  // second row — `test/help-scroll.test.tsx` measures exactly that.
  {
    key: `Ctrl+${ALT}+R / A`,
    label: 'Review panel / note this line',
    section: 'Review',
    where: 'all',
    ids: ['view.review', 'review.note'],
  },
  // Short labels on purpose, as the source-control rows are: the help table only
  // just fits a 60-row terminal, and a wrapped label costs it a second row.
  {
    key: 'Enter · f · Esc',
    label: 'Jump · fetch · back',
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
  // Ctrl+U / Ctrl+D too: MacBook keyboards have no page keys at all.
  {
    key: 'PgUp/Dn · Ctrl+U/D',
    label: 'Scroll a page',
    section: 'View',
    where: 'editor',
  },
  // One row, not two: the help table only just fits a 60-row terminal, and
  // `test/help-scroll.test.tsx` measures exactly that.
  {
    key: 'Tab / Shift+Tab',
    label: 'Tree → editor · walk views',
    section: 'View',
    where: 'all',
  },
  { key: 'Esc', label: 'Editor → tree', section: 'View', where: 'editor' },

  // Last, so the sections above keep the rows they had: the help table only just
  // fits a 60-row terminal and its tests measure the window from the top.
  {
    key: `Ctrl+${ALT}+X`,
    label: 'Extensions panel',
    section: 'Extensions',
    where: 'all',
    ids: ['view.extensions'],
  },
  // Short labels on purpose, as the source-control rows are: the help table only
  // just fits a 60-row terminal, and a wrapped label costs it a second row.
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

/** One bindable command's effective key, as `src/app/keymap.ts` resolved it. */
export interface KeyOverride {
  /** Spelling in force; '' when the command has no key. */
  key: string
  label: string
  /** The user rebound it, so this spelling outranks the table's own. */
  changed: boolean
}

/**
 * A signal, not a plain object: the peek strip and the help table read this while
 * rendering, and an assignment they cannot see would leave them advertising keys
 * the editor no longer has.
 */
const [overrides, setOverrides] = createSignal<Record<string, KeyOverride>>({})

export { setOverrides as setKeyOverrides }

const UNBOUND = '—'

/**
 * The key column for one row. The table's own spelling stands until a command on
 * the row is rebound, so nothing moves for the people who changed nothing — and
 * `test/keymap.test.ts` holds the two spellings to each other.
 */
function displayKey(info: KeyInfo): string {
  const map = overrides()
  const ids = info.ids
  if (!ids?.some(id => map[id]?.changed)) return info.key
  const spellings = ids.map(id => map[id]?.key || UNBOUND)
  return joinKeys(spellings)
}

/**
 * Several commands' keys as one column. A shared modifier is written once —
 * "Ctrl+Opt+← / →" rather than twice its width, which the help table's key column
 * has no room for.
 */
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

/**
 * The table as it stands now: every row at its effective spelling, plus a row for
 * each command the user gave a key that the table does not otherwise advertise.
 */
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

/** The help table: every row, key and long label. */
export const helpRows = (): [string, string][] =>
  entries().map(info => [info.key, info.label] as [string, string])

export interface HelpSection {
  title: string
  rows: [string, string][]
}

/** Rows split where their `section` changes. `KEYS` keeps a section contiguous. */
const sectionsOf = (rows: KeyInfo[]): HelpSection[] =>
  rows.reduce<HelpSection[]>((out, info) => {
    if (out.at(-1)?.title !== info.section) out.push({ title: info.section, rows: [] })
    out.at(-1)!.rows.push([info.key, info.label])
    return out
  }, [])

/** The table split at its section boundaries, for the help overlay's headings. */
export const helpSections = (): HelpSection[] => sectionsOf(entries())

/**
 * The short spelling a hint or welcome row asked for — dropped once the command is
 * rebound, since the abbreviation was written for the key it used to have.
 */
const shortKey = (info: KeyInfo, short: string | undefined): string =>
  info.ids?.some(id => overrides()[id]?.changed) ? info.key : (short ?? info.key)

/** Footer hints for `pane`, most useful first. */
export function hintsFor(pane: Pane): ReadonlyArray<readonly [string, string]> {
  return entries()
    .filter(info => info.hint && (info.hint.pane === pane || info.hint.pane === 'all'))
    .toSorted((a, b) => a.hint!.rank - b.hint!.rank)
    .map(info => [shortKey(info, info.hint!.key), info.hint!.label] as const)
}

/** Rows for the welcome screen, most useful first. */
export function welcomeKeys(): ReadonlyArray<readonly [string, string]> {
  return entries()
    .filter(info => info.welcome)
    .toSorted((a, b) => a.welcome!.rank - b.welcome!.rank)
    .map(info => [shortKey(info, info.welcome!.key), info.welcome!.label] as const)
}

/** Everything alive in `pane`, for the peek strip. */
export function keysFor(pane: KeyScope): KeyInfo[] {
  return entries().filter(info => info.where === pane || info.where === 'all')
}

/** What `pane` answers to, under the help overlay's headings — the peek panel. */
export const keySectionsFor = (pane: KeyScope): HelpSection[] => sectionsOf(keysFor(pane))
