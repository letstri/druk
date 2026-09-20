import { TextAttributes } from '@opentui/core'
import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Match, Switch } from 'solid-js'

import { ui } from '../themes'
import { helpSections } from './keys'
import { modalWidth } from './modal'
import { ModalPanel } from './Overlay'
import { useKeys } from './useKeys'

type Line =
  | { kind: 'header'; text: string }
  | { kind: 'key'; key: string; label: string }
  | { kind: 'gap' }

export function HelpOverlay() {
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.52, 58, 84)
  const lines = createMemo<Line[]>(() =>
    helpSections().flatMap((section, index) => [
      ...(index > 0 ? [{ kind: 'gap' } as const] : []),
      { kind: 'header', text: section.title } as const,
      ...section.rows.map(([key, label]) => ({ kind: 'key', key, label }) as const),
    ]),
  )
  const visible = () => Math.max(3, Math.min(lines().length, dimensions().height - 7))
  const [top, setTop] = createSignal(0)
  const overflowing = () => visible() < lines().length

  useKeys((key: KeyEvent) => {
    const step = key.name === 'up' ? -1 : key.name === 'down' ? 1 : 0
    if (step === 0) return
    key.preventDefault()
    setTop(at => Math.max(0, Math.min(lines().length - visible(), at + step)))
  })

  return (
    <ModalPanel zIndex={200} width={width()} title=" Keyboard shortcuts " padY={1}>
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
    </ModalPanel>
  )
}
