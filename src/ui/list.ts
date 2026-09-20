import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, onCleanup } from 'solid-js'

import { ui } from '../themes'
import { useKeys } from './useKeys'

export function windowAround<T>(
  items: readonly T[],
  selected: number,
  size: number,
  lead = 1,
): { start: number; rows: T[] } {
  const start = Math.max(0, Math.min(selected - size + lead, items.length - size))
  return { start, rows: items.slice(start, start + size) }
}

// OpenTUI floors the thumb at one virtual cell — half a row — which is too small to aim at.
const MIN_THUMB_ROWS = 3

// Two virtual cells per row, the unit the slider works in.
function enlargeThumb(box: ScrollBoxRenderable) {
  const slider = box.verticalScrollBar?.slider as unknown as
    | { getVirtualThumbSize: () => number; height: number }
    | undefined
  if (!slider) return
  const size = slider.getVirtualThumbSize.bind(slider)
  slider.getVirtualThumbSize = () =>
    Math.min(slider.height * 2, Math.max(size(), MIN_THUMB_ROWS * 2))
}

// Frames a scroll keeps re-trying: a list that mounts scrolled has no height for a pass or two.
const TRIES = 6

// One frame: the layout pass writes the content height later than any macrotask.
const LAYOUT_FRAME = 16

// The scrollbox emits no scroll event; every way it moves goes through its scrollbar, which does.
export function followScroll(el: ScrollBoxRenderable, moved: (top: number) => void) {
  el.verticalScrollBar.on('change', () => moved(el.scrollTop))
}

// A list that mounts scrolled clamps to zero until the layout pass has given it a content height.
export function restoreScroll(el: ScrollBoxRenderable, top: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let tries = 0
  const apply = () => {
    el.scrollTop = top
    if (el.scrollTop !== top && ++tries < TRIES) timer = setTimeout(apply, LAYOUT_FRAME)
  }
  apply()
  return () => clearTimeout(timer)
}

// `viewportCulling` still builds culled rows, and the Zig core stops a few thousand in.
const OVERSCAN = 40

export function createScrollList(total: () => number) {
  const [scrollTop, setScrollTop] = createSignal(0)
  const dimensions = useTerminalDimensions()
  let box: ScrollBoxRenderable | undefined

  const page = () => dimensions().height + 2 * OVERSCAN
  const window = createMemo(() => {
    const start = Math.max(0, Math.min(scrollTop() - OVERSCAN, total() - page()))
    return { start, end: Math.min(total(), start + page()) }
  })

  // A macrotask: revealing a row can grow the list, and the scrollbox clamps against the old height.
  let pending: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (pending) clearTimeout(pending)
  })

  const reveal = (row: number) => {
    if (pending) clearTimeout(pending)
    let attempts = 0
    const tryReveal = () => {
      pending = null
      if (!box) return
      const height = box.viewport.height
      if (row < box.scrollTop) box.scrollTop = row
      else if (row >= box.scrollTop + height) box.scrollTop = row - height + 1
      // Read it back: the box clamps to its own extent, and the wrong slice renders otherwise.
      setScrollTop(box.scrollTop)
      const landed = height > 0 && row >= box.scrollTop && row < box.scrollTop + height
      // A list mounting scrolled has no content height yet, so the offset clamps to zero.
      if (!landed && ++attempts < TRIES) pending = setTimeout(tryReveal, LAYOUT_FRAME)
    }
    pending = setTimeout(tryReveal, 0)
  }

  const ref = (el: ScrollBoxRenderable) => {
    box = el
    followScroll(el, top => {
      if (top !== scrollTop()) setScrollTop(top)
    })
    enlargeThumb(el)
  }

  return { ref, window, reveal }
}

// A function, not a constant: the palette is a store, so an object built at import time freezes.
export const scrollbarOptions = () => ({
  trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.sidebarBg },
})

// `move` is given an already-wrapped index.
export function useListKeys(handlers: {
  count: () => number
  move: (next: (index: number) => number) => void
  pick: () => void
  close: () => void
  alsoClose?: string[]
}) {
  useKeys((key: KeyEvent) => {
    const count = Math.max(1, handlers.count())
    const step = (delta: number) => handlers.move(index => (index + delta + count) % count)
    if (key.name === 'up') {
      key.preventDefault()
      step(-1)
    } else if (key.name === 'down') {
      key.preventDefault()
      step(1)
    } else if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      handlers.pick()
    } else if (key.name === 'escape' || handlers.alsoClose?.includes(key.name)) {
      key.preventDefault()
      handlers.close()
    }
  })
}

export const rowBg = (selected: boolean, focused: boolean, hovered = false): string =>
  selected ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : hovered ? ui.hoverBg : ui.sidebarBg
