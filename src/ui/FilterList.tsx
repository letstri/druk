import { For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { ui } from '../themes'
import { useHoverKey } from './hover'
import { windowAround } from './list'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'

/**
 * The shell every filterable modal list is built from — query field, fixed-height window
 * of rows, footer. Matching and keys stay with the caller: the palette filters on a trail
 * and walks into submenus, which no shared predicate could spell.
 */
export function FilterList<T>(props: {
  // Carries its own spaces, as `ModalPanel` renders it into the border.
  title: string
  placeholder: string
  footer: string
  empty?: string
  width: number
  rows: number
  align?: 'center' | 'top'
  items: readonly T[]
  selected: number
  query: string
  onQuery: (value: string) => void
  onPick: (index: number) => void
  onClose: () => void
  children: (item: T, active: () => boolean, bg: () => string) => JSX.Element
}) {
  const hover = useHoverKey<number>()
  const windowed = () => windowAround(props.items, props.selected, props.rows)
  return (
    <ModalPanel
      zIndex={150}
      align={props.align}
      onDismiss={props.onClose}
      width={props.width}
      title={props.title}
    >
      <TextInput
        value={props.query}
        placeholder={props.placeholder}
        onInput={props.onQuery}
      />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      {/* Fixed height: a list that shrinks per keystroke moves the input being typed in. */}
      <box flexDirection="column" height={props.rows}>
        <Show
          when={props.items.length > 0}
          fallback={
            <text
              fg={ui.dim}
              bg={ui.panelBg}
              content={props.empty ?? 'No matches'}
            />
          }
        >
          <For each={windowed().rows}>
            {(item, row) => {
              const at = () => windowed().start + row()
              const active = () => at() === props.selected
              const bg = () =>
                active()
                  ? ui.treeSelectedBg
                  : hover.hovered(at())
                    ? ui.hoverBg
                    : ui.panelBg
              return (
                <box
                  flexDirection="row"
                  backgroundColor={bg()}
                  onMouseDown={() => props.onPick(at())}
                  onMouseOver={() => hover.enter(at())}
                  onMouseOut={() => hover.leave(at())}
                >
                  <text
                    fg={ui.accent}
                    bg={bg()}
                    flexShrink={0}
                    content={active() ? '▌ ' : '  '}
                  />
                  {props.children(item, active, bg)}
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        wrapMode="none"
        content={props.footer}
      />
    </ModalPanel>
  )
}
