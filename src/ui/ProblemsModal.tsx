import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import type { Problem, ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'
import { useListKeys, windowAround } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { SEVERITY_COLOR, SEVERITY_GLYPH } from './severity'
import { cut, wrapText } from './text'

/** A problem with the path it belongs to already relativised for drawing. */
export interface ProblemEntry extends Problem {
  rel: string
}

export interface ProblemsModalProps {
  problems: ProblemEntry[]
  /** What this list is: every open file's problems, or the cursor's line alone. */
  title: string
  onPick: (problem: ProblemEntry) => void
  onCancel: () => void
}

/** Rows of the selected problem's whole message under the list. */
const DETAIL_LINES = 4

/** `eslint(import/no-cycle)` — whichever half the server sent. */
const origin = (problem: Problem): string =>
  problem.code ? `${problem.source ?? ''}(${problem.code})` : (problem.source ?? '')

const location = (problem: ProblemEntry) => `${problem.rel}:${problem.line + 1}:${problem.col + 1}`

/** One line of message, however the server spaced and wrapped it. */
const oneLine = (message: string) => message.replaceAll(/\s+/g, ' ').trim()

/**
 * Every open file's diagnostics, with the selected one spelled out in full.
 *
 * A server's message is routinely longer than a row — the rule it broke and the
 * fix it suggests both live in there — so the list carries as much of each as it
 * has columns for and the detail block under it carries the rest. Without that
 * the list is a column of sentences cut mid-word, which is what a diagnostic
 * that cannot be read is.
 */
export function ProblemsModal(props: ProblemsModalProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.7, 64, 120)
  /** The border, the heading, the detail block, the blanks and the key hints. */
  const visibleRows = () =>
    Math.min(listRows(dimensions().height, 12 + DETAIL_LINES, 24), props.problems.length)
  /** Columns inside the border, less the selection bar and the severity glyph. */
  const room = () => width() - PAD * 2 - 4

  const selected = () => Math.min(index(), Math.max(0, props.problems.length - 1))
  const current = () => props.problems[selected()]

  const counts = createMemo(() => {
    const tally: Record<ProblemSeverity, number> = { error: 0, warning: 0, info: 0, hint: 0 }
    for (const problem of props.problems) tally[problem.severity] += 1
    return tally
  })

  const heading = createMemo(() => {
    const tally = counts()
    const parts: string[] = []
    if (tally.error > 0) parts.push(`${tally.error} error${tally.error === 1 ? '' : 's'}`)
    if (tally.warning > 0) parts.push(`${tally.warning} warning${tally.warning === 1 ? '' : 's'}`)
    const rest = tally.info + tally.hint
    if (rest > 0) parts.push(`${rest} info`)
    return parts.join(' · ')
  })

  /**
   * One width for every location, so the messages start in the same column —
   * ragged ones read as unrelated lines rather than as a table. Bounded by
   * share rather than by content: a deeply nested path would otherwise leave
   * the message a few columns.
   */
  const locationWidth = createMemo(() => {
    const longest = props.problems.reduce((most, p) => Math.max(most, location(p).length), 0)
    return Math.min(longest, Math.floor(room() * 0.45))
  })

  const view = createMemo(() => windowAround(props.problems, selected(), visibleRows()))

  /**
   * Rows the detail block reserves: as tall as the wordiest message in the list,
   * capped. Fixed for as long as the list is up rather than sized to whatever is
   * selected, or the rows above it would jump on every ↑↓. Estimated from the
   * length instead of wrapping each message: a project's worth of diagnostics
   * would be wrapped on open for four rows of answer.
   */
  const detailRows = createMemo(() => {
    const longest = props.problems.reduce((most, p) => Math.max(most, oneLine(p.message).length), 0)
    return Math.max(1, Math.min(DETAIL_LINES, Math.ceil(longest / room())))
  })

  useListKeys({
    count: () => props.problems.length,
    move: setIndex,
    pick: () => {
      const problem = current()
      if (problem) props.onPick(problem)
    },
    close: () => props.onCancel(),
  })

  /** The whole message of the selected problem, cut to the rows the block has. */
  const detail = createMemo(() => {
    const problem = current()
    if (!problem) return []
    const rows = detailRows()
    const lines = wrapText(oneLine(problem.message), room())
    // The estimate can come in a row short of what wrapping needs; the last
    // visible row says so rather than dropping the tail silently.
    if (lines.length <= rows) return lines
    return [...lines.slice(0, rows - 1), cut(lines.slice(rows - 1).join(' '), room())]
  })

  return (
    <ModalPanel zIndex={160} width={width()} title={` ${props.title} `} accent={ui.dirty}>
      <text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={cut(heading(), room())} />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <box flexDirection="column" height={visibleRows()}>
        <For each={view().rows}>
          {(problem, i) => {
            const active = () => view().start + i() === selected()
            const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
            const note = () => cut(origin(problem), Math.floor(room() / 3))
            const place = () => cut(location(problem), locationWidth()).padEnd(locationWidth())
            const message = () =>
              cut(oneLine(problem.message), room() - locationWidth() - note().length - 2)
            /** The gap belongs to the note: at the widths where both sides are
                cut there is no slack left in the message's box to space them. */
            const noteText = () => (note() ? ` ${note()}` : '')
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text fg={ui.dirty} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
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
                <text wrapMode="none" fg={ui.faint} bg={bg()} flexShrink={0} content={noteText()} />
              </box>
            )
          }}
        </For>
      </box>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      {/* Fixed height: the block is as tall as its longest message whatever the
          selected one says, or the list below jumps a row on every ↑↓. */}
      <box flexDirection="column" height={detailRows()}>
        <For each={detail()}>
          {line => <text wrapMode="none" fg={ui.text} bg={ui.panelBg} content={line} />}
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
              room(),
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
          room(),
        )}
      />
    </ModalPanel>
  )
}
