import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { latinKey } from '../core/keylayout'

/**
 * Every key handler in druk subscribes through here rather than OpenTUI's
 * `useKeyboard`, so a shortcut is the key's place on the keyboard and not the
 * letter the current layout prints — see `core/keylayout.ts`.
 *
 * A chord holding Ctrl or Cmd is renamed *in place*, which the listeners after
 * this one (and the textarea's own handling) see as well: the translation is
 * idempotent, so it does not matter which handler gets there first. Only with a
 * modifier — without one the character *is* what the user meant to type.
 *
 * A bare letter cannot be renamed that way — the panels spend bare letters on
 * commands (`d` discards, `r` renames) while the editor, the commit box and
 * every filter field spend the same keystroke on the character it prints — so it
 * is handed to the handler *beside* the event as `latin`. A handler switching on
 * a command reads `latin`; one consuming text reads `key.name`/`key.sequence`.
 * Getting that wrong is a Ukrainian layout typing `ф` and renaming a file.
 */
export function useKeys(handler: (key: KeyEvent, latin: string) => void) {
  useKeyboard((key: KeyEvent) => {
    const latin = latinKey(key)
    if (key.ctrl || key.meta) key.name = latin
    handler(key, latin)
  })
}
