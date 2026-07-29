import { TextAttributes } from '@opentui/core'
import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Match, Switch } from 'solid-js'

import { ui } from '../themes'
import { sectionsFor } from './keys'
import { modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'

type Line =
  | { kind: 'header'; text: string }
  | { kind: 'key'; key: string; label: string }
  | { kind: 'gap' }

export function HelpOverlay(props: { vscodeKeys: boolean }) {
  /** The sections flattened to display lines, so one window can scroll them all. */
  const lines = createMemo<Line[]>(() =>
    sectionsFor(props.vscodeKeys).flatMap((section, index) => [
      ...(index > 0 ? [{ kind: 'gap' } as const] : []),
      { kind: 'header', text: section.title } as const,
      ...section.rows.map(([key, label]) => ({ kind: 'key', key, label }) as const),
    ]),
  )
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.52, 58, 84)
  // The full table outgrows a 24-row terminal, so only a window is drawn.
  const visible = () => Math.max(3, Math.min(lines().length, dimensions().height - 7))
  const [top, setTop] = createSignal(0)
  const overflowing = () => visible() < lines().length

  useKeyboard((key: KeyEvent) => {
    const step = key.name === 'up' ? -1 : key.name === 'down' ? 1 : 0
    if (step === 0) return
    key.preventDefault()
    setTop(at => Math.max(0, Math.min(lines().length - visible(), at + step)))
  })

  return (
    <Overlay zIndex={200}>
      <box
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title=" Keyboard shortcuts "
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={lines().slice(top(), top() + visible())}>
          {line => (
            <Switch>
              <Match when={line.kind === 'header' && line}>
                {(header: () => { text: string }) => (
                  <text
                    fg={ui.accent}
                    bg={ui.panelBg}
                    content={header().text}
                    attributes={TextAttributes.BOLD}
                  />
                )}
              </Match>
              <Match when={line.kind === 'key' && line}>
                {(row: () => { key: string; label: string }) => (
                  <box flexDirection="row">
                    <box width={20} flexShrink={0} paddingLeft={1}>
                      <text fg={ui.text} bg={ui.panelBg} content={row().key} />
                    </box>
                    <box flexGrow={1}>
                      <text fg={ui.dim} bg={ui.panelBg} content={row().label} />
                    </box>
                  </box>
                )}
              </Match>
              <Match when={line.kind === 'gap'}>
                <text fg={ui.panelBg} bg={ui.panelBg} content="" />
              </Match>
            </Switch>
          )}
        </For>
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={overflowing() ? '↑↓ scroll · Esc close' : 'Press Esc to close'}
        />
      </box>
    </Overlay>
  )
}
