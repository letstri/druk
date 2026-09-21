import { For } from 'solid-js'

import { ui } from '../themes'
import { wrapText } from './text'

interface HoverPeekProps {
  lines: string[]
  width: number
  height: number
}

// Per source line, since `wrapText` treats a newline as any other space and a hover's
// shape — signature, blank row, `@deprecated …` — is what carries its meaning.
export function hoverLines(text: string, width: number): string[] {
  return text
    .split('\n')
    .flatMap((line) => (line.trim() ? wrapText(line.trim(), width) : ['']))
}

export function HoverPeek(props: HoverPeekProps) {
  const body = () => Math.max(1, props.height - 2)

  const shown = () => {
    if (props.lines.length <= body()) {
      return props.lines
    }
    const kept = props.lines.slice(0, body() - 1)
    return [...kept, `… ${props.lines.length - kept.length} more lines`]
  }

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      paddingLeft={1}
      paddingRight={1}
      border
      borderStyle="rounded"
      borderColor={ui.accent}
      title=" docs "
    >
      <For each={shown()}>
        {(line) => (
          <text fg={ui.text} bg={ui.panelBg} wrapMode="none" content={line} />
        )}
      </For>
    </box>
  )
}
