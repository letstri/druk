import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { cut } from './text'
import { TextInput } from './TextInput'

export interface PickerItem {
  id: string
  label: string
  note?: string
  current?: boolean
}

export interface ListPickerProps {
  title: string
  placeholder: string
  items: PickerItem[]
  onPick: (id: string) => void
  onClose: () => void
}

export function ListPicker(props: ListPickerProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.62, 60, 100)
  const visibleRows = () => listRows(dimensions().height, 8, 18)
  const marked = createMemo(() => props.items.some(item => item.current))

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { item: PickerItem; score: number }[] = []
    for (const item of props.items) {
      const score = fuzzyScore(item.label, q)
      if (score !== null) scored.push({ item, score })
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  useListKeys({
    count: () => matches().length,
    move: setIndex,
    pick: () => {
      const match = matches()[selected()]
      if (match) props.onPick(match.item.id)
    },
    close: () => props.onClose(),
  })

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.title} — ${props.items.length} `}>
      <TextInput
        value={query()}
        placeholder={props.placeholder}
        onInput={value => {
          setQuery(value)
          setIndex(0)
        }}
      />
      <text fg={ui.dim} bg={ui.panelBg} content="" />
      {/* Fixed height: a list that shrinks per keystroke moves the input being typed in. */}
      <box flexDirection="column" height={visibleRows()}>
        <Show
          when={matches().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
        >
          <For each={matches()}>
            {(match, i) => {
              const item = match.item
              const active = () => i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              const room = () => width() - PAD * 2 - 2 - (marked() ? 2 : 0)
              // The note must be cut too, or the label's flexible box goes a column wide and wraps.
              const note = () => cut(item.note ?? '', Math.floor(room() / 3))
              const label = () => cut(item.label, room() - note().length - 1)
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <Show when={marked()}>
                    <text
                      fg={ui.accent}
                      bg={bg()}
                      flexShrink={0}
                      content={item.current ? '* ' : '  '}
                    />
                  </Show>
                  <box flexGrow={1} backgroundColor={bg()}>
                    <text
                      wrapMode="none"
                      fg={active() ? ui.text : ui.dim}
                      bg={bg()}
                      content={label()}
                    />
                  </box>
                  <text
                    wrapMode="none"
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    content={note() ? ` ${note()}` : ''}
                  />
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <text fg={ui.dim} bg={ui.panelBg} content="↑↓ choose · Enter confirm · Esc cancel" />
    </ModalPanel>
  )
}
