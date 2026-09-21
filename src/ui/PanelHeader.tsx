import type { MouseEvent } from '@opentui/core'
import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { ui } from '../themes'
import { cut } from './text'
import { useTooltip } from './tooltip'

interface PanelHeaderProps {
  title: string
  width: number
  focused: boolean
  children?: JSX.Element
}

/** A sidebar view's outer column. */
export function Panel(props: {
  width: number
  onFocus: () => void
  children: JSX.Element
}) {
  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.sidebarBg}
      flexShrink={0}
      flexGrow={1}
      // `flexBasis` must be 0: with `auto` the scrollbox grows past the screen and loses its scrollbar.
      flexBasis={0}
      onMouseDown={props.onFocus}
    >
      {props.children}
    </box>
  )
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

/** The `▴` that shuts every folder in a sidebar view; drawn only while something can fold. */
export function CollapseAll(props: {
  when: boolean
  onPress: () => void
  gap?: boolean
}) {
  const button = useTooltip('view.collapse')
  return (
    <Show when={props.when}>
      <box
        ref={button.ref}
        flexShrink={0}
        backgroundColor={button.lit() ? ui.hoverBg : ui.sidebarBg}
        onMouseDown={props.onPress}
        onMouseOver={button.enter}
        onMouseOut={button.leave}
      >
        <text
          fg={button.lit() ? ui.text : ui.dim}
          bg={button.lit() ? ui.hoverBg : ui.sidebarBg}
          content={props.gap ? '▴ ' : '▴'}
        />
      </box>
    </Show>
  )
}

/** An editor-slot page: the solid background, the title/hints bar, and the view under it. */
export function Page(props: {
  // Carries its own leading space, as the bar has no padding.
  title: string
  hints: string
  onFocus: () => void
  onWheel?: (event: MouseEvent) => void
  children: JSX.Element
}) {
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={props.onFocus}
      onMouseScroll={props.onWheel}
    >
      <box flexDirection="row" flexShrink={0} backgroundColor={ui.solidBarBg}>
        <text
          wrapMode="none"
          fg={ui.text}
          bg={ui.solidBarBg}
          flexShrink={0}
          content={props.title}
        />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={ui.solidBarBg}
          flexShrink={0}
          content={props.hints}
        />
      </box>
      {props.children}
    </box>
  )
}
