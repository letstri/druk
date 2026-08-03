import { ui } from '../themes'

export interface TextInputProps {
  value: string
  placeholder?: string
  /** Default true — two inputs on one panel need exactly one of these. */
  focused?: boolean
  onInput: (value: string) => void
}

/**
 * Themed single-line input. Inputs render focused, and OpenTUI uses the
 * `focused*` colors then — setting only `textColor` leaves the text in the
 * renderable's default color, which is invisible on most themes.
 */
export function TextInput(props: TextInputProps) {
  return (
    <input
      focused={props.focused ?? true}
      value={props.value}
      placeholder={props.placeholder}
      backgroundColor={ui.solidBg}
      textColor={ui.text}
      focusedBackgroundColor={ui.solidBg}
      focusedTextColor={ui.text}
      cursorColor={ui.cursor}
      placeholderColor={ui.faint}
      onInput={props.onInput}
    />
  )
}
