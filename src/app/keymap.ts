import type { KeyEvent } from '@opentui/core'

import {
  bindingProblem,
  chordId,
  formatChord,
  matchesChord,
  parseChord,
} from '../core/keybindings'
import type { Chord } from '../core/keybindings'
import { ALT } from '../ui/keys'

export interface Bindable {
  id: string
  label: string
  defaults: string[]
  also?: string[]
}

// Every id needs a handler in `keyboard.ts`; order is the precedence between two custom bindings.
export const BINDABLE: Bindable[] = [
  {
    defaults: ['F1', `Ctrl+${ALT}+P`],
    id: 'palette',
    label: 'Command palette',
  },
  { defaults: ['Ctrl+K'], id: 'peek', label: 'Peek at every key' },
  { defaults: ['Ctrl+P', 'Ctrl+O'], id: 'open', label: 'Open file…' },
  { defaults: ['Ctrl+S'], id: 'save', label: 'Save file' },
  { defaults: [], id: 'file.saveAll', label: 'Save all' },
  {
    defaults: [],
    id: 'file.saveWithoutFormatting',
    label: 'Save without formatting',
  },
  { defaults: ['Ctrl+G'], id: 'goto', label: 'Go to line…' },
  { defaults: ['F12'], id: 'goto.definition', label: 'Go to definition' },
  { defaults: [], id: 'goto.references', label: 'Find references' },
  { defaults: [], id: 'goto.implementation', label: 'Go to implementation' },
  { defaults: [], id: 'goto.typeDefinition', label: 'Go to type definition' },
  { defaults: [], id: 'goto.symbol', label: 'Go to symbol in file' },
  { defaults: [`Ctrl+${ALT}+H`], id: 'goto.calls', label: 'Peek calls' },
  {
    defaults: [`Ctrl+${ALT}+K`],
    id: 'goto.hover',
    label: 'Show documentation at cursor',
  },
  {
    defaults: [],
    id: 'goto.workspaceSymbol',
    label: 'Go to symbol in project',
  },
  {
    defaults: [`Ctrl+${ALT}+O`],
    id: 'goto.file',
    label: 'Open file under cursor',
  },
  { defaults: ['Ctrl+F'], id: 'find.file', label: 'Find in current file' },
  // Ctrl+R is vim's redo, which takes it back in normal mode — so it cannot be the advertised one.
  {
    also: ['Ctrl+R'],
    defaults: [`Ctrl+${ALT}+F`],
    id: 'find.project',
    label: 'Find in project',
  },
  { defaults: [], id: 'find.replace', label: 'Replace in current file' },
  { defaults: [], id: 'find.replaceProject', label: 'Replace in project' },
  { defaults: ['Ctrl+N'], id: 'file.new', label: 'New file' },
  { defaults: [`Ctrl+${ALT}+N`], id: 'file.newDir', label: 'New folder' },
  { defaults: [`Ctrl+${ALT}+C`], id: 'file.copyPath', label: 'Copy path' },
  { defaults: [], id: 'file.copyRelativePath', label: 'Copy relative path' },
  { defaults: ['Ctrl+W'], id: 'tabs.close', label: 'Close tab' },
  {
    defaults: [`Ctrl+${ALT}+T`],
    id: 'tabs.reopen',
    label: 'Reopen closed tab',
  },
  {
    also: ['Ctrl+↑'],
    defaults: ['Ctrl+T'],
    id: 'tabs.switch',
    label: 'Switch to open tab',
  },
  // No bare Ctrl+←/→ here: that is the textarea's word motion, the chord every editor
  // on Linux and Windows uses for it. Terminal.app, which delivers the Opt form as a
  // bare ctrl+arrow, is left with Ctrl+PgUp/PgDn.
  {
    also: ['Ctrl+PgUp'],
    defaults: [`Ctrl+${ALT}+←`],
    id: 'tabs.prev',
    label: 'Previous tab',
  },
  {
    also: ['Ctrl+PgDn'],
    defaults: [`Ctrl+${ALT}+→`],
    id: 'tabs.next',
    label: 'Next tab',
  },
  { defaults: [`Ctrl+${ALT}+Z`], id: 'nav.back', label: 'Go back' },
  { defaults: [`Ctrl+${ALT}+Y`], id: 'nav.forward', label: 'Go forward' },
  { defaults: [], id: 'tabs.closeOthers', label: 'Close other tabs' },
  { defaults: [], id: 'tabs.closeAll', label: 'Close all tabs' },
  {
    defaults: [`Ctrl+${ALT}+B`],
    id: 'editor.lineStart',
    label: 'Go to beginning of line',
  },
  {
    defaults: [`Ctrl+${ALT}+D`],
    id: 'editor.deleteLine',
    label: 'Delete line',
  },
  {
    defaults: [`Ctrl+${ALT}+L`],
    id: 'editor.format',
    label: 'Format document',
  },
  { defaults: [], id: 'editor.formatOpen', label: 'Format open files' },
  {
    defaults: [`Ctrl+${ALT}+S`],
    id: 'editor.fold',
    label: 'Fold block at cursor',
  },
  {
    defaults: [`Ctrl+${ALT}+E`],
    id: 'editor.unfold',
    label: 'Unfold block at cursor',
  },
  { defaults: [], id: 'editor.foldAll', label: 'Fold everything' },
  { defaults: [], id: 'editor.unfoldAll', label: 'Unfold everything' },
  { defaults: ['Ctrl+B'], id: 'view.sidebar', label: 'Show / hide sidebar' },
  {
    defaults: [`Ctrl+${ALT}+G`],
    id: 'view.git',
    label: 'Source control panel',
  },
  { defaults: [`Ctrl+${ALT}+R`], id: 'view.review', label: 'Review panel' },
  {
    defaults: [`Ctrl+${ALT}+X`],
    id: 'view.extensions',
    label: 'Extensions panel',
  },
  { defaults: [], id: 'view.collapse', label: 'Collapse folders in sidebar' },
  {
    defaults: [`Ctrl+${ALT}+M`],
    id: 'view.markdown',
    label: 'Markdown: rendered / source',
  },
  { defaults: [], id: 'view.wrap', label: 'Toggle word wrap' },
  {
    defaults: [],
    id: 'view.sidebarPosition',
    label: 'Toggle sidebar position',
  },
  { defaults: [], id: 'view.preview', label: 'Preview file (no tab)' },
  { defaults: [], id: 'view.focus', label: 'Focus tree / editor' },
  { defaults: [], id: 'git.diffFile', label: 'Diff current file' },
  { defaults: [], id: 'git.diffAll', label: 'Show all changes' },
  { defaults: [], id: 'git.diffLayout', label: 'Toggle diff layout' },
  { defaults: [], id: 'git.commit', label: 'Commit…' },
  { defaults: [], id: 'git.stage', label: 'Stage / unstage selection' },
  { defaults: [], id: 'git.discard', label: 'Discard changes' },
  { defaults: [], id: 'git.push', label: 'Push' },
  { defaults: [], id: 'git.compare', label: 'Compare branches' },
  { defaults: [], id: 'git.graph', label: 'Commit graph' },
  { defaults: [], id: 'git.openCommitWeb', label: 'Open commit on remote' },
  {
    defaults: [`Ctrl+${ALT}+U`],
    id: 'git.conflictResolve',
    label: 'Resolve conflict at cursor',
  },
  {
    defaults: [`Ctrl+${ALT}+J`],
    id: 'git.conflictNext',
    label: 'Next conflict',
  },
  { defaults: [], id: 'git.conflictPrev', label: 'Previous conflict' },
  { defaults: [], id: 'git.acceptOurs', label: 'Accept current change (ours)' },
  {
    defaults: [],
    id: 'git.acceptTheirs',
    label: 'Accept incoming change (theirs)',
  },
  { defaults: [], id: 'git.acceptBoth', label: 'Accept both changes' },
  {
    defaults: [`Ctrl+${ALT}+A`],
    id: 'review.note',
    label: 'Note this line for a review',
  },
  { defaults: [], id: 'problems.list', label: 'List problems' },
  {
    defaults: [`Ctrl+${ALT}+I`],
    id: 'problems.detail',
    label: 'Show problem at cursor',
  },
  { defaults: ['F8'], id: 'problems.next', label: 'Next problem' },
  // Shift and Opt are one bucket in `secondary`, so this answers to VS Code's Shift+F8 as well.
  { defaults: [`${ALT}+F8`], id: 'problems.prev', label: 'Previous problem' },
  { defaults: [], id: 'problems.restart', label: 'Restart language servers' },
  {
    defaults: [`Ctrl+${ALT}+W`],
    id: 'workspace.switch',
    label: 'Switch workspace…',
  },
  { defaults: [], id: 'workspace.open', label: 'Open folder…' },
  { defaults: [], id: 'settings', label: 'Settings' },
  { defaults: [], id: 'help', label: 'Keyboard shortcuts' },
  { defaults: ['Ctrl+Q'], id: 'quit', label: 'Quit' },
]

const UNBOUND_WORDS = new Set(['none', 'off', 'unbound', '-'])

export const isUnbound = (value: string): boolean =>
  UNBOUND_WORDS.has(value.trim().toLowerCase())

interface Conflict {
  key: string
  winner: string
  loser: string
  rejected: boolean
}

interface InvalidBinding {
  id: string
  label: string
  value: string
  reason: string
}

export interface Keymap {
  chords: Map<string, Chord[]>
  display: Map<string, string>
  custom: Set<string>
  conflicts: Conflict[]
  invalid: InvalidBinding[]
}

const chordsOf = (spellings: string[]): Chord[] =>
  spellings.map(parseChord).filter((chord): chord is Chord => chord !== null)

export const defaultDisplay = (spec: Bindable): string =>
  chordsOf(spec.defaults)
    .map((chord) => formatChord(chord, ALT))
    .join(' · ')

export function resolveKeymap(custom: Record<string, string>): Keymap {
  const chords = new Map<string, Chord[]>()
  const display = new Map<string, string>()
  const customIds = new Set<string>()
  const conflicts: Conflict[] = []
  const invalid: InvalidBinding[] = []

  for (const spec of BINDABLE) {
    const raw = custom[spec.id]
    if (raw === undefined) {
      continue
    }
    if (raw.trim() === '' || isUnbound(raw)) {
      chords.set(spec.id, [])
      customIds.add(spec.id)
      continue
    }
    const chord = parseChord(raw)
    const reason = chord
      ? bindingProblem(chord)
      : `not a key chord — try Ctrl+${ALT}+K or F5`
    if (!chord || reason) {
      invalid.push({
        id: spec.id,
        label: spec.label,
        reason: reason!,
        value: raw.trim(),
      })
      continue
    }
    chords.set(spec.id, [chord])
    customIds.add(spec.id)
  }

  for (const spec of BINDABLE) {
    if (!chords.has(spec.id)) {
      chords.set(spec.id, chordsOf([...spec.defaults, ...(spec.also ?? [])]))
    }
  }

  // Custom bindings claim first, so a rebind takes the key from the default holding it.
  const owner = new Map<string, Bindable>()
  for (const pass of [true, false]) {
    for (const spec of BINDABLE) {
      if (customIds.has(spec.id) !== pass) {
        continue
      }
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
          loser: spec.label,
          rejected: pass,
          winner: held.label,
        })
      }
      chords.set(spec.id, kept)
    }
  }

  for (const spec of BINDABLE) {
    const advertised = new Set(chordsOf(spec.defaults).map(chordId))
    const shown = (chords.get(spec.id) ?? []).filter(
      (chord) => customIds.has(spec.id) || advertised.has(chordId(chord))
    )
    display.set(
      spec.id,
      shown.map((chord) => formatChord(chord, ALT)).join(' · ')
    )
  }

  return { chords, conflicts, custom: customIds, display, invalid }
}

export function matchKeymap(keymap: Keymap, key: KeyEvent): string | null {
  for (const [id, chords] of keymap.chords) {
    if (chords.some((chord) => matchesChord(chord, key))) {
      return id
    }
  }
  return null
}

export function customHolder(
  keymap: Keymap,
  chord: Chord,
  except: string
): Bindable | null {
  for (const spec of BINDABLE) {
    if (spec.id === except || !keymap.custom.has(spec.id)) {
      continue
    }
    if (
      (keymap.chords.get(spec.id) ?? []).some(
        (held) => chordId(held) === chordId(chord)
      )
    ) {
      return spec
    }
  }
  return null
}

export function keyOverrides(
  keymap: Keymap
): Record<string, { key: string; label: string; changed: boolean }> {
  const overrides: Record<
    string,
    { key: string; label: string; changed: boolean }
  > = {}
  for (const spec of BINDABLE) {
    const key = keymap.display.get(spec.id) ?? ''
    overrides[spec.id] = {
      changed: key !== defaultDisplay(spec),
      key,
      label: spec.label,
    }
  }
  return overrides
}
