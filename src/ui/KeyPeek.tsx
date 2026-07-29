import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For } from 'solid-js'

import { ui } from '../themes'
import { keysFor } from './keys'
import { PAD } from './modal'

/** Columns between one key/label pair and the next. */
const GAP = 3

const clip = (label: string, width: number) =>
  label.length > width ? `${label.slice(0, width - 1)}…` : label

/**
 * The Ctrl+K peek: every key alive in the current pane, as a panel sitting on
 * the status bar. Opened by a key and closed by the next one, so it reads as
 * "hold to see" without needing key-release events no classic terminal sends.
 */
export function KeyPeek(props: { pane: 'tree' | 'editor'; vscodeKeys: boolean }) {
  const dimensions = useTerminalDimensions()

  const layout = createMemo(() => {
    const entries = keysFor(props.pane, props.vscodeKeys)
    const inner = dimensions().width - 2 - PAD * 2
    const keyWidth = Math.max(...entries.map(entry => entry.key.length))
    const wanted = keyWidth + 1 + Math.max(...entries.map(entry => entry.label.length)) + GAP

    let cols = Math.max(1, Math.min(entries.length, Math.floor(inner / wanted)))
    let rows = Math.ceil(entries.length / cols)
    // The panel must leave the editor visible; past the cap, columns squeeze instead.
    const maxRows = Math.max(1, dimensions().height - 6)
    if (rows > maxRows) {
      rows = maxRows
      cols = Math.ceil(entries.length / rows)
    }

    // Column-major, so the panel reads top to bottom like the help table.
    const grid = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => entries[col * rows + row]).filter(
        entry => entry !== undefined,
      ),
    )
    const labelWidth = Math.max(4, Math.floor(inner / cols) - keyWidth - 1 - GAP)
    return { grid, keyWidth, labelWidth }
  })

  return (
    <box
      position="absolute"
      left={0}
      top={dimensions().height - 3 - layout().grid.length}
      width="100%"
      flexDirection="column"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.accent}
      title={` Keys · ${props.pane === 'tree' ? 'file tree' : 'editor'} `}
      titleColor={ui.text}
      paddingLeft={PAD}
      paddingRight={PAD}
      zIndex={90}
    >
      <For each={layout().grid}>
        {line => (
          <box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
            <For each={line}>
              {entry => (
                <box flexDirection="row" flexShrink={0} backgroundColor={ui.panelBg}>
                  <text
                    fg={ui.accent}
                    bg={ui.panelBg}
                    content={entry.key.padEnd(layout().keyWidth)}
                    attributes={TextAttributes.BOLD}
                  />
                  <text
                    fg={ui.dim}
                    bg={ui.panelBg}
                    content={` ${clip(entry.label, layout().labelWidth).padEnd(layout().labelWidth + GAP - 1)}`}
                  />
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
