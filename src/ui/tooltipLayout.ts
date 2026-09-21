import { cut } from './text'

export interface TooltipAnchor {
  id: number
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface TooltipObstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedTooltip {
  id: number
  text: string
  left: number
  top: number
}

const GAP = 1

// Away from the nearer screen edge: the tab strip is row 0 and the status bar the last.
function rowsFor(anchor: TooltipAnchor, height: number): number[] {
  const rows: number[] = []
  if (anchor.y < height / 2) {
    for (let row = anchor.y + anchor.height; row < height; row += 1) {
      rows.push(row)
    }
  } else {
    for (let row = anchor.y - 1; row >= 0; row -= 1) {
      rows.push(row)
    }
  }
  return rows
}

// An anchor with nowhere to go is dropped; `avoid` is every control's box, which a chip would hide.
export function placeTooltips(
  anchors: TooltipAnchor[],
  screen: { width: number; height: number },
  avoid: TooltipObstacle[] = []
): PlacedTooltip[] {
  const taken = new Map<number, [number, number][]>()
  const placed: PlacedTooltip[] = []

  for (const anchor of anchors) {
    const text = cut(anchor.text, screen.width)
    if (!text) {
      continue
    }
    const left = Math.max(0, Math.min(anchor.x, screen.width - text.length))
    const right = left + text.length

    for (const top of rowsFor(anchor, screen.height)) {
      const busy = taken.get(top) ?? []
      if (busy.some(([from, to]) => left < to + GAP && from < right + GAP)) {
        continue
      }
      const onAControl = avoid.some(
        (box) =>
          top >= box.y &&
          top < box.y + box.height &&
          left < box.x + box.width &&
          box.x < right
      )
      if (onAControl) {
        continue
      }
      busy.push([left, right])
      taken.set(top, busy)
      placed.push({ id: anchor.id, left, text, top })
      break
    }
  }

  return placed
}
