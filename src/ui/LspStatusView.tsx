import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'

import type { ServerState, ServerView } from '../lsp/status'
import { ui } from '../themes'
import { useHover } from './hover'
import { useKeys } from './useKeys'

export interface LspStatusViewProps {
  servers: ServerView[]
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onRestart: () => void
  onUninstall: (id: string) => void
  onClose: () => void
}

const STATE_GLYPH: Record<ServerState, string> = {
  starting: '◌',
  ready: '●',
  stopped: '○',
  failed: '✗',
}

export function LspStatusView(props: LspStatusViewProps) {
  const dimensions = useTerminalDimensions()

  const [cursor, setCursor] = createSignal(0)
  // Clamped, not stored clamped: a server list that grows keeps the cursor put.
  const at = createMemo(() => Math.max(0, Math.min(cursor(), props.servers.length - 1)))
  const selected = createMemo(() => props.servers[at()] ?? null)

  let box: ScrollBoxRenderable | undefined

  const scroll = (delta: number) => {
    if (box) box.scrollTop = Math.max(0, box.scrollTop + delta)
  }
  const scrollTo = (row: number) => {
    if (box) box.scrollTop = Math.max(0, row)
  }

  createEffect(
    on(
      () => [selected()?.id, selected()?.logs.length] as const,
      () => scrollTo(Number.MAX_SAFE_INTEGER),
    ),
  )

  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    // A page, not a modal: keys count only while this pane holds the focus.
    if (props.blocked || !props.focused || key.defaultPrevented) return
    if (k === 'up' || k === 'k') setCursor(Math.max(0, at() - 1))
    else if (k === 'down' || k === 'j') setCursor(Math.min(props.servers.length - 1, at() + 1))
    else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page())
    else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'r') props.onRestart()
    else if (k === 'd') {
      const server = selected()
      if (server) props.onUninstall(server.id)
    } else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  const stateColor = (state: ServerState) =>
    state === 'ready' ? ui.gitAdded : state === 'failed' ? ui.error : ui.dim

  const stateLabel = (server: ServerView) =>
    server.error ? `${server.state} — ${server.error}` : server.state

  const hints = () => {
    const full = ' ↑↓ server · PgUp/PgDn log · r restart · d remove · Esc close '
    return full.length + 18 <= props.width ? full : ' Esc close '
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.solidBarBg}>
        <text fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content=" Language servers" />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>
      <Show
        when={props.servers.length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={2} paddingTop={1}>
            <text
              fg={ui.dim}
              content="No language servers yet — one starts when a file of its language opens."
            />
          </box>
        }
      >
        <box flexDirection="column" flexShrink={0} paddingTop={1} paddingBottom={1}>
          <For each={props.servers}>
            {(server, index) => {
              const hover = useHover()
              return (
                <box
                  flexDirection="row"
                  backgroundColor={
                    index() === at() ? ui.treeSelectedBg : hover.hovered() ? ui.hoverBg : undefined
                  }
                  onMouseDown={() => {
                    props.onFocus()
                    setCursor(index())
                  }}
                  onMouseOver={hover.enter}
                  onMouseOut={hover.leave}
                >
                  <text
                    fg={stateColor(server.state)}
                    flexShrink={0}
                    content={` ${index() === at() ? '▸' : ' '} ${STATE_GLYPH[server.state]} `}
                  />
                  <text
                    fg={ui.text}
                    flexShrink={0}
                    content={`${server.id} · ${stateLabel(server)}`}
                  />
                  {/* One row: a wrapped server command pushes the log down the page. */}
                  <text
                    wrapMode="none"
                    fg={ui.dim}
                    content={` · ${server.docs.length} open · ${server.command.join(' ')}`}
                  />
                </box>
              )
            }}
          </For>
        </box>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (box = el)}
          flexGrow={1}
          backgroundColor={ui.solidBg}
          paddingLeft={1}
          scrollbarOptions={{
            trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
          }}
        >
          <For each={selected()?.logs ?? []}>
            {line => (
              <box flexDirection="row">
                <text fg={ui.faint} flexShrink={0} content={`${line.time} `} />
                <text
                  fg={line.kind === 'event' ? ui.accent : line.kind === 'server' ? ui.text : ui.dim}
                  content={line.text}
                />
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}
