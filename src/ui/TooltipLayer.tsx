import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For } from 'solid-js'

import { ui } from '../themes'
import { tooltipAnchors, tooltipObstacles } from './tooltip'
import { placeTooltips } from './tooltipLayout'

// Siblings, not one full-screen box: a renderable claims its hit-grid cells and would eat every click.
export function TooltipLayer() {
  const dimensions = useTerminalDimensions()

  const placed = createMemo(() =>
    placeTooltips(tooltipAnchors(), dimensions(), tooltipObstacles())
  )

  return (
    <For each={placed()}>
      {(tip) => (
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
