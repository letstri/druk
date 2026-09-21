import { defaultTextareaKeyBindings } from '@opentui/core'
import type { KeyBinding } from '@opentui/core'

// macOS deletes to the line start with Cmd+Backspace, which OpenTUI's table has no entry for —
// its lookup keys a binding by `meta`/`super` alone, so nothing else covers the Cmd chord.
// Home/End are OpenTUI's *buffer* home and end; every GUI editor spells those Ctrl+Home and
// Ctrl+End and gives the bare keys the line. `visual-`, so a wrapped row ends where it wraps.
export const EDIT_KEYS: KeyBinding[] = [
  ...defaultTextareaKeyBindings,
  { action: 'delete-to-line-start', name: 'backspace', super: true },
  { action: 'visual-line-home', name: 'home' },
  { action: 'visual-line-end', name: 'end' },
  { action: 'select-visual-line-home', name: 'home', shift: true },
  { action: 'select-visual-line-end', name: 'end', shift: true },
  { action: 'buffer-home', ctrl: true, name: 'home' },
  { action: 'buffer-end', ctrl: true, name: 'end' },
  { action: 'select-buffer-home', ctrl: true, name: 'home', shift: true },
  { action: 'select-buffer-end', ctrl: true, name: 'end', shift: true },
]
