import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { useHoverKey } from './hover'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'

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
  const hover = useHoverKey<number>()

  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  const visibleRows = () => listRows(dimensions().height, 8, 18)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { at: number; score: number }[] = []
    for (let at = 0; at < props.options.length; at++) {
      const score = fuzzyScore(props.options[at]!, q)
      if (score !== null) scored.push({ at, score })
    }
    return scored.toSorted((a, b) => a.score - b.score)
  })

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

  const windowStart = () => Math.max(0, selected() - visibleRows() + 1)

  useListKeys({
    count: () => matches().length,
    move: next => setIndex(next(selected())),
    pick: () => {
      const match = matches()[selected()]
      if (match) props.onPick(match.at)
    },
    close: () => props.onClose(),
    alsoClose: ['left'],
  })

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.title} `}>
      <TextInput
        value={query()}
        placeholder="Type to filter…"
        onInput={value => {
          setQuery(value)
          setIndex(0)
        }}
      />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <Show
        when={matches().length > 0}
        fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
      >
        <For each={matches().slice(windowStart(), windowStart() + visibleRows())}>
          {(match, i) => {
            const at = () => windowStart() + i()
            const active = () => at() === selected()
            const bg = () =>
              active() ? ui.treeSelectedBg : hover.hovered(at()) ? ui.hoverBg : ui.panelBg
            return (
              <box
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => props.onPick(match.at)}
                onMouseOver={() => hover.enter(at())}
                onMouseOut={() => hover.leave(at())}
              >
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                <text
                  fg={match.at === props.activeIndex ? ui.accent : active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={props.options[match.at]!.slice(0, width() - PAD * 2 - 2)}
                />
                <box flexGrow={1} backgroundColor={bg()} />
              </box>
            )
          }}
        </For>
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter pick · Esc back" />
    </ModalPanel>
  )
}
