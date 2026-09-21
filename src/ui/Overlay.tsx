import { RGBA } from '@opentui/core'
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
  children: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
  const inset = () =>
    props.align === 'top' ? topInset(dimensions().height) : 0
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent={inset() > 0 ? 'flex-start' : 'center'}
      paddingTop={inset()}
      zIndex={props.zIndex ?? 100}
    >
      <Show when={ui.bg !== 'transparent'}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          backgroundColor={SCRIM}
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
  padY?: number
  children: JSX.Element
}) {
  return (
    <Overlay zIndex={props.zIndex} align={props.align}>
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
