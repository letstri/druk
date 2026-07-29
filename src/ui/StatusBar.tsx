import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { MODE_LABELS } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { ui } from '../themes'
import { hintsFor } from './keys'

export type Tone = 'info' | 'warn' | 'error'

export interface StatusBarProps {
  message: string
  tone: Tone
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
  vimMode: VimMode | null
  branch: string | null
  /** Commits the branch is ahead of / behind its upstream. */
  ahead: number
  behind: number
  /** Files differing from HEAD in the working tree. */
  changed: number
  focus: 'tree' | 'editor'
  /** VS Code keymap preset — the advertised palette key differs. */
  vscodeKeys: boolean
  /** A long file operation in flight; replaces the message while it runs. */
  busy: { label: string; done: number; total: number } | null
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

  const gitText = () => {
    if (!props.branch) return ''
    const parts = [`⎇ ${props.branch}`]
    if (props.ahead > 0) parts.push(`↑${props.ahead}`)
    if (props.behind > 0) parts.push(`↓${props.behind}`)
    if (props.changed > 0) parts.push(`~${props.changed}`)
    return parts.join(' ')
  }

  const cursorText = () =>
    props.cursor ? `Ln ${props.cursor.line + 1}, Col ${props.cursor.col + 1}` : ''

  /** A group's columns: its text plus the two of padding every group carries. */
  const groupWidth = (text: string) => (text ? text.length + 2 : 0)

  /** Everything that never gives way — the vim badge, git, and the right-hand groups. */
  const fixedWidth = createMemo(
    () =>
      groupWidth(props.vimMode ? MODE_LABELS[props.vimMode] : '') +
      groupWidth(gitText()) +
      groupWidth(props.dirty ? '● unsaved' : '') +
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
    const shown: Array<readonly [string, string]> = []
    let used = 0
    for (const hint of hintsFor(props.focus, props.vscodeKeys)) {
      const width = hint[0].length + 1 + hint[1].length + SEPARATOR.length
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
      <Show when={gitText()}>
        <box paddingLeft={2} flexShrink={0}>
          <text fg={ui.dim} bg={ui.barBg} content={gitText()} />
        </box>
      </Show>

      <Show when={messageText()}>
        <box paddingLeft={2} flexShrink={0}>
          <text
            fg={props.busy ? ui.accent : TONE_COLORS[props.tone]()}
            bg={ui.barBg}
            content={messageText()}
          />
        </box>
      </Show>

      <box flexGrow={1} flexDirection="row" paddingLeft={2} backgroundColor={ui.barBg}>
        <For each={hints()}>
          {([key, label]) => (
            <box flexDirection="row" flexShrink={0} backgroundColor={ui.barBg}>
              <text fg={ui.dim} bg={ui.barBg} content={key} />
              <text fg={ui.faint} bg={ui.barBg} content={` ${label}${SEPARATOR}`} />
            </box>
          )}
        </For>
      </box>

      <Show when={props.dirty}>
        <box paddingRight={2} flexShrink={0}>
          <text fg={ui.dirty} bg={ui.barBg} content="● unsaved" />
        </box>
      </Show>
      <Show when={cursorText()}>
        <box paddingRight={2} flexShrink={0}>
          <text fg={ui.dim} bg={ui.barBg} content={cursorText()} />
        </box>
      </Show>
      <Show when={props.filetype}>
        {(filetype: () => string) => (
          <box paddingRight={2} flexShrink={0}>
            <text fg={ui.accent} bg={ui.barBg} content={filetype()} />
          </box>
        )}
      </Show>
    </box>
  )
}
