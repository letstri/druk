import type { JSX } from 'solid-js'

import { ui } from '../themes'
import { cut } from './text'

export interface PanelHeaderProps {
  title: string
  width: number
  focused: boolean
  children?: JSX.Element
}

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      backgroundColor={ui.sidebarBg}
      paddingLeft={2}
      paddingRight={1}
    >
      <text
        fg={props.focused ? ui.dim : ui.faint}
        bg={ui.sidebarBg}
        flexShrink={1}
        wrapMode="none"
        content={cut(props.title.toUpperCase(), Math.max(1, props.width - 4))}
      />
      <box flexGrow={1} backgroundColor={ui.sidebarBg} />
      {props.children}
    </box>
  )
}
