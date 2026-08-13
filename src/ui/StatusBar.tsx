import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { MODE_LABELS } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { ui } from '../themes'
import { useHover } from './hover'
import type { Hint } from './keys'
import { hintsFor } from './keys'
import { SEVERITY_GLYPH } from './severity'
import { cut } from './text'

export type Tone = 'info' | 'warn' | 'error'

export interface StatusBarProps {
  message: string
  tone: Tone
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
  vimMode: VimMode | null
  /** Repository the branch belongs to, when the folder holds more than one. */
  repo: string | null
  branch: string | null
  /** Commits the branch is ahead of / behind its upstream. */
  ahead: number
  behind: number
  /** Files differing from HEAD in the working tree. */
  changed: number
  /** LSP diagnostics in the active file; hidden while both counts are zero. */
  problems?: { errors: number; warnings: number }
  focus: 'tree' | 'editor'
  /** A long file operation in flight; replaces the message while it runs. */
  busy: { label: string; done: number; total: number } | null
  /** What each group does when it is clicked — VS Code's status bar, where the
   * branch is the branch switcher and the counts are the commands behind them. */
  onBranch: () => void
  onSync: () => void
  onChanges: () => void
  onProblems: () => void
  onSave: () => void
  onGotoLine: () => void
  /** A footer hint clicked: run the command its key advertises. */
  onHint: (id: string) => void
}

/** One frame per tick, so a stalled spinner is visibly stalled. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// `dirty` is the palette's amber, already meaning "needs attention, nothing broke".
const TONE_COLORS: Record<Tone, () => string> = {
  info: () => ui.dim,
  warn: () => ui.dirty,
  error: () => ui.error,
}

const SEPARATOR = '  '

/**
 * One group of the bar: its text, its padding, and — where it stands for a
 * command — the click that runs it. The padding belongs to the box so the tint
 * covers the whole target rather than the glyphs alone, and the widths the
 * layout below is computed from count it.
 */
function Group(props: {
  text: string
  fg: string
  padLeft?: number
  padRight?: number
  attributes?: number
  onClick?: () => void
}) {
  const hover = useHover()
  const bg = () => (props.onClick && hover.hovered() ? ui.hoverBg : ui.barBg)
  return (
    <box
      paddingLeft={props.padLeft ?? 0}
      paddingRight={props.padRight ?? 0}
      flexShrink={0}
      backgroundColor={bg()}
      onMouseDown={props.onClick}
      onMouseOver={hover.enter}
      onMouseOut={hover.leave}
    >
      <text fg={props.fg} bg={bg()} content={props.text} attributes={props.attributes} />
    </box>
  )
}

export function StatusBar(props: StatusBarProps) {
  const dimensions = useTerminalDimensions()

  const [frame, setFrame] = createSignal(0)
  /**
   * Whether to spin at all — a boolean, so the effect below sees one change per
   * operation. Tracking `props.busy` itself re-ran it on every progress tick,
   * which cleared and restarted the interval faster than it could ever fire:
   * the spinner sat on its first frame for the whole run.
   */
  const spinning = createMemo(() => props.busy !== null)

  // Only ticking while there is something to spin: an idle editor should not
  // wake up ten times a second to redraw a character.
  createEffect(() => {
    if (!spinning()) return
    const timer = setInterval(() => setFrame(at => (at + 1) % SPINNER.length), 100)
    onCleanup(() => clearInterval(timer))
  })

  const busyText = () => {
    const busy = props.busy
    if (!busy) return ''
    const count = busy.total > 0 ? ` ${busy.done}/${busy.total}` : ` ${busy.done}`
    return `${SPINNER[frame()]} ${busy.label}${count}`
  }

  /**
   * The branch is the one group here made of somebody's own words, and its box
   * cannot shrink: a branch named after a whole issue title filled the bar on
   * its own and pushed the message, the hints and the cursor off the right edge.
   * A quarter of the row, so a wide terminal still shows most names whole.
   */
  const branchText = () => {
    if (!props.branch) return ''
    // `repo/branch` where several are open: "main" on its own would be whichever
    // of them the editor happens to be in, with nothing saying which.
    const label = `${props.repo ? `${props.repo}/` : ''}${props.branch}`
    return cut(label, Math.max(12, Math.round(dimensions().width * 0.25)))
  }

  const syncText = () => {
    const parts: string[] = []
    if (props.ahead > 0) parts.push(`↑${props.ahead}`)
    if (props.behind > 0) parts.push(`↓${props.behind}`)
    return parts.join(' ')
  }

  const changedText = () => (props.changed > 0 ? `~${props.changed}` : '')

  /**
   * The git group as one string. It is drawn as three click targets — branch,
   * sync counts, changed count — whose paddings stand in for the spaces here,
   * so this stays what the whole group costs the row.
   */
  const gitText = () => {
    if (!props.branch) return ''
    return [`⎇ ${branchText()}`, syncText(), changedText()].filter(Boolean).join(' ')
  }

  const cursorText = () =>
    props.cursor ? `Ln ${props.cursor.line + 1}, Col ${props.cursor.col + 1}` : ''

  const problemsText = () => {
    const problems = props.problems
    if (!problems) return ''
    const parts: string[] = []
    if (problems.errors > 0) parts.push(`${SEVERITY_GLYPH.error} ${problems.errors}`)
    if (problems.warnings > 0) parts.push(`${SEVERITY_GLYPH.warning} ${problems.warnings}`)
    return parts.join(' ')
  }

  /** A group's columns: its text plus the two of padding every group carries. */
  const groupWidth = (text: string) => (text ? text.length + 2 : 0)

  /** Everything that never gives way — the vim badge, git, and the right-hand groups. */
  const fixedWidth = createMemo(
    () =>
      groupWidth(props.vimMode ? MODE_LABELS[props.vimMode] : '') +
      groupWidth(gitText()) +
      groupWidth(props.dirty ? '● unsaved' : '') +
      groupWidth(problemsText()) +
      groupWidth(cursorText()) +
      groupWidth(props.filetype ?? ''),
  )

  /**
   * The message, cut to the room the fixed groups leave. Its box cannot shrink, so a
   * long one — a filesystem error is reported verbatim — would push `unsaved`, the
   * cursor and the filetype off the right edge rather than being clipped itself.
   * Whitespace collapses for the same reason: the bar is one row, and a stray
   * newline in a message from anywhere would break it.
   */
  const messageText = createMemo(() => {
    // A running operation owns this slot: its progress is the only thing worth
    // reading while it runs, and it ends with a message of its own.
    const flat = (busyText() || props.message).replaceAll(/\s+/g, ' ').trim()
    const room = dimensions().width - fixedWidth() - 2
    if (!flat || room < 2) return ''
    return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
  })

  /**
   * Columns left for hints once everything that must be shown has its space.
   * Hints are the only part of the bar that may vanish, so they are measured
   * against what is left rather than being given a share of their own.
   */
  const budget = createMemo(
    // One spare column so the last hint never butts against the next group.
    () => dimensions().width - fixedWidth() - groupWidth(messageText()) - 3,
  )

  /** As many hints as fit, in order. None at all on a narrow terminal. */
  const hints = createMemo(() => {
    const room = budget()
    const shown: Hint[] = []
    let used = 0
    for (const hint of hintsFor(props.focus)) {
      const width = hint.key.length + 1 + hint.label.length + SEPARATOR.length
      if (used + width > room) break
      shown.push(hint)
      used += width
    }
    return shown
  })

  return (
    <box height={1} flexDirection="row" backgroundColor={ui.barBg} flexShrink={0}>
      <Show when={props.vimMode}>
        {(mode: () => VimMode) => (
          <box backgroundColor={ui.statusBg} paddingLeft={1} paddingRight={1} flexShrink={0}>
            <text
              fg={ui.statusFg}
              bg={ui.statusBg}
              content={MODE_LABELS[mode()]}
              attributes={TextAttributes.BOLD}
            />
          </box>
        )}
      </Show>

      {/* Left: the repository. Right: the file. The message and the hints share
          what is between them, and the hints give way first. */}
      <Show when={props.branch}>
        <Group text={`⎇ ${branchText()}`} fg={ui.dim} padLeft={2} onClick={props.onBranch} />
        <Show when={syncText()}>
          <Group text={syncText()} fg={ui.dim} padLeft={1} onClick={props.onSync} />
        </Show>
        <Show when={changedText()}>
          <Group text={changedText()} fg={ui.dim} padLeft={1} onClick={props.onChanges} />
        </Show>
      </Show>

      <Show when={messageText()}>
        <Group
          text={messageText()}
          fg={props.busy ? ui.accent : TONE_COLORS[props.tone]()}
          padLeft={2}
        />
      </Show>

      <box flexGrow={1} flexDirection="row" paddingLeft={2} backgroundColor={ui.barBg}>
        <For each={hints()}>
          {hint => {
            const hover = useHover()
            const bg = () => (hint.id && hover.hovered() ? ui.hoverBg : ui.barBg)
            return (
              <box
                flexDirection="row"
                flexShrink={0}
                backgroundColor={bg()}
                onMouseDown={hint.id ? () => props.onHint(hint.id!) : undefined}
                onMouseOver={hover.enter}
                onMouseOut={hover.leave}
              >
                <text fg={ui.dim} bg={bg()} content={hint.key} />
                {/* The separator is outside the tint: it is the gap to the next
                    hint, not part of this one's target. */}
                <text fg={ui.faint} bg={bg()} content={` ${hint.label}`} />
                <text fg={ui.faint} bg={ui.barBg} content={SEPARATOR} />
              </box>
            )
          }}
        </For>
      </box>

      <Show when={problemsText()}>
        <Group
          text={problemsText()}
          fg={props.problems && props.problems.errors > 0 ? ui.error : ui.dirty}
          padRight={2}
          onClick={props.onProblems}
        />
      </Show>
      <Show when={props.dirty}>
        <Group text="● unsaved" fg={ui.dirty} padRight={2} onClick={props.onSave} />
      </Show>
      <Show when={cursorText()}>
        <Group text={cursorText()} fg={ui.dim} padRight={2} onClick={props.onGotoLine} />
      </Show>
      <Show when={props.filetype}>
        {(filetype: () => string) => <Group text={filetype()} fg={ui.accent} padRight={2} />}
      </Show>
    </box>
  )
}
