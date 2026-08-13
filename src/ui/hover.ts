import { createSignal } from 'solid-js'

/**
 * Hover state for one clickable element: wire `enter` to `onMouseOver` and
 * `leave` to `onMouseOut` on the element's box. `over`/`out` fire on the
 * deepest renderable under the pointer and bubble, so one pair on the row
 * covers every `<text>` inside it — and moving between two children delivers
 * the row its `out` before the next `over`, which nets to hovered.
 */
export function useHover() {
  const [hovered, setHovered] = createSignal(false)
  return {
    hovered,
    enter: () => setHovered(true),
    leave: () => setHovered(false),
  }
}

/**
 * Hover for a list's rows, keyed and held by the *panel* rather than a signal
 * per row. The panels hand `<For>` fresh row objects on every refresh — a git
 * or watcher tick in a busy repository, several times a second — so state
 * created inside the row callback is reborn `false` each time, and under a
 * resting pointer the highlight flashes off until the next mouse move. Keyed
 * state survives the rebuild: the replacement row paints hovered on its first
 * frame.
 */
export function useHoverKey<K extends string | number>() {
  const [key, setKey] = createSignal<K | null>(null)
  return {
    hovered: (k: K) => key() === k,
    enter: (k: K) => setKey(() => k),
    // Conditional: crossing onto the next row can deliver its `over` before
    // this row's `out`, and clearing unconditionally would erase the new state.
    leave: (k: K) => setKey(cur => (cur === k ? null : cur)),
  }
}
