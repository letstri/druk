import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import { ui } from '../themes'
import { welcomeKeys } from './keys'

const CHROME_ROWS = 8

export interface WelcomeProps {
  rootName: string
  branch: string | null
  version: string
}

export function Welcome(props: WelcomeProps) {
  const dimensions = useTerminalDimensions()
  const rows = createMemo(() => {
    const all = welcomeKeys()
    const room = Math.max(0, dimensions().height - CHROME_ROWS)
    const width = Math.max(...all.map(([key]) => key.length))
    return all.slice(0, room).map(([key, label]) => [key.padEnd(width), label] as const)
  })

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={ui.bg}
      alignItems="center"
      justifyContent="center"
    >
      {/* One block centred as a whole, and capped: a long branch name would widen it past the pane. */}
      <box flexDirection="column" backgroundColor={ui.bg} alignItems="flex-start" maxWidth="100%">
        <text
          fg={ui.accent}
          bg={ui.bg}
          content={`druk v${props.version}`}
          attributes={TextAttributes.BOLD}
        />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={ui.bg}
          content={props.branch ? `${props.rootName} · ${props.branch}` : props.rootName}
        />
        <Show when={rows().length > 0}>
          <text fg={ui.faint} bg={ui.bg} content="" />
          <For each={rows()}>
            {([key, label]) => (
              <box flexDirection="row" backgroundColor={ui.bg}>
                <text fg={ui.dim} bg={ui.bg} content={`${key}  `} />
                <text fg={ui.faint} bg={ui.bg} content={label} />
              </box>
            )}
          </For>
        </Show>
      </box>
    </box>
  )
}
