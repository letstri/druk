import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal } from 'solid-js'

import { stepHistory } from '../core/messageHistory'
import { ui } from '../themes'
import { modalWidth } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export interface PromptModalProps {
  title: string
  initialValue: string
  /** Past answers ↑ walks back through, newest first — commit subjects, so far. */
  history?: string[]
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal(props: PromptModalProps) {
  const dimensions = useTerminalDimensions()
  const [value, setValue] = createSignal(props.initialValue)
  /** How far back ↑ has walked; -1 is the draft `draft` holds. */
  const [at, setAt] = createSignal(-1)
  const [draft, setDraft] = createSignal('')

  const width = () => modalWidth(dimensions().width, 0.5, 60, 80)
  const history = () => props.history ?? []

  const walk = (delta: number) => {
    const step = stepHistory(history(), at(), delta, value(), draft())
    if (!step) return
    setAt(step.at)
    setDraft(step.draft)
    setValue(step.value)
  }

  /** A recall sets the input's value, which emits `input` back: only a value
   * that is not what the walk wrote is typing, and typing ends the walk. */
  const input = (next: string) => {
    setValue(next)
    const walked = at()
    if (walked >= 0 && next !== history()[walked]) setAt(-1)
  }

  useKeys((key: KeyEvent) => {
    // Solid applies focus synchronously; without this the submitting key also
    // reaches whatever the modal focuses next.
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onSubmit(value())
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onCancel()
    } else if ((key.name === 'up' || key.name === 'down') && history().length > 0) {
      key.preventDefault()
      walk(key.name === 'up' ? 1 : -1)
    }
  })

  return (
    <ModalPanel width={width()} title={` ${props.title} `}>
      <TextInput value={value()} onInput={input} />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={`Enter to confirm · Esc to cancel${history().length > 0 ? ' · ↑↓ history' : ''}`}
      />
    </ModalPanel>
  )
}
