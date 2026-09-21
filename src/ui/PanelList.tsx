import { createMemo, For } from 'solid-js'
import type { JSX } from 'solid-js'

import { ui } from '../themes'
import { scrollbarOptions } from './list'
import type { createScrollList } from './list'

/**
 * The body every sidebar panel is built from: a scrollbox showing only the window
 * `createScrollList` picked, with spacers standing in for the rows either side so the
 * scrollable extent stays the whole list's.
 */
export function PanelList<T>(props: {
  list: ReturnType<typeof createScrollList>
  items: readonly T[]
  children: (row: T, index: () => number) => JSX.Element
}) {
  const start = () => props.list.window().start
  const visible = createMemo(() =>
    props.items.slice(start(), props.list.window().end)
  )
  return (
    <scrollbox
      ref={props.list.ref}
      flexGrow={1}
      backgroundColor={ui.sidebarBg}
      scrollbarOptions={scrollbarOptions()}
    >
      <box height={start()} flexShrink={0} backgroundColor={ui.sidebarBg} />
      <For each={visible()}>
        {(row, at) => props.children(row, () => start() + at())}
      </For>
      <box
        height={Math.max(0, props.items.length - props.list.window().end)}
        flexShrink={0}
        backgroundColor={ui.sidebarBg}
      />
    </scrollbox>
  )
}
