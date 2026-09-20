import { createSignal } from 'solid-js'

export function useHover() {
  const [hovered, setHovered] = createSignal(false)
  return {
    hovered,
    enter: () => setHovered(true),
    leave: () => setHovered(false),
  }
}

// Keyed by the panel, not per row: `<For>` rebirths row state false under a resting pointer.
export function useHoverKey<K extends string | number>() {
  const [key, setKey] = createSignal<K | null>(null)
  return {
    hovered: (k: K) => key() === k,
    enter: (k: K) => setKey(() => k),
    // The next row's `over` can arrive before this row's `out`; clearing unconditionally would erase it.
    leave: (k: K) => setKey(cur => (cur === k ? null : cur)),
  }
}
