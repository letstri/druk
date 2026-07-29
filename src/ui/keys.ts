/**
 * Every keybinding druk advertises, in one table. The status-bar hints, the
 * help overlay and the Ctrl+K peek strip all render from here — a key added
 * anywhere else is a key one of them will not know about. The real handlers
 * live in App and EditorPane; `test/hotkeys.test.tsx` sweeps the two together.
 *
 * The table is a function of the `keybindings` preset: with VS Code keys,
 * Ctrl+P opens a file and the palette answers to F1 / Ctrl+Shift+P, so the
 * first rows have to say so or every surface built from here would lie.
 *
 * Entries sit grouped by `section`, which is what the help overlay renders
 * under headings — a new entry belongs beside its section mates, not at the end.
 */

type Pane = 'tree' | 'editor'

/** What the key next to the space bar is called on this machine's keyboard. */
export const ALT = process.platform === 'darwin' ? 'Opt' : 'Alt'

export interface KeyInfo {
  key: string
  label: string
  /** Heading the help overlay files this under. */
  section: string
  /** Pane(s) the key is alive in; 'help' rows show in the help table only. */
  where: Pane | 'all' | 'help'
  /** Footer advertisement: which pane shows it, as what, in what order.
   * `key` overrides the display key where the full spelling is too wide. */
  hint?: { pane: Pane | 'all'; label: string; rank: number; key?: string }
}

export function keyTable(vscodeKeys: boolean): KeyInfo[] {
  return [
    vscodeKeys
      ? {
          key: 'F1 / Ctrl+Shift+P',
          label: 'Command palette (+ themes)',
          section: 'General',
          where: 'all',
          hint: { pane: 'all', label: 'commands', rank: 0, key: 'F1' },
        }
      : {
          key: 'Ctrl+P / F1',
          label: 'Command palette (+ themes)',
          section: 'General',
          where: 'all',
          hint: { pane: 'all', label: 'commands', rank: 0, key: 'Ctrl+P' },
        },
    {
      key: 'Ctrl+K',
      label: 'Peek at every key for this pane',
      section: 'General',
      where: 'all',
      hint: { pane: 'all', label: 'keys', rank: 1 },
    },
    {
      key: vscodeKeys ? 'Ctrl+P / Ctrl+O' : 'Ctrl+O',
      label: 'Open file (fuzzy)',
      section: 'General',
      where: 'all',
    },
    { key: 'Ctrl+G', label: 'Go to line', section: 'General', where: 'all' },
    { key: 'Ctrl+Q', label: 'Quit', section: 'General', where: 'all' },
    { key: 'Mouse', label: 'Click tabs, tree rows, editor', section: 'General', where: 'help' },

    { key: 'Ctrl+S', label: 'Save file', section: 'Editing', where: 'editor' },
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

    {
      key: 'Ctrl+F',
      label: 'Find in file (Tab to replace)',
      section: 'Search & replace',
      where: 'editor',
    },
    { key: 'Ctrl+R', label: 'Find in project', section: 'Search & replace', where: 'all' },
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

    { key: 'Ctrl+N', label: 'New file', section: 'Files & tabs', where: 'all' },
    { key: `Ctrl+${ALT}+N`, label: 'New folder', section: 'Files & tabs', where: 'all' },
    { key: 'Ctrl+W', label: 'Close tab', section: 'Files & tabs', where: 'all' },
    { key: `Ctrl+${ALT}+T`, label: 'Reopen closed tab', section: 'Files & tabs', where: 'all' },
    { key: 'Ctrl+T', label: 'Switch to open tab', section: 'Files & tabs', where: 'all' },
    {
      key: `Ctrl+${ALT}+← / →`,
      label: 'Previous / next tab',
      section: 'Files & tabs',
      where: 'all',
    },

    { key: 'Enter', label: 'Open file / toggle folder', section: 'File tree', where: 'tree' },
    { key: '↑↓', label: 'Move in tree / popup', section: 'File tree', where: 'tree' },
    { key: 'Shift+↑ / ↓', label: 'Select a range (in tree)', section: 'File tree', where: 'tree' },
    { key: '→ / ←', label: 'Expand / collapse folder', section: 'File tree', where: 'tree' },
    {
      key: 'h j k l',
      label: 'Move / collapse / expand (vim mode)',
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
    {
      key: '[ / ]',
      label: 'Narrow / widen sidebar (in tree)',
      section: 'File tree',
      where: 'tree',
    },

    {
      key: 'Ctrl+B',
      label: 'Show / hide sidebar',
      section: 'View',
      where: 'all',
    },
    {
      key: 'Tab',
      label: 'Tree → editor · indent in editor',
      section: 'View',
      where: 'all',
    },
    { key: 'Esc', label: 'Editor → tree', section: 'View', where: 'editor' },
  ]
}

/** The help table: every row, key and long label. */
export function rowsFor(vscodeKeys: boolean): [string, string][] {
  return keyTable(vscodeKeys).map(info => [info.key, info.label])
}

export interface HelpSection {
  title: string
  rows: [string, string][]
}

/** The table split at its section boundaries, for the help overlay's headings. */
export function sectionsFor(vscodeKeys: boolean): HelpSection[] {
  return keyTable(vscodeKeys).reduce<HelpSection[]>((out, info) => {
    if (out.at(-1)?.title !== info.section) out.push({ title: info.section, rows: [] })
    out.at(-1)!.rows.push([info.key, info.label])
    return out
  }, [])
}

/** Footer hints for `pane`, most useful first. */
export function hintsFor(
  pane: Pane,
  vscodeKeys: boolean,
): ReadonlyArray<readonly [string, string]> {
  return keyTable(vscodeKeys)
    .filter(info => info.hint && (info.hint.pane === pane || info.hint.pane === 'all'))
    .toSorted((a, b) => a.hint!.rank - b.hint!.rank)
    .map(info => [info.hint!.key ?? info.key, info.hint!.label] as const)
}

/** Everything alive in `pane`, for the peek strip. */
export function keysFor(pane: Pane, vscodeKeys: boolean): KeyInfo[] {
  return keyTable(vscodeKeys).filter(info => info.where === pane || info.where === 'all')
}
