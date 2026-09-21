import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { FilterList } from './FilterList'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'

export function SettingPicker(props: {
  title: string
  options: string[]
  activeIndex: number
  paneWidth: number
  onPick: (index: number) => void
  onClose: () => void
  onPreview?: (index: number) => void
  onRestore?: () => void
}) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(Math.max(0, props.activeIndex))

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { at: number; score: number }[] = []
    for (let at = 0; at < props.options.length; at += 1) {
      const score = fuzzyScore(props.options[at]!, q)
      if (score !== null) {
        scored.push({ at, score })
      }
    }
    return scored.toSorted((a, b) => a.score - b.score)
  })

  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  // Fitted, unlike the other pickers: this one opens over a pane, and a two-value
  // setting in an eighteen-row box is a box of nothing.
  const visibleRows = () =>
    Math.max(
      1,
      Math.min(listRows(dimensions().height, 8, 18), matches().length)
    )

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  let lastPreviewed: number | undefined
  createEffect(() => {
    const match = matches()[selected()]
    if (match && props.onPreview && match.at !== lastPreviewed) {
      lastPreviewed = match.at
      props.onPreview(match.at)
    }
  })

  // On cleanup, not on Escape: `onPick` closes the list before applying, so the restore lands first.
  onCleanup(() => props.onRestore?.())

  const pick = (row: number) => {
    const match = matches()[row]
    if (match) {
      props.onPick(match.at)
    }
  }

  useListKeys({
    alsoClose: ['left'],
    close: () => props.onClose(),
    count: () => matches().length,
    move: (next) => setIndex(next(selected())),
    pick: () => pick(selected()),
  })

  return (
    <FilterList
      title={` ${props.title} `}
      placeholder="Type to filter…"
      footer="↑↓ move · Enter pick · Esc back"
      width={width()}
      rows={visibleRows()}
      items={matches()}
      selected={selected()}
      query={query()}
      onQuery={(value) => {
        setQuery(value)
        setIndex(0)
      }}
      onPick={pick}
    >
      {(match, active, bg) => (
        <>
          <text
            fg={
              match.at === props.activeIndex
                ? ui.accent
                : active()
                  ? ui.text
                  : ui.dim
            }
            bg={bg()}
            content={props.options[match.at]!.slice(0, width() - PAD * 2 - 2)}
          />
          <box flexGrow={1} backgroundColor={bg()} />
        </>
      )}
    </FilterList>
  )
}
