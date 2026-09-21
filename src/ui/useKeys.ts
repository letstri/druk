import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { capsChar, latinKey } from '../core/keylayout'

export function useKeys(handler: (key: KeyEvent, latin: string) => void) {
  useKeyboard((key: KeyEvent) => {
    // Associated text and the key-code fallback share `sequence`; only the raw event tells them apart.
    const text = key.sequence
    const hasText =
      key.source === 'kitty' &&
      /^[\d:]+;[\d:]*;\d[\d:]*u$/u.test(key.raw.slice(2)) &&
      text.length > 0 &&
      !/\p{Cc}/u.test(text)
    // `meta` is Alt *or* Meta, so meta without option is a real Meta chord.
    if (hasText && !key.ctrl && (!key.meta || key.option)) {
      key.meta = false
      key.option = false
      // Space commits a composition and an IME commit could spell `return`: no name for multi-codepoint text.
      key.name =
        [...text].length > 1 ? '' : text === ' ' ? 'space' : text.toLowerCase()
    }
    // This runs as a global handler, ahead of the focused textarea's own.
    if (!hasText && key.capsLock && !key.ctrl && !key.meta && key.sequence) {
      key.sequence = capsChar(key.sequence, key.shift)
    }
    const latin = latinKey(key)
    if (key.ctrl || key.meta) {
      key.name = latin
    }
    handler(key, latin)
  })
}
