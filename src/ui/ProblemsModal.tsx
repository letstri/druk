import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import { plural } from '../core/text'
import { relatedNotes } from '../lsp/protocol'
import type { Problem, ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'
import { useHoverKey } from './hover'
import { useListKeys, windowAround } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { SEVERITY_COLOR, SEVERITY_GLYPH } from './severity'
import { cut, wrapText } from './text'

export interface ProblemEntry extends Problem {
  rel: string
}

interface ProblemsModalProps {
  problems: ProblemEntry[]
  title: string
  onPick: (problem: ProblemEntry) => void
  onCancel: () => void
}

const DETAIL_LINES = 10

const origin = (problem: Problem): string =>
  problem.code
    ? `${problem.source ?? ''}(${problem.code})`
    : (problem.source ?? '')

const location = (problem: ProblemEntry) =>
  `${problem.rel}:${problem.line + 1}:${problem.col + 1}`

const oneLine = (message: string) => message.replaceAll(/\s+/gu, ' ').trim()

// The detail block is one paragraph, so the notes ride in it rather than on rows of their own.
const spelled = (problem: Problem): string =>
  [oneLine(problem.message), ...relatedNotes(problem)].join(' ')

export function ProblemsModal(props: ProblemsModalProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)
  const hover = useHoverKey<number>()

  const width = () => modalWidth(dimensions().width, 0.7, 64, 120)
  const room = () => width() - PAD * 2 - 4
  // As tall as the wordiest message and fixed while the list is up, or the rows above jump on ↑↓.
  const detailRows = createMemo(() => {
    const longest = Math.max(0, ...props.problems.map((p) => spelled(p).length))
    const spare = Math.max(1, dimensions().height - 18)
    return Math.max(
      1,
      Math.min(DETAIL_LINES, spare, Math.ceil(longest / room()))
    )
  })

  const visibleRows = () =>
    Math.min(
      listRows(dimensions().height, 12 + detailRows(), 24),
      props.problems.length
    )

  const selected = () =>
    Math.min(index(), Math.max(0, props.problems.length - 1))
  const current = () => props.problems[selected()]

  const counts = createMemo(() => {
    const tally: Record<ProblemSeverity, number> = {
      error: 0,
      hint: 0,
      info: 0,
      warning: 0,
    }
    for (const problem of props.problems) {
      tally[problem.severity] += 1
    }
    return tally
  })

  const heading = createMemo(() => {
    const tally = counts()
    const parts: string[] = []
    if (tally.error > 0) {
      parts.push(plural(tally.error, 'error'))
    }
    if (tally.warning > 0) {
      parts.push(plural(tally.warning, 'warning'))
    }
    const rest = tally.info + tally.hint
    if (rest > 0) {
      parts.push(`${rest} info`)
    }
    return parts.join(' · ')
  })

  // One width for every location, bounded so a deeply nested path still leaves message room.
  const locationWidth = createMemo(() => {
    const longest = Math.max(
      0,
      ...props.problems.map((p) => location(p).length)
    )
    return Math.min(longest, Math.floor(room() * 0.45))
  })

  const view = createMemo(() =>
    windowAround(props.problems, selected(), visibleRows())
  )

  useListKeys({
    close: () => props.onCancel(),
    count: () => props.problems.length,
    move: setIndex,
    pick: () => {
      const problem = current()
      if (problem) {
        props.onPick(problem)
      }
    },
  })

  const detail = createMemo(() => {
    const problem = current()
    if (!problem) {
      return []
    }
    const rows = detailRows()
    const lines = wrapText(spelled(problem), room())
    // The estimate can come a row short of what wrapping needs; the last row carries the rest.
    if (lines.length <= rows) {
      return lines
    }
    return [
      ...lines.slice(0, rows - 1),
      cut(lines.slice(rows - 1).join(' '), room()),
    ]
  })

  return (
    <ModalPanel
      zIndex={160}
      width={width()}
      title={` ${props.title} `}
      accent={ui.dirty}
      onDismiss={props.onCancel}
    >
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        wrapMode="none"
        content={cut(heading(), room())}
      />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <box flexDirection="column" height={visibleRows()}>
        <For each={view().rows}>
          {(problem, i) => {
            const at = () => view().start + i()
            const active = () => at() === selected()
            const bg = () =>
              active()
                ? ui.treeSelectedBg
                : hover.hovered(at())
                  ? ui.hoverBg
                  : ui.panelBg
            const note = () => cut(origin(problem), Math.floor(room() / 3))
            const place = () =>
              cut(location(problem), locationWidth()).padEnd(locationWidth())
            const message = () =>
              cut(
                oneLine(problem.message),
                room() - locationWidth() - note().length - 2
              )
            // The gap is the note's: where both sides are cut there is no slack to space them.
            const noteText = () => (note() ? ` ${note()}` : '')
            return (
              <box
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => props.onPick(problem)}
                onMouseOver={() => hover.enter(at())}
                onMouseOut={() => hover.leave(at())}
              >
                <text
                  fg={ui.dirty}
                  bg={bg()}
                  flexShrink={0}
                  content={active() ? '▌ ' : '  '}
                />
                <text
                  fg={SEVERITY_COLOR[problem.severity]()}
                  bg={bg()}
                  flexShrink={0}
                  content={`${SEVERITY_GLYPH[problem.severity]} `}
                />
                <text
                  wrapMode="none"
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  flexShrink={0}
                  content={place()}
                />
                <box flexGrow={1} backgroundColor={bg()}>
                  <text
                    wrapMode="none"
                    fg={active() ? ui.text : ui.dim}
                    bg={bg()}
                    content={` ${message()}`}
                  />
                </box>
                <text
                  wrapMode="none"
                  fg={ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={noteText()}
                />
              </box>
            )
          }}
        </For>
      </box>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <box flexDirection="column" height={detailRows()}>
        <For each={detail()}>
          {(line) => (
            <text wrapMode="none" fg={ui.text} bg={ui.panelBg} content={line} />
          )}
        </For>
      </box>
      <Show when={current()}>
        {(problem: () => ProblemEntry) => (
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={ui.panelBg}
            content={cut(
              [problem().severity, location(problem()), origin(problem())]
                .filter(Boolean)
                .join(' · '),
              room()
            )}
          />
        )}
      </Show>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        wrapMode="none"
        content={cut(
          `${selected() + 1}/${props.problems.length} · ↑↓ move · Enter jumps to the diagnostic · Esc close`,
          room()
        )}
      />
    </ModalPanel>
  )
}
