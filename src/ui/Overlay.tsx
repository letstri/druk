import { RGBA } from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import type { JSX } from '@opentui/solid'
import { Show } from 'solid-js'

import { ui } from '../themes'
import { PAD } from './modal'

// Alpha-blended: over an unpainted cell (`transparent`) the composite comes out opaque black.
const SCRIM = RGBA.fromValues(0, 0, 0, 0.45)

const SHORT_TERMINAL = 28

export const topInset = (height: number) => (height >= SHORT_TERMINAL ? 3 : 0)

export function Overlay(props: {
  zIndex?: number
  align?: 'center' | 'top'
  side?: 'right'
  scrim?: boolean
  // Clicking the surface around the panel; the panel's own clicks target it, not this.
  onDismiss?: () => void
  children: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
  const dismiss = (event: MouseEvent) => {
    if (event.target === event.currentTarget) {
      props.onDismiss?.()
    }
  }
  // A side widget hangs from the top whatever the terminal's height: centred, it covers the code.
  const inset = () =>
    props.side
      ? Math.max(1, topInset(dimensions().height))
      : props.align === 'top'
        ? topInset(dimensions().height)
        : 0
  // A widget with no scrim hangs in its corner rather than from a full-screen box: that box
  // claims every cell it covers in the hit grid, so the editor under it would take no click.
  if (props.side === 'right' && props.scrim === false) {
    return (
      <box
        position="absolute"
        top={inset()}
        right={1}
        zIndex={props.zIndex ?? 100}
      >
        {props.children}
      </box>
    )
  }
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems={props.side === 'right' ? 'flex-end' : 'center'}
      justifyContent={inset() > 0 ? 'flex-start' : 'center'}
      paddingTop={inset()}
      paddingRight={props.side === 'right' ? 1 : 0}
      zIndex={props.zIndex ?? 100}
      onMouseDown={dismiss}
    >
      <Show when={ui.bg !== 'transparent' && props.scrim !== false}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          backgroundColor={SCRIM}
          onMouseDown={dismiss}
        />
      </Show>
      {props.children}
    </box>
  )
}

export function ModalPanel(props: {
  // Rendered into the border, so it carries its own spaces: `' Commit '`.
  title: string
  width: number
  accent?: string
  zIndex?: number
  align?: 'center' | 'top'
  side?: 'right'
  scrim?: boolean
  onDismiss?: () => void
  padY?: number
  children: JSX.Element
}) {
  return (
    <Overlay
      zIndex={props.zIndex}
      align={props.align}
      side={props.side}
      scrim={props.scrim}
      onDismiss={props.onDismiss}
    >
      <box
        width={props.width}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={props.accent ?? ui.accent}
        title={props.title}
        titleColor={props.accent ?? ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
        paddingTop={props.padY}
        paddingBottom={props.padY}
      >
        {props.children}
      </box>
    </Overlay>
  )
}
