import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal } from 'solid-js'

import { stepHistory } from '../core/messageHistory'
import { ui } from '../themes'
import { modalWidth } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

interface PromptModalProps {
  title: string
  initialValue: string
  history?: string[]
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal(props: PromptModalProps) {
  const dimensions = useTerminalDimensions()
  const [value, setValue] = createSignal(props.initialValue)
  // -1: not walking history; `draft` then holds what was typed.
  const [at, setAt] = createSignal(-1)
  const [draft, setDraft] = createSignal('')

  const width = () => modalWidth(dimensions().width, 0.5, 60, 80)
  const history = () => props.history ?? []

  const walk = (delta: number) => {
    const step = stepHistory(history(), at(), delta, value(), draft())
    if (!step) {
      return
    }
    setAt(step.at)
    setDraft(step.draft)
    setValue(step.value)
  }

  // A recall sets the value, emitting `input` back: only a value the walk did not write is typing.
  const input = (next: string) => {
    setValue(next)
    const walked = at()
    if (walked >= 0 && next !== history()[walked]) {
      setAt(-1)
    }
  }

  useKeys((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onSubmit(value())
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onCancel()
    } else if (
      (key.name === 'up' || key.name === 'down') &&
      history().length > 0
    ) {
      key.preventDefault()
      walk(key.name === 'up' ? 1 : -1)
    }
  })

  return (
    <ModalPanel
      width={width()}
      title={` ${props.title} `}
      onDismiss={props.onCancel}
    >
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
