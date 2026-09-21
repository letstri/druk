import type { CliRenderer } from '@opentui/core'
import { useRenderer } from '@opentui/solid'
import { onCleanup } from 'solid-js'

import { copyToClipboard } from '../core/clipboard'
import { cut } from './text'

const hosts = new WeakSet<object>()
const gated = new WeakSet<object>()

interface Node {
  parent?: Node | null
}

function allowed(renderable: unknown): boolean {
  for (let at = renderable as Node | null | undefined; at; at = at.parent) {
    if (hosts.has(at)) {
      return true
    }
  }
  return false
}

export function allowSelectionIn(el: object): void {
  hosts.add(el)
  const renderer = useRenderer() as unknown as {
    startSelection: (renderable: unknown, x: number, y: number) => void
  }
  if (gated.has(renderer)) {
    return
  }
  gated.add(renderer)
  const start = renderer.startSelection.bind(renderer)
  renderer.startSelection = (renderable: unknown, x: number, y: number) => {
    if (allowed(renderable)) {
      start(renderable, x, y)
    }
  }
}

/** Both routes: the subprocess reaches this machine, OSC 52 the terminal the user sits at. */
export function copyText(
  renderer: CliRenderer,
  text: string,
  say: (message: string) => void
) {
  copyToClipboard(text)
  renderer.copyToClipboardOSC52(text)
  const lines = text.split('\n').length
  say(lines > 1 ? `Copied ${lines} lines` : `Copied ${cut(text, 40)}`)
}

/** A finished drag is a copy: the renderer emits `selection` when the mouse comes up. */
export function copyOnSelect(say: (message: string) => void) {
  const renderer = useRenderer()
  const copy = () => {
    const text = renderer.getSelection()?.getSelectedText()
    if (text) {
      copyText(renderer, text, say)
    }
  }
  renderer.on('selection', copy)
  onCleanup(() => renderer.off('selection', copy))
}
