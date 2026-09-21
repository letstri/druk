import { createSignal } from 'solid-js'

export function createHoverPeek() {
  const [text, setText] = createSignal('')

  return {
    close: () => setText(''),
    open: () => text().length > 0,
    show: (found: string) => setText(found),
    text,
  }
}

export type HoverPeek = ReturnType<typeof createHoverPeek>
