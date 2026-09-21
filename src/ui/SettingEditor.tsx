import type { KeyEvent } from '@opentui/core'
import { createSignal, For, Show } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { cut } from './text'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

interface SettingField {
  label?: string
  initial: string
  placeholder?: string
}

export interface SettingEdit {
  title: string
  fields: SettingField[]
  hint?: string[]
  apply: (values: string[]) => void
}

export function SettingEditor(props: {
  edit: SettingEdit
  paneWidth: number
  onDone: (values: string[] | null) => void
}) {
  const [values, setValues] = createSignal(
    props.edit.fields.map((field) => field.initial)
  )
  const [focus, setFocus] = createSignal(0)
  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  const count = () => props.edit.fields.length

  useKeys((key: KeyEvent) => {
    if (key.defaultPrevented) {
      return
    }
    const k = key.name
    if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onDone(values())
    } else if (k === 'escape') {
      key.preventDefault()
      props.onDone(null)
    } else if (count() > 1 && (k === 'tab' || k === 'up' || k === 'down')) {
      key.preventDefault()
      const dir = k === 'up' || (k === 'tab' && key.shift) ? -1 : 1
      setFocus((at) => (at + dir + count()) % count())
    }
  })

  const setField = (at: number, value: string) =>
    setValues((previous) => previous.map((old, i) => (i === at ? value : old)))

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.edit.title} `}>
      <For each={props.edit.fields}>
        {(field, at) => (
          <>
            <Show when={field.label}>
              <text
                fg={at() === focus() ? ui.text : ui.dim}
                bg={ui.panelBg}
                content={field.label!}
              />
            </Show>
            {/* Two focused inputs split the typing, so the unfocused field is plain text. */}
            <Show
              when={at() === focus()}
              fallback={
                <text
                  wrapMode="none"
                  fg={values()[at()] ? ui.dim : ui.faint}
                  bg={ui.panelBg}
                  content={cut(
                    values()[at()] || field.placeholder || '',
                    width() - PAD * 2
                  )}
                />
              }
            >
              <TextInput
                value={values()[at()]!}
                placeholder={field.placeholder}
                onInput={(value) => setField(at(), value)}
              />
            </Show>
          </>
        )}
      </For>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <For each={props.edit.hint ?? []}>
        {(line) => <text fg={ui.faint} bg={ui.panelBg} content={line} />}
      </For>
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          count() > 1
            ? 'Tab next field · Enter apply · Esc cancel'
            : 'Enter apply · Esc cancel'
        }
      />
    </ModalPanel>
  )
}
