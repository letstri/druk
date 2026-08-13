import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For } from 'solid-js'

import { ui } from '../themes'
import { tooltipAnchors, tooltipObstacles } from './tooltip'
import { placeTooltips } from './tooltipLayout'

/**
 * Every tooltip on screen, drawn over the chrome that asked for one.
 *
 * A sibling of the app's own rows rather than a full-screen box over them: a
 * renderable claims the cells it paints in the hit grid whether or not it
 * handles a mouse event, so a layer spanning the terminal would swallow every
 * click in the editor. These are a few cells each, and they sit beside the
 * control rather than on it, so the pointer is never on one of its own accord.
 *
 * One row apiece, no border and no shadow. A border is drawable — the modals
 * have one — but it costs two rows and two columns per tooltip, and during a
 * peek there are a dozen of them on a screen that has to stay readable
 * underneath. A shadow is not drawable at all: a terminal cell holds one
 * background, so "dimming what is behind" means painting solid dark cells over
 * the editor, which reads as a smear rather than as depth.
 *
 * What separates a tooltip from the editor is therefore colour alone, and it
 * has to be a pair that cannot fail: `statusBg`/`statusFg` is the one the
 * palettes guarantee legible together, and it is already what the vim badge and
 * the pressed sidebar tab are filled with, so a tooltip reads as chrome rather
 * than as something the file says. `panelBg` would be wrong here — that is the
 * surface a floating *panel* is built from, and a tooltip is not a panel.
 */
export function TooltipLayer() {
  const dimensions = useTerminalDimensions()

  // The `tooltips` setting is not a prop: it gates the buttons lighting up as
  // well as the boxes, so it is held in `tooltip.ts` and pushed there by `App`.
  const placed = createMemo(() => placeTooltips(tooltipAnchors(), dimensions(), tooltipObstacles()))

  return (
    <For each={placed()}>
      {tip => (
        <box
          position="absolute"
          left={tip.left}
          top={tip.top}
          height={1}
          zIndex={90}
          backgroundColor={ui.statusBg}
        >
          <text
            fg={ui.statusFg}
            bg={ui.statusBg}
            content={tip.text}
            wrapMode="none"
            attributes={TextAttributes.BOLD}
          />
        </box>
      )}
    </For>
  )
}
