import { basename, relative } from 'node:path'

import { TextAttributes } from '@opentui/core'
import { createMemo, For, Index, Show } from 'solid-js'

import { readFile } from '../core/fs'
import type { CallNode } from '../lsp/hierarchy'
import { ui } from '../themes'
import { createHighlighted, paintLine, sliceSpans } from './codeSpans'
import type { CodeSource, Span } from './codeSpans'
import { useHoverKey } from './hover'
import { windowAround } from './list'
import { cut } from './text'

interface CallPeekProps {
  rows: CallNode[]
  cursor: number
  title: string
  loading: boolean
  rootDir: string
  width: number
  height: number
  bufferOf: (path: string) => string | undefined
  onMoveTo: (row: number) => void
  onOpen: () => void
}

// The code needs room to read as code; the list only ever holds a name and a place.
const CODE_SHARE = 0.58
const MIN_LIST = 22

// Which way the call runs: into the symbol, or out of it.
const ARROW = { incoming: '←', outgoing: '→' }

export function CallPeek(props: CallPeekProps) {
  const rowHover = useHoverKey<number>()

  const selected = () => props.rows[props.cursor] ?? null

  const listWidth = () =>
    Math.max(
      MIN_LIST,
      props.width - 2 - Math.floor((props.width - 2) * CODE_SHARE)
    )
  const codeWidth = () => Math.max(0, props.width - 2 - listWidth() - 1)

  // Only the path is tracked, so walking two calls in one file does not re-read it.
  const path = createMemo(() => selected()?.target.path ?? null)

  const source = createMemo<CodeSource | null>(() => {
    const file = path()
    if (!file) {
      return null
    }
    const buffered = props.bufferOf(file)
    if (buffered !== undefined) {
      return { path: file, text: buffered }
    }
    try {
      return { path: file, text: readFile(file) }
    } catch {
      return null
    }
  })

  const parsed = createHighlighted(source)

  const body = () => Math.max(1, props.height - 2)

  // The call's line sits a third of the way down, so what follows it is what is on screen.
  const lines = createMemo(() => {
    const file = source()
    const node = selected()
    if (!file || !node) {
      return [] as { at: number; text: string }[]
    }
    const all = file.text.split('\n')
    const start = Math.max(
      0,
      Math.min(
        node.target.line - Math.floor(body() / 3),
        Math.max(0, all.length - body())
      )
    )
    return all
      .slice(start, start + body())
      .map((text, i) => ({ at: start + i, text }))
  })

  const gutter = () => String(lines().at(-1)?.at ?? 0).length + 1

  const codeSpans = (line: string, at: number): Span[] => {
    const hit = at === selected()?.target.line
    return sliceSpans(
      paintLine(parsed(), line, at, hit ? ui.text : ui.dim),
      0,
      Math.max(0, codeWidth() - gutter() - 1)
    )
  }

  const windowed = createMemo(() =>
    windowAround(props.rows, props.cursor, body(), 1)
  )

  const heading = () =>
    ` Calls · ${cut(props.title, Math.max(4, props.width - 12))} `

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.accent}
      title={heading()}
    >
      <box flexGrow={1} flexDirection="row" backgroundColor={ui.panelBg}>
        <box
          width={codeWidth()}
          flexShrink={0}
          flexDirection="column"
          backgroundColor={ui.panelBg}
        >
          <For each={lines()}>
            {(line) => {
              const hit = () => line.at === selected()?.target.line
              const bg = () => (hit() ? ui.treeFocusBg : ui.panelBg)
              return (
                <box height={1} flexDirection="row" backgroundColor={bg()}>
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    wrapMode="none"
                    content={`${String(line.at + 1).padStart(gutter())} `}
                  />
                  <Index each={codeSpans(line.text, line.at)}>
                    {(span) => (
                      <text
                        fg={span().fg}
                        bg={bg()}
                        attributes={span().attributes}
                        flexShrink={0}
                        wrapMode="none"
                        content={span().text}
                      />
                    )}
                  </Index>
                </box>
              )
            }}
          </For>
        </box>
        <box width={1} flexShrink={0} backgroundColor={ui.border} />
        <box
          flexGrow={1}
          flexDirection="column"
          backgroundColor={ui.panelBg}
          paddingLeft={1}
        >
          <Show
            when={props.rows.length > 0}
            fallback={
              <text
                fg={ui.faint}
                bg={ui.panelBg}
                wrapMode="none"
                content={
                  props.loading ? 'Asking the server…' : 'No calls here.'
                }
              />
            }
          >
            <For each={windowed().rows}>
              {(row, at) => {
                const index = () => windowed().start + at()
                const on = () => index() === props.cursor
                const bg = () =>
                  on()
                    ? ui.treeSelectedBg
                    : rowHover.hovered(index())
                      ? ui.hoverBg
                      : ui.panelBg
                // The symbol itself has no arrow: it is what the calls are about, not one of them.
                const lead = () =>
                  ` ${row.direction ? ARROW[row.direction] : '·'} `
                const where = () =>
                  `${basename(relative(props.rootDir, row.target.path))}:${row.target.line + 1}`
                const place = () =>
                  cut(where(), Math.max(0, listWidth() - lead().length - 4))
                const name = () =>
                  cut(
                    row.label,
                    Math.max(
                      1,
                      listWidth() - lead().length - place().length - 2
                    )
                  )
                return (
                  <box
                    height={1}
                    flexDirection="row"
                    backgroundColor={bg()}
                    onMouseDown={() => props.onMoveTo(index())}
                    onMouseOver={() => rowHover.enter(index())}
                    onMouseOut={() => rowHover.leave(index())}
                  >
                    <text
                      fg={ui.dim}
                      bg={bg()}
                      flexShrink={0}
                      wrapMode="none"
                      content={lead()}
                    />
                    <box flexGrow={1} backgroundColor={bg()}>
                      <text
                        fg={ui.text}
                        bg={bg()}
                        wrapMode="none"
                        attributes={on() ? TextAttributes.BOLD : undefined}
                        content={name()}
                      />
                    </box>
                    <text
                      fg={ui.faint}
                      bg={bg()}
                      flexShrink={0}
                      wrapMode="none"
                      content={`${place()} `}
                      onMouseDown={() => props.onOpen()}
                    />
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </box>
    </box>
  )
}
