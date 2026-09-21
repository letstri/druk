import type { InputRenderable } from '@opentui/core'
import { onMount } from 'solid-js'

import { ui } from '../themes'
import { EDIT_KEYS } from './editKeys'

interface TextInputProps {
  value: string
  placeholder?: string
  focused?: boolean
  selectAllOnMount?: boolean
  onInput: (value: string) => void
}

// Inputs render focused: `textColor` alone leaves the text in the renderable's default, invisible.
export function TextInput(props: TextInputProps) {
  // oxlint-disable-next-line no-unassigned-vars -- Solid compiles `ref={input}` into an assignment.
  let input: InputRenderable | undefined

  // On mount, not on value change, or typing re-selects and swallows every keystroke.
  // `setSelection`, not `selectAll`: the latter comes back empty on a renderable this fresh.
  onMount(() => {
    if (props.selectAllOnMount && props.value) {
      input?.setSelection(0, props.value.length)
    }
  })

  return (
    <input
      ref={input}
      keyBindings={EDIT_KEYS}
      focused={props.focused ?? true}
      value={props.value}
      placeholder={props.placeholder}
      backgroundColor={ui.solidBg}
      textColor={ui.text}
      focusedBackgroundColor={ui.solidBg}
      focusedTextColor={ui.text}
      cursorColor={ui.cursor}
      placeholderColor={ui.faint}
      selectionBg={ui.treeSelectedBg}
      selectionFg={ui.text}
      onInput={props.onInput}
    />
  )
}
