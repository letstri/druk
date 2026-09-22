import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, onCleanup } from 'solid-js'

import { ui } from '../themes'
import { useKeys } from './useKeys'

export function windowAround<T>(
  items: readonly T[],
  selected: number,
  size: number,
  lead = 1
): { start: number; rows: T[] } {
  const start = Math.max(
    0,
    Math.min(selected - size + lead, items.length - size)
  )
  return { rows: items.slice(start, start + size), start }
}

// OpenTUI floors the thumb at one virtual cell — half a row — which is too small to aim at.
const MIN_THUMB_ROWS = 3

// Two virtual cells per row, the unit the slider works in.
function enlargeThumb(box: ScrollBoxRenderable) {
  const slider = box.verticalScrollBar?.slider as unknown as
    | { getVirtualThumbSize: () => number; height: number }
    | undefined
  if (!slider) {
    return
  }
  const size = slider.getVirtualThumbSize.bind(slider)
  slider.getVirtualThumbSize = () =>
    Math.min(slider.height * 2, Math.max(size(), MIN_THUMB_ROWS * 2))
}

// Frames a scroll keeps re-trying: a list that mounts scrolled has no height for a pass or two.
const TRIES = 6

// One frame: the layout pass writes the content height later than any macrotask.
export const LAYOUT_FRAME = 16

/**
 * Re-runs `attempt` until it reports the scroll landed. A scrollbox clamps an offset
 * against the height it still has, and the layout pass writes the new height later than
 * any macrotask, so a single shot lands short. `defer` waits a macrotask for a reveal
 * that grows the list first. Returns the canceller.
 */
export function retryFrames(
  attempt: () => boolean,
  options: { tries?: number; delay?: number; defer?: boolean } = {}
): () => void {
  const { tries = TRIES, delay = LAYOUT_FRAME, defer = false } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let left = tries
  const run = () => {
    timer = undefined
    left -= 1
    if (attempt() || left <= 0) {
      return
    }
    timer = setTimeout(run, delay)
  }
  if (defer) {
    timer = setTimeout(run, 0)
  } else {
    run()
  }
  return () => clearTimeout(timer)
}

// The scrollbox emits no scroll event; every way it moves goes through its scrollbar, which does.
export function followScroll(
  el: ScrollBoxRenderable,
  moved: (top: number) => void
) {
  el.verticalScrollBar.on('change', () => moved(el.scrollTop))
}

// A list that mounts scrolled clamps to zero until the layout pass has given it a content height.
export function restoreScroll(
  el: ScrollBoxRenderable,
  top: number
): () => void {
  return retryFrames(() => {
    el.scrollTop = top
    return el.scrollTop === top
  })
}

// `viewportCulling` still builds culled rows, and the Zig core stops a few thousand in.
const OVERSCAN = 40

// A sidebar view unmounts whenever another takes the slot; its offset comes back with it.
const kept = new Map<string, number>()

// A closed sidebar or another workspace is a fresh start: the views centre their cursor again.
export const forgetScroll = () => kept.clear()
export const keptScroll = (key: string) => kept.get(key) ?? 0
export const keepScroll = (key: string, top: number) => kept.set(key, top)

export function createScrollList(total: () => number, key?: string) {
  const [scrollTop, setScrollTop] = createSignal(key ? keptScroll(key) : 0)
  const dimensions = useTerminalDimensions()
  let box: ScrollBoxRenderable | undefined

  const page = () => dimensions().height + 2 * OVERSCAN
  const window = createMemo(() => {
    const start = Math.max(
      0,
      Math.min(scrollTop() - OVERSCAN, total() - page())
    )
    return { end: Math.min(total(), start + page()), start }
  })

  let revealed = false
  let cancelReveal: (() => void) | null = null
  onCleanup(() => cancelReveal?.())

  const reveal = (row: number, center = false) => {
    cancelReveal?.()
    // Deferred: revealing a row can grow the list, and the scrollbox clamps against the old height.
    cancelReveal = retryFrames(
      () => {
        if (!box) {
          return true
        }
        const was = box.scrollTop
        const { height } = box.viewport
        // Before the layout pass every row reads as off screen, and centring on that sticks.
        if (height === 0) {
          return false
        }
        const shown = row >= box.scrollTop && row < box.scrollTop + height
        if (center && !shown) {
          box.scrollTop = Math.max(0, row - Math.floor(height / 2))
        } else if (row < box.scrollTop) {
          box.scrollTop = row
        } else if (row >= box.scrollTop + height) {
          box.scrollTop = row - height + 1
        }
        revealed ||= box.scrollTop !== was
        // Read it back: the box clamps to its own extent, and the wrong slice renders otherwise.
        setScrollTop(box.scrollTop)
        return (
          height > 0 && row >= box.scrollTop && row < box.scrollTop + height
        )
      },
      { defer: true }
    )
  }

  const ref = (el: ScrollBoxRenderable) => {
    box = el
    followScroll(el, (top) => {
      if (top !== scrollTop()) {
        setScrollTop(top)
      }
    })
    enlargeThumb(el)
    const top = scrollTop()
    if (top > 0) {
      onCleanup(
        retryFrames(() => {
          // A reveal is this moment's intent; the remembered offset is the last one's.
          if (revealed) {
            return true
          }
          el.scrollTop = top
          return el.scrollTop === top
        })
      )
    }
  }

  if (key) {
    onCleanup(() => keepScroll(key, scrollTop()))
  }

  return { ref, reveal, window }
}

// A function, not a constant: the palette is a store, so an object built at import time freezes.
export const scrollbarOptions = (background = ui.sidebarBg) => ({
  trackOptions: { backgroundColor: background, foregroundColor: ui.scrollbar },
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
    const step = (delta: number) =>
      handlers.move((index) => (index + delta + count) % count)
    if (key.name === 'up') {
      key.preventDefault()
      step(-1)
    } else if (key.name === 'down') {
      key.preventDefault()
      step(1)
    } else if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      handlers.pick()
    } else if (
      key.name === 'escape' ||
      handlers.alsoClose?.includes(key.name)
    ) {
      key.preventDefault()
      handlers.close()
    }
  })
}

export const rowBg = (
  selected: boolean,
  focused: boolean,
  hovered = false
): string =>
  selected
    ? focused
      ? ui.treeSelectedBg
      : ui.treeFocusBg
    : hovered
      ? ui.hoverBg
      : ui.sidebarBg
