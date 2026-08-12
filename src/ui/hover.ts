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
