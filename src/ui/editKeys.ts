import { defaultTextareaKeyBindings } from '@opentui/core'
import type { KeyBinding } from '@opentui/core'

// macOS deletes to the line start with Cmd+Backspace, which OpenTUI's table has no entry for —
// its lookup keys a binding by `meta`/`super` alone, so nothing else covers the Cmd chord.
export const EDIT_KEYS: KeyBinding[] = [
  ...defaultTextareaKeyBindings,
  { name: 'backspace', super: true, action: 'delete-to-line-start' },
]
