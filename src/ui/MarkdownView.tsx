import type { KeyEvent, ScrollBoxRenderable, TreeSitterClient } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onMount } from 'solid-js'

import { getSyntaxStyle, highlightClient } from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { mermaidRenderer } from './mermaidBlock'
import { useKeys } from './useKeys'

export interface MarkdownViewProps {
  path: string
  name: string
  content: string
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onShowSource: () => void
}

export function MarkdownView(props: MarkdownViewProps) {
  const dimensions = useTerminalDimensions()

  // The renderable's default client would be a second, empty one with no vendored grammars.
  const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined)
  onMount(() => void highlightClient().then(c => setClient(c)))

  let box: ScrollBoxRenderable | undefined

  // Keyed on the painted theme: the style table is rebuilt when the palette changes.
  const style = createMemo(
    on(
      () => paintedTheme(),
      () => getSyntaxStyle(),
    ),
  )

  // A diagram's colours are baked into its cells, so a palette change needs a new renderer.
  const renderer = useRenderer()
  const renderNode = createMemo(
    on(
      () => paintedTheme(),
      () => mermaidRenderer(renderer, ui),
    ),
  )

  const scroll = (delta: number) => {
    if (box) box.scrollTop = Math.max(0, box.scrollTop + delta)
  }
  const scrollTo = (row: number) => {
    if (box) box.scrollTop = Math.max(0, row)
  }

  // Keyed on the path: the content changes on every keystroke, and a scroll reset would jump.
  createEffect(
    on(
      () => props.path,
      () => scrollTo(0),
      { defer: true },
    ),
  )

  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    // A page, not a modal: keys count only while this pane holds the focus.
    if (props.blocked || !props.focused || key.defaultPrevented) return
    if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page())
    else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'escape' || k === 'tab' || k === 'e' || k === 'q') props.onShowSource()
    else return
    key.preventDefault()
  })

  const hints = () => {
    const full = ' rendered · Tab source · ↑↓ scroll '
    return full.length + props.name.length + 4 <= props.width ? full : ' Tab source '
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.solidBarBg}>
        <text fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content={` ${props.name}`} />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>
      <scrollbox
        ref={(el: ScrollBoxRenderable) => (box = el)}
        flexGrow={1}
        backgroundColor={ui.solidBg}
        paddingLeft={2}
        paddingRight={2}
        scrollbarOptions={{
          trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
        }}
      >
        <markdown
          content={props.content}
          syntaxStyle={style()}
          renderNode={renderNode()}
          treeSitterClient={client() ?? undefined}
          fg={ui.text}
          bg={ui.solidBg}
        />
      </scrollbox>
    </box>
  )
}
