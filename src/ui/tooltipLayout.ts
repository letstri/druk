/**
 * Where tooltips go. Pure, because the packing is the whole difficulty: a
 * terminal has no layer that floats free of the grid, so a tooltip is cells
 * taken off some other row — and while the peek is up, every chrome button in
 * the editor wants one at once.
 */
import { cut } from './text'

export interface TooltipAnchor {
  id: number
  /** The row's text, already assembled; this module only measures it. */
  text: string
  /** The control's own box, in screen cells. */
  x: number
  y: number
  width: number
  height: number
}

/** A control's own cells, which no tooltip may be drawn over. */
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

/** One column between two tooltips sharing a row, so they read as two. */
const GAP = 1

/**
 * Rows to try for one anchor, nearest first. Away from the nearer edge of the
 * screen: the tab strip is row 0 and the status bar is the last one, so a rule
 * of "always above" would put half of them off screen.
 */
function rowsFor(anchor: TooltipAnchor, height: number): number[] {
  const rows: number[] = []
  if (anchor.y < height / 2) {
    for (let row = anchor.y + anchor.height; row < height; row++) rows.push(row)
  } else {
    for (let row = anchor.y - 1; row >= 0; row--) rows.push(row)
  }
  return rows
}

/**
 * Place as many of `anchors` as the screen has room for, each on the row nearest
 * its control that nothing else has claimed. An anchor with nowhere to go is
 * dropped rather than drawn over its neighbour — during a peek there may be more
 * tooltips than the terminal can hold, and half a row of overlapping text says
 * less than nothing.
 *
 * `avoid` is every registered control's own box, and no tooltip is placed over
 * one. The peek lights the buttons it is naming keys for, which a box sitting on
 * top of them would hide — and the rows druk keeps its buttons on are exactly the
 * rows a tooltip reaches for first, the tab strip being row 0 and the sidebar's
 * own strip the row under it.
 */
export function placeTooltips(
  anchors: TooltipAnchor[],
  screen: { width: number; height: number },
  avoid: TooltipObstacle[] = [],
): PlacedTooltip[] {
  const taken = new Map<number, [number, number][]>()
  const placed: PlacedTooltip[] = []

  for (const anchor of anchors) {
    const text = cut(anchor.text, screen.width)
    if (!text) continue
    // Under the control where there is room, so the tooltip reads as belonging
    // to it, and shifted left only where the right edge would cut it off.
    const left = Math.max(0, Math.min(anchor.x, screen.width - text.length))
    const right = left + text.length

    for (const top of rowsFor(anchor, screen.height)) {
      const busy = taken.get(top) ?? []
      if (busy.some(([from, to]) => left < to + GAP && from < right + GAP)) continue
      const onAControl = avoid.some(
        box =>
          top >= box.y && top < box.y + box.height && left < box.x + box.width && box.x < right,
      )
      if (onAControl) continue
      busy.push([left, right])
      taken.set(top, busy)
      placed.push({ id: anchor.id, text, left, top })
      break
    }
  }

  return placed
}
