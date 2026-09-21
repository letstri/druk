import { createSignal } from 'solid-js'

export function useHover() {
  const [hovered, setHovered] = createSignal(false)
  return {
    enter: () => setHovered(true),
    hovered,
    leave: () => setHovered(false),
  }
}

// Keyed by the panel, not per row: `<For>` rebirths row state false under a resting pointer.
export function useHoverKey<K extends string | number>() {
  const [key, setKey] = createSignal<K | null>(null)
  return {
    enter: (k: K) => setKey(() => k),
    hovered: (k: K) => key() === k,
    // The next row's `over` can arrive before this row's `out`; clearing unconditionally would erase it.
    leave: (k: K) => setKey((cur) => (cur === k ? null : cur)),
  }
}
