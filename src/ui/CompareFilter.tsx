import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'

import { ui } from '../themes'
import { modalWidth } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

interface CompareFilterProps {
  value: string
  onInput: (value: string) => void
  onClose: (clear: boolean) => void
}

export function CompareFilter(props: CompareFilterProps) {
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.55, 40, 80)

  useKeys((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onClose(false)
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onClose(true)
    }
  })

  return (
    <ModalPanel zIndex={160} width={width()} title=" Filter comparison ">
      <TextInput
        value={props.value}
        placeholder="Type a path, commit, author or hash…"
        onInput={props.onInput}
      />
      <text fg={ui.dim} bg={ui.panelBg} content="Enter keep · Esc clear" />
    </ModalPanel>
  )
}
