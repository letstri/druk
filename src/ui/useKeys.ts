import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { capsChar, latinKey } from '../core/keylayout'

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
 *
 * Caps Lock is applied to the *character* alone, for the reason in
 * `core/keylayout.ts`. The key's name is left lowercase on purpose: every bare
 * letter druk answers to is a command, and a lock meant for typing must not take
 * the tree's `r` or vim's `d` away — the same rule that keeps them working on a
 * Cyrillic layout.
 */
export function useKeys(handler: (key: KeyEvent, latin: string) => void) {
  useKeyboard((key: KeyEvent) => {
    // OpenTUI puts the terminal's associated text and its own key-code fallback
    // both in `sequence`, so only the raw event tells them apart — and clearing
    // Alt on a fallback types a letter out of a dead key or an Alt chord. A
    // control character is never that text; taking one renames `return` to \r.
    const text = key.sequence
    const hasText =
      key.source === 'kitty' &&
      /^[\d:]+;[\d:]*;\d[\d:]*u$/.test(key.raw.slice(2)) &&
      text.length > 0 &&
      !/\p{Cc}/u.test(text)
    // `meta` is Alt *or* Meta, so meta without option is a real Meta chord.
    if (hasText && !key.ctrl && (!key.meta || key.option)) {
      key.meta = false
      key.option = false
      // A composition commits on Space, whose name would insert one instead;
      // an IME commit is no key at all, or its text could spell `return`.
      key.name = [...text].length > 1 ? '' : text === ' ' ? 'space' : text.toLowerCase()
    }
    // Before the textarea reads it: this runs as a global handler, which the
    // renderer emits ahead of the focused renderable's own.
    if (!hasText && key.capsLock && !key.ctrl && !key.meta && key.sequence) {
      key.sequence = capsChar(key.sequence, key.shift)
    }
    const latin = latinKey(key)
    if (key.ctrl || key.meta) key.name = latin
    handler(key, latin)
  })
}
