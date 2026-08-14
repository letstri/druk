import type { KeyEvent, ScrollBoxRenderable, TreeSitterClient } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onMount } from 'solid-js'

import { getSyntaxStyle, highlightClient } from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { mermaidRenderer } from './mermaidBlock'
import { useKeys } from './useKeys'

export interface MarkdownViewProps {
  /** The tab being read, so a switch can put the scroll back at the top. */
  path: string
  name: string
  /**
   * The buffer's text rather than the file's: an unsaved edit is part of the
   * document being read, and re-reading the disk would show it without them.
   */
  content: string
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  /** Back to the editor's own text — the same command that got here. */
  onShowSource: () => void
}

/**
 * The rendered half of a markdown tab: headings, lists, tables, links and
 * syntax-lit code blocks, from OpenTUI's own markdown renderable. It is a layer
 * over the editor slot rather than a tab of its own — the source is always one
 * key away, and both halves are the same open buffer.
 */
export function MarkdownView(props: MarkdownViewProps) {
  const dimensions = useTerminalDimensions()

  /**
   * Fenced code blocks are highlighted by the client druk vendored its grammars
   * into. Letting the renderable default would spin up a second, empty one — the
   * same reason the diff pane waits for this.
   */
  const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined)
  onMount(() => void highlightClient().then(c => setClient(c)))

  let box: ScrollBoxRenderable | undefined

  // Keyed on the painted theme (including a live preview): the style table is
  // rebuilt when the palette changes, and the renderable has to be handed the
  // new one to repaint its code blocks.
  const style = createMemo(
    on(
      () => paintedTheme(),
      () => getSyntaxStyle(),
    ),
  )

  // Keyed on the painted theme like the syntax style beside it: the diagram's
  // colours are baked into its cells when it is built, so a palette change has
  // to hand the renderable a new renderer rather than repaint the old one.
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

  // Keyed on the path: the content changes on every keystroke in the source, and
  // resetting the scroll then would throw the reader back to the top mid-read.
  createEffect(
    on(
      () => props.path,
      () => scrollTo(0),
      { defer: true },
    ),
  )

  /** Rows a page spans — the pane is the editor slot: tabs, header, status bar off. */
  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse.
    if (props.blocked || !props.focused || key.defaultPrevented) return
    if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page())
    else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    // Esc and Tab both go back to the text, as they do on the diff page — Esc
    // because it is what closes a page, Tab because it is the toggle's own key.
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
