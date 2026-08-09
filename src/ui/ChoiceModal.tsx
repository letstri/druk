import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal, For } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { cut, wrapText } from './text'
import { useKeys } from './useKeys'

export interface Choice {
  id: string
  label: string
}

export interface ChoiceModalProps {
  title: string
  message: string
  choices: Choice[]
  onPick: (id: string) => void
  onCancel: () => void
}

export function ChoiceModal(props: ChoiceModalProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.54, 64, 88)
  const lines = () => wrapText(props.message, width() - PAD * 2)

  useKeys((key: KeyEvent) => {
    const k = key.name
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + props.choices.length) % props.choices.length)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % props.choices.length)
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onPick(props.choices[index()]!.id)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onCancel()
    }
  })

  return (
    <ModalPanel zIndex={160} width={width()} title={` ${props.title} `} accent={ui.dirty}>
      <For each={lines()}>{line => <text fg={ui.text} bg={ui.panelBg} content={line} />}</For>
      <text fg={ui.dim} bg={ui.panelBg} content="" />
      <For each={props.choices}>
        {(choice, i) => {
          const active = () => i() === index()
          const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
          return (
            <box flexDirection="row" backgroundColor={bg()}>
              <text fg={ui.dirty} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
              <box flexGrow={1} backgroundColor={bg()}>
                {/* One row each, whatever the label says: a choice carrying a path
                    or a server's own text wraps to three lines otherwise, and a
                    handful of those is a modal several screens tall. */}
                <text
                  wrapMode="none"
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={cut(choice.label, width() - PAD * 2 - 2)}
                />
              </box>
            </box>
          )
        }}
      </For>
      <text fg={ui.dim} bg={ui.panelBg} content="" />
      <text fg={ui.dim} bg={ui.panelBg} content="↑↓ choose · Enter confirm · Esc cancel" />
    </ModalPanel>
  )
}
