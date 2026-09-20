import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Match, Switch } from 'solid-js'

import { ui } from '../themes'
import { keySectionsFor } from './keys'
import type { HelpSection, KeyScope } from './keys'
import { PAD } from './modal'
import { cut } from './text'

const GAP = 3
const KEY_GAP = 1
const INDENT = 1
const MIN_COL = 24
const MIN_LABEL = 8
const SQUEEZE = 1.08

const SCOPE_LABELS: Record<KeyScope, string> = {
  tree: 'file tree',
  editor: 'editor',
  git: 'source control',
  review: 'review',
  extensions: 'extensions',
}

type Line =
  | { kind: 'header'; text: string }
  | { kind: 'key'; key: string; label: string }
  | { kind: 'gap' }
  | { kind: 'more' }

const MORE = '… more (F1)'

const blockHeight = (section: HelpSection) => section.rows.length + 1

const columnHeight = (column: HelpSection[]) =>
  column.reduce((sum, section) => sum + blockHeight(section) + 1, -1)

function fill(sections: HelpSection[], limit: number): HelpSection[][] {
  const columns: HelpSection[][] = [[]]
  let used = 0
  for (const section of sections) {
    const current = columns.at(-1)!
    const cost = current.length > 0 ? blockHeight(section) + 1 : blockHeight(section)
    if (current.length > 0 && used + cost > limit) {
      columns.push([section])
      used = blockHeight(section)
      continue
    }
    current.push(section)
    used += cost
  }
  return columns
}

function pack(sections: HelpSection[], cols: number): HelpSection[][] {
  let low = Math.max(...sections.map(blockHeight))
  let high = columnHeight(sections)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (fill(sections, middle).length <= cols) high = middle
    else low = middle + 1
  }
  return fill(sections, low)
}

const naturalWidth = (column: HelpSection[]) =>
  Math.max(
    ...column.map(section => section.title.length),
    ...column.flatMap(section =>
      section.rows.map(([key, label]) => INDENT + key.length + KEY_GAP + label.length),
    ),
  ) + GAP

function shares(columns: HelpSection[][], inner: number): number[] {
  const naturals = columns.map(naturalWidth)
  const wanted = naturals.reduce((sum, width) => sum + width, 0)
  if (wanted > inner) return naturals.map(width => Math.floor((width * inner) / wanted))
  const extra = Math.floor((inner - wanted) / columns.length)
  return naturals.map(width => width + extra)
}

function measure(column: HelpSection[], width: number, rows: number) {
  const all = column.flatMap<Line>((section, index) => [
    ...(index > 0 ? [{ kind: 'gap' } as const] : []),
    { kind: 'header', text: section.title },
    ...section.rows.map(([key, label]) => ({ kind: 'key', key, label }) as const),
  ])
  const kept = all.slice(0, rows - 1)
  // A column cut after a heading's last key would end on a separating blank line.
  while (kept.at(-1)?.kind === 'gap') kept.pop()
  const lines: Line[] = all.length > rows ? [...kept, { kind: 'more' }] : all
  const room = width - GAP - INDENT - KEY_GAP
  const keyWidth = Math.min(
    Math.max(0, ...column.flatMap(section => section.rows.map(([key]) => key.length))),
    Math.max(1, room - MIN_LABEL),
  )
  return { lines, keyWidth, labelWidth: Math.max(MIN_LABEL, room - keyWidth) }
}

export function KeyPeek(props: { pane: KeyScope }) {
  const dimensions = useTerminalDimensions()

  const layout = createMemo(() => {
    const sections = keySectionsFor(props.pane)
    const inner = dimensions().width - 2 - PAD * 2
    const maxCols = Math.max(1, Math.min(sections.length, Math.floor(inner / MIN_COL)))

    let columns = pack(sections, 1)
    for (let cols = maxCols; cols > 1; cols--) {
      const candidate = pack(sections, cols)
      const wanted = candidate.map(naturalWidth).reduce((sum, width) => sum + width, 0)
      if (wanted <= inner * SQUEEZE) {
        columns = candidate
        break
      }
    }
    const maxRows = Math.max(1, dimensions().height - 6)
    for (
      let cols = columns.length + 1;
      cols <= maxCols && Math.max(...columns.map(columnHeight)) > maxRows;
      cols++
    ) {
      columns = pack(sections, cols)
    }

    const widths = shares(columns, inner)
    // No scroll: a panel that overran would push its own title off screen.
    const rows = Math.min(Math.max(...columns.map(columnHeight)), maxRows)
    return columns.map((column, at) => ({
      width: widths[at]!,
      ...measure(column, widths[at]!, rows),
    }))
  })

  const rows = () => Math.max(...layout().map(column => column.lines.length))

  return (
    <box
      position="absolute"
      left={0}
      top={dimensions().height - 3 - rows()}
      width="100%"
      flexDirection="row"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.accent}
      title={` Keys · ${SCOPE_LABELS[props.pane]} · any key closes `}
      titleColor={ui.text}
      paddingLeft={PAD}
      paddingRight={PAD}
      zIndex={90}
    >
      <For each={layout()}>
        {column => (
          <box width={column.width} flexShrink={0} flexDirection="column">
            <For each={column.lines}>
              {line => (
                <box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
                  <Switch>
                    <Match when={line.kind === 'header' && line}>
                      {(header: () => { text: string }) => (
                        <text
                          fg={ui.accent}
                          bg={ui.panelBg}
                          content={header().text}
                          attributes={TextAttributes.BOLD}
                        />
                      )}
                    </Match>
                    <Match when={line.kind === 'key' && line}>
                      {(row: () => { key: string; label: string }) => (
                        <>
                          <text
                            fg={ui.text}
                            bg={ui.panelBg}
                            content={
                              ' '.repeat(INDENT) +
                              cut(row().key, column.keyWidth).padEnd(column.keyWidth)
                            }
                          />
                          <text
                            fg={ui.dim}
                            bg={ui.panelBg}
                            content={' '.repeat(KEY_GAP) + cut(row().label, column.labelWidth)}
                          />
                        </>
                      )}
                    </Match>
                    <Match when={line.kind === 'more'}>
                      <text
                        fg={ui.dim}
                        bg={ui.panelBg}
                        content={` ${cut(MORE, column.width - GAP)}`}
                      />
                    </Match>
                  </Switch>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
