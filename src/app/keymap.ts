/**
 * The global keymap: which commands a key can run, what key each one has by
 * default, and what the `keybindings` setting does to that.
 *
 * `BINDABLE` is the whole list — a command not in it cannot be bound, and one in
 * it without a handler in `keyboard.ts` would be a dead key (`test/keymap.test.ts`
 * checks both directions). Ids match the palette's, so a rebound command shows the
 * same name in both places.
 *
 * Resolution is deliberate about clashes, since two commands cannot share a chord:
 * a custom binding beats a built-in default (that is what rebinding is for), and
 * between two custom bindings the one listed first here keeps the key while the
 * other is left unbound. Every loss is reported rather than applied quietly.
 */
import type { KeyEvent } from '@opentui/core'

import { bindingProblem, chordId, formatChord, matchesChord, parseChord } from '../core/keybindings'
import type { Chord } from '../core/keybindings'
import { ALT } from '../ui/keys'

export interface Bindable {
  /** Command id — the palette's, where the command has an entry there. */
  id: string
  label: string
  /** Chords in force out of the box, in the spelling the help table advertises. */
  defaults: string[]
  /**
   * Chords that also work but are not advertised: the spellings a terminal needs
   * that no one would look for in a menu. A custom binding replaces these too.
   */
  also?: string[]
}

/**
 * Everything the global keymap can run. The order is the precedence two custom
 * bindings on one chord are settled by, so the keys most people press stay first.
 */
export const BINDABLE: Bindable[] = [
  { id: 'palette', label: 'Command palette', defaults: ['F1', `Ctrl+${ALT}+P`] },
  { id: 'peek', label: 'Peek at every key', defaults: ['Ctrl+K'] },
  { id: 'open', label: 'Open file…', defaults: ['Ctrl+P', 'Ctrl+O'] },
  { id: 'save', label: 'Save file', defaults: ['Ctrl+S'] },
  { id: 'file.saveAll', label: 'Save all', defaults: [] },
  { id: 'goto', label: 'Go to line…', defaults: ['Ctrl+G'] },
  { id: 'goto.definition', label: 'Go to definition', defaults: ['F12'] },
  { id: 'goto.file', label: 'Open file under cursor', defaults: [`Ctrl+${ALT}+O`] },
  { id: 'find.file', label: 'Find in current file', defaults: ['Ctrl+F'] },
  { id: 'find.project', label: 'Find in project', defaults: ['Ctrl+R'], also: [`Ctrl+${ALT}+F`] },
  { id: 'find.replace', label: 'Replace in current file', defaults: [] },
  { id: 'find.replaceProject', label: 'Replace in project', defaults: [] },
  { id: 'file.new', label: 'New file', defaults: ['Ctrl+N'] },
  { id: 'file.newDir', label: 'New folder', defaults: [`Ctrl+${ALT}+N`] },
  { id: 'file.copyPath', label: 'Copy path', defaults: [`Ctrl+${ALT}+C`] },
  { id: 'file.copyRelativePath', label: 'Copy relative path', defaults: [] },
  { id: 'tabs.close', label: 'Close tab', defaults: ['Ctrl+W'] },
  { id: 'tabs.reopen', label: 'Reopen closed tab', defaults: [`Ctrl+${ALT}+T`] },
  { id: 'tabs.switch', label: 'Switch to open tab', defaults: ['Ctrl+T'], also: ['Ctrl+↑'] },
  // macOS binds plain Ctrl+arrows to Mission Control, so the advertised spelling is
  // the one that reaches us — and it arrives as a bare ctrl+arrow on Terminal.app,
  // hence both forms. MacBooks have no page keys, which is why they are not the
  // advertised spelling either.
  {
    id: 'tabs.prev',
    label: 'Previous tab',
    defaults: [`Ctrl+${ALT}+←`],
    also: ['Ctrl+←', 'Ctrl+PgUp'],
  },
  {
    id: 'tabs.next',
    label: 'Next tab',
    defaults: [`Ctrl+${ALT}+→`],
    also: ['Ctrl+→', 'Ctrl+PgDn'],
  },
  // Undo and redo for where you have been, which is what the pair is next to on
  // the keyboard — Ctrl+Opt+←/→ already walks the strip, and the arrows every
  // other editor uses for this are Alt+←/→, which the textarea needs for words.
  { id: 'nav.back', label: 'Go back', defaults: [`Ctrl+${ALT}+Z`] },
  { id: 'nav.forward', label: 'Go forward', defaults: [`Ctrl+${ALT}+Y`] },
  { id: 'tabs.closeOthers', label: 'Close other tabs', defaults: [] },
  { id: 'tabs.closeAll', label: 'Close all tabs', defaults: [] },
  // Shrink and expand, since the bracket pair every GUI editor uses for this is
  // Ctrl+Shift+[ / ] — a shifted Ctrl chord no terminal can deliver, and Ctrl+[
  // is the Escape byte anyway. C, the other obvious letter, is Copy path.
  { id: 'editor.fold', label: 'Fold block at cursor', defaults: [`Ctrl+${ALT}+S`] },
  { id: 'editor.unfold', label: 'Unfold block at cursor', defaults: [`Ctrl+${ALT}+E`] },
  { id: 'editor.foldAll', label: 'Fold everything', defaults: [] },
  { id: 'editor.unfoldAll', label: 'Unfold everything', defaults: [] },
  { id: 'view.sidebar', label: 'Show / hide sidebar', defaults: ['Ctrl+B'] },
  { id: 'view.git', label: 'Source control panel', defaults: [`Ctrl+${ALT}+G`] },
  { id: 'view.review', label: 'Review panel', defaults: [`Ctrl+${ALT}+R`] },
  { id: 'view.extensions', label: 'Extensions panel', defaults: [`Ctrl+${ALT}+X`] },
  { id: 'view.collapse', label: 'Collapse folders in sidebar', defaults: [] },
  {
    id: 'view.markdown',
    label: 'Markdown: rendered / source',
    defaults: [`Ctrl+${ALT}+M`],
  },
  { id: 'view.wrap', label: 'Toggle word wrap', defaults: [] },
  // No default chord: the key for this is Space in the tree, which the global
  // keymap cannot hold — a bare key here would be typing the editor never sees.
  { id: 'view.preview', label: 'Preview file (no tab)', defaults: [] },
  { id: 'view.focus', label: 'Focus tree / editor', defaults: [] },
  { id: 'git.diffFile', label: 'Diff current file', defaults: [] },
  { id: 'git.commit', label: 'Commit…', defaults: [] },
  { id: 'git.push', label: 'Push', defaults: [] },
  { id: 'git.compare', label: 'Compare branches', defaults: [] },
  // A for annotate: R is the panel, and the note is the thing pressed far more often.
  { id: 'review.note', label: 'Note this line for a review', defaults: [`Ctrl+${ALT}+A`] },
  { id: 'review.fetch', label: 'Fetch pull request comments', defaults: [] },
  { id: 'problems.list', label: 'List problems', defaults: [] },
  { id: 'problems.next', label: 'Next problem', defaults: [] },
  { id: 'problems.prev', label: 'Previous problem', defaults: [] },
  { id: 'problems.restart', label: 'Restart language servers', defaults: [] },
  { id: 'settings', label: 'Settings', defaults: [] },
  { id: 'help', label: 'Keyboard shortcuts', defaults: [] },
  { id: 'quit', label: 'Quit', defaults: ['Ctrl+Q'] },
]

/** Values that mean "this command has no key at all". */
const UNBOUND_WORDS = new Set(['none', 'off', 'unbound', '-'])

export const isUnbound = (value: string): boolean => UNBOUND_WORDS.has(value.trim().toLowerCase())

/** One chord two commands wanted, and which of them ended up with it. */
export interface Conflict {
  key: string
  /** Label of the command that keeps the chord. */
  winner: string
  /** Label of the command that lost it. */
  loser: string
  /** The loser's own custom binding was thrown out, rather than a default losing. */
  rejected: boolean
}

/** A `keybindings` value that is not a chord, or not one a shortcut may have. */
export interface InvalidBinding {
  id: string
  label: string
  value: string
  reason: string
}

export interface Keymap {
  /** Chords in force, per command id. Empty for a command with no key. */
  chords: Map<string, Chord[]>
  /** What the command's keys spell out for a menu; '' when it has none. */
  display: Map<string, string>
  /** Ids the user has bound by hand — the ones a page marks as customised. */
  custom: Set<string>
  conflicts: Conflict[]
  /** Refused values; the command keeps its default, so this is a warning, not state. */
  invalid: InvalidBinding[]
}

const chordsOf = (spellings: string[]): Chord[] =>
  spellings.map(parseChord).filter((chord): chord is Chord => chord !== null)

/** The spelling a command advertises out of the box. */
export const defaultDisplay = (spec: Bindable): string =>
  chordsOf(spec.defaults)
    .map(chord => formatChord(chord, ALT))
    .join(' · ')

/**
 * The keymap `custom` produces — command id → the chord spelling it takes over,
 * as the `keybindings` setting holds it. An unparseable value is reported and the
 * default kept: a hand-edited config must not cost the editor a key.
 */
export function resolveKeymap(custom: Record<string, string>): Keymap {
  const chords = new Map<string, Chord[]>()
  const display = new Map<string, string>()
  const customIds = new Set<string>()
  const conflicts: Conflict[] = []
  const invalid: InvalidBinding[] = []

  for (const spec of BINDABLE) {
    const raw = custom[spec.id]
    if (raw === undefined) continue
    if (raw.trim() === '' || isUnbound(raw)) {
      chords.set(spec.id, [])
      customIds.add(spec.id)
      continue
    }
    const chord = parseChord(raw)
    const reason = chord ? bindingProblem(chord) : `not a key chord — try Ctrl+${ALT}+K or F5`
    if (!chord || reason) {
      invalid.push({ id: spec.id, label: spec.label, value: raw.trim(), reason: reason! })
      continue
    }
    chords.set(spec.id, [chord])
    customIds.add(spec.id)
  }

  for (const spec of BINDABLE) {
    if (!chords.has(spec.id))
      chords.set(spec.id, chordsOf([...spec.defaults, ...(spec.also ?? [])]))
  }

  // Custom bindings claim their chords first, so a rebind takes the key from
  // whatever default held it; between two of them, BINDABLE order decides.
  const owner = new Map<string, Bindable>()
  for (const pass of [true, false]) {
    for (const spec of BINDABLE) {
      if (customIds.has(spec.id) !== pass) continue
      const kept: Chord[] = []
      for (const chord of chords.get(spec.id) ?? []) {
        const held = owner.get(chordId(chord))
        if (!held) {
          owner.set(chordId(chord), spec)
          kept.push(chord)
          continue
        }
        conflicts.push({
          key: formatChord(chord, ALT),
          winner: held.label,
          loser: spec.label,
          rejected: pass,
        })
      }
      chords.set(spec.id, kept)
    }
  }

  for (const spec of BINDABLE) {
    // Advertised chords only: the extra spellings exist so a terminal that sends
    // something else still works, and listing them in a menu would only confuse.
    const advertised = new Set(chordsOf(spec.defaults).map(chordId))
    const shown = (chords.get(spec.id) ?? []).filter(
      chord => customIds.has(spec.id) || advertised.has(chordId(chord)),
    )
    display.set(spec.id, shown.map(chord => formatChord(chord, ALT)).join(' · '))
  }

  return { chords, display, custom: customIds, conflicts, invalid }
}

/** The command `key` runs, or null when nothing is bound to it. */
export function matchKeymap(keymap: Keymap, key: KeyEvent): string | null {
  for (const [id, chords] of keymap.chords) {
    if (chords.some(chord => matchesChord(chord, key))) return id
  }
  return null
}

/**
 * The command already holding `chord` by the user's own choice, if any — what makes
 * a rebind onto it a clash worth refusing rather than a default worth taking.
 */
export function customHolder(keymap: Keymap, chord: Chord, except: string): Bindable | null {
  for (const spec of BINDABLE) {
    if (spec.id === except || !keymap.custom.has(spec.id)) continue
    if ((keymap.chords.get(spec.id) ?? []).some(held => chordId(held) === chordId(chord))) {
      return spec
    }
  }
  return null
}

/** What the help table, the peek strip and the footer hints should say now. */
export function keyOverrides(
  keymap: Keymap,
): Record<string, { key: string; label: string; changed: boolean }> {
  const overrides: Record<string, { key: string; label: string; changed: boolean }> = {}
  for (const spec of BINDABLE) {
    const key = keymap.display.get(spec.id) ?? ''
    overrides[spec.id] = { key, label: spec.label, changed: key !== defaultDisplay(spec) }
  }
  return overrides
}
