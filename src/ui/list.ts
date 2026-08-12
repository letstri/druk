/**
 * Shared list behaviour, so a panel and a launcher scroll and highlight the same
 * way. Every one of these was copied between components before it lived here,
 * and the copies had already started to disagree.
 */
import type { KeyEvent, MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, onCleanup } from 'solid-js'

import { ui } from '../themes'
import { useKeys } from './useKeys'

/**
 * The window of `items` around `selected`, and where it starts.
 *
 * `lead` is how many rows of the list stay visible past the selection: one for a
 * plain list, more where the row above carries context (a search result's file
 * heading) that has to survive the scroll.
 */
export function windowAround<T>(
  items: readonly T[],
  selected: number,
  size: number,
  lead = 1,
): { start: number; rows: T[] } {
  const start = Math.max(0, Math.min(selected - size + lead, items.length - size))
  return { start, rows: items.slice(start, start + size) }
}

/**
 * Shortest the scrollbar thumb may get, in rows.
 *
 * OpenTUI floors it at one *virtual* cell — half a row — so a list of a few
 * hundred entries leaves a half-block that is neither visible at a glance nor
 * worth aiming at. Both the size and the thumb's travel come from this one
 * function, so raising the floor keeps dragging consistent with what is drawn.
 */
const MIN_THUMB_ROWS = 3

/** Two virtual cells per row, which is the unit the slider works in. */
function enlargeThumb(box: ScrollBoxRenderable) {
  const slider = box.verticalScrollBar?.slider as unknown as
    | { getVirtualThumbSize: () => number; height: number }
    | undefined
  if (!slider) return
  const size = slider.getVirtualThumbSize.bind(slider)
  slider.getVirtualThumbSize = () =>
    Math.min(slider.height * 2, Math.max(size(), MIN_THUMB_ROWS * 2))
}

/**
 * The scrollbox emits no scroll event, so the window is refreshed from the
 * renderable's own mouse hook — the same override EditorPane uses. Every mouse
 * type is checked, not just `scroll`: dragging its own scrollbar moves the view
 * too, and a window left behind renders the wrong slice.
 */
function followScroll(el: ScrollBoxRenderable, moved: (top: number) => void) {
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    handle(event)
    moved(el.scrollTop)
  }
}

/**
 * Only a window of rows exists as renderables. `viewportCulling` skips *drawing*
 * off-screen children but still builds them, and the Zig core stops handing out
 * renderables a few thousand in — expanding a directory of 8000 files used to
 * leave the tree blank.
 *
 * Sized from the terminal rather than fixed: the window has to cover the whole
 * viewport, and no list can be taller than the screen. A constant 200 left the
 * bottom of the tree empty on a terminal past ~160 rows.
 */
const OVERSCAN = 40

/**
 * A scrollbox-backed sidebar list: the wheel and the scrollbar move it, only a
 * window of its rows is built, and `reveal` brings a row the keyboard moved to
 * back into view.
 *
 * Give `ref` to the `<scrollbox>`, slice the items with `window()`, and pad both
 * ends with `<box height={…}>` spacers so the scrollable extent stays honest
 * while only a window exists.
 */
export function createScrollList(total: () => number) {
  const [scrollTop, setScrollTop] = createSignal(0)
  const dimensions = useTerminalDimensions()
  let box: ScrollBoxRenderable | undefined

  const page = () => dimensions().height + 2 * OVERSCAN
  const window = createMemo(() => {
    const start = Math.max(0, Math.min(scrollTop() - OVERSCAN, total() - page()))
    return { start, end: Math.min(total(), start + page()) }
  })

  /**
   * Bring `row` into view on the next macrotask rather than now.
   *
   * Revealing a row can grow the list in the same tick the cursor moves — a file
   * reveal expands its parents, a commit rewrites the change list. The scrollbox
   * clamps `scrollTop` against a content height that layout has not recomputed
   * yet, so scrolling immediately is silently clamped to 0 and the row stays
   * off-screen. One tick later the extent is real.
   */
  let pending: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (pending) clearTimeout(pending)
  })

  const reveal = (row: number) => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      if (!box) return
      const height = box.viewport.height
      if (row < box.scrollTop) box.scrollTop = row
      else if (row >= box.scrollTop + height) box.scrollTop = row - height + 1
      // Read it back: the scrollbox clamps to its own extent, and a window built
      // from a position the box never reached renders the wrong slice.
      setScrollTop(box.scrollTop)
    }, 0)
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

/**
 * Track colours every sidebar scrollbox shares. A function, not a constant: the
 * palette is a store, and an object built once at import time keeps the colours
 * the theme had at startup.
 */
export const scrollbarOptions = () => ({
  trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.sidebarBg },
})

/**
 * The keyboard a filtered picker has: ↑/↓ wrapping around the list, Enter to
 * take the selection, Esc to leave. `move` is given a wrapped index, so a picker
 * never has to spell the modulus out for itself.
 */
export function useListKeys(handlers: {
  count: () => number
  move: (next: (index: number) => number) => void
  pick: () => void
  close: () => void
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
    } else if (key.name === 'escape') {
      key.preventDefault()
      handlers.close()
    }
  })
}

/**
 * A sidebar row's background: the selection reads differently depending on
 * whether the panel holding it has the keyboard. Hover never outranks the
 * selection — the cursor's row keeps its colour under the pointer.
 */
export const rowBg = (selected: boolean, focused: boolean, hovered = false): string =>
  selected ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : hovered ? ui.hoverBg : ui.sidebarBg
