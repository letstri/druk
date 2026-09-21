import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { FilterList } from './FilterList'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { cut } from './text'

export interface PickerItem {
  id: string
  label: string
  note?: string
  current?: boolean
}

interface ListPickerProps {
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
  const marked = createMemo(() => props.items.some((item) => item.current))

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { item: PickerItem; score: number }[] = []
    for (const item of props.items) {
      const score = fuzzyScore(item.label, q)
      if (score !== null) {
        scored.push({ item, score })
      }
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  const open = (row: number) => {
    const match = matches()[row]
    if (match) {
      props.onPick(match.item.id)
    }
  }

  useListKeys({
    close: () => props.onClose(),
    count: () => matches().length,
    move: setIndex,
    pick: () => open(selected()),
  })

  return (
    <FilterList
      title={` ${props.title} — ${props.items.length} `}
      placeholder={props.placeholder}
      footer="↑↓ choose · Enter confirm · Esc cancel"
      width={width()}
      rows={visibleRows()}
      items={matches()}
      selected={selected()}
      query={query()}
      onQuery={(value) => {
        setQuery(value)
        setIndex(0)
      }}
      onPick={open}
    >
      {(match, active, bg) => {
        const { item } = match
        const room = () => width() - PAD * 2 - 2 - (marked() ? 2 : 0)
        // The note must be cut too, or the label's flexible box goes a column wide and wraps.
        const note = () => cut(item.note ?? '', Math.floor(room() / 3))
        const label = () => cut(item.label, room() - note().length - 1)
        return (
          <>
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
          </>
        )
      }}
    </FilterList>
  )
}
