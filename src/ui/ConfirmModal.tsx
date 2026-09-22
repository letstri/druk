import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { For } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { wrapText } from './text'
import { useKeys } from './useKeys'

interface ConfirmModalProps {
  message: string
  title: string
  verb: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal(props: ConfirmModalProps) {
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.5, 60, 84)
  const lines = () => wrapText(props.message, width() - PAD * 2)

  useKeys((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onConfirm()
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onCancel()
    }
  })

  const accent = () => (props.danger ? ui.error : ui.accent)

  return (
    // Above every panel: a confirm is raised over the search panel too.
    <ModalPanel
      zIndex={200}
      width={width()}
      title={` ${props.title} `}
      accent={accent()}
      onDismiss={props.onCancel}
    >
      <For each={lines()}>
        {(line) => <text fg={ui.text} bg={ui.panelBg} content={line} />}
      </For>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={`Enter to ${props.verb} · Esc to cancel`}
      />
    </ModalPanel>
  )
}
