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
}

export interface ListPickerProps {
  title: string
  placeholder: string
  items: PickerItem[]
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * A filterable list modal — the `BranchPicker` arrangement for anything that is
 * a list of named things: stashes, tags, remotes, a file's commits. The filter
 * is what makes it usable at fifty rows where `ChoiceModal` draws them all.
 */
export function ListPicker(props: ListPickerProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.62, 60, 100)
  const visibleRows = () => listRows(dimensions().height, 8, 18)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { item: PickerItem; score: number }[] = []
    for (const item of props.items) {
      const score = fuzzyScore(item.label, q)
      if (score !== null) scored.push({ item, score })
    }
    // Ties keep the caller's order — newest first everywhere this is used.
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
      <Show
        when={matches().length > 0}
        fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
      >
        <For each={matches()}>
          {(match, i) => {
            const active = () => i() === selected()
            const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                <box flexGrow={1} backgroundColor={bg()}>
                  <text
                    wrapMode="none"
                    fg={active() ? ui.text : ui.dim}
                    bg={bg()}
                    content={cut(match.item.label, width() - PAD * 2 - 2)}
                  />
                </box>
              </box>
            )
          }}
        </For>
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content="" />
      <text fg={ui.dim} bg={ui.panelBg} content="↑↓ choose · Enter confirm · Esc cancel" />
    </ModalPanel>
  )
}
