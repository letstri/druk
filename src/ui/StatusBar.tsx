import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js'

import { MODE_LABELS } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { ui } from '../themes'
import { useHover } from './hover'
import type { Hint, KeyScope } from './keys'
import { chordFor, hintsFor } from './keys'
import { SEVERITY_GLYPH } from './severity'
import { cut } from './text'
import { useTooltip } from './tooltip'

export type Tone = 'info' | 'warn' | 'error'

interface StatusBarProps {
  message: string
  tone: Tone
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
  vimMode: VimMode | null
  repo: string | null
  branch: string | null
  ahead: number
  behind: number
  changed: number
  problems?: { errors: number; warnings: number }
  focus: KeyScope
  pathUnderCursor: boolean
  definitionServed: boolean
  extraHints?: Hint[]
  busy: { label: string; done?: number; total?: number } | null
  onBranch: () => void
  onSync: () => void
  onChanges: () => void
  onProblems: () => void
  onSave: () => void
  onGotoLine: () => void
  onHint: (id: string) => void
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const TONE_COLORS: Record<Tone, () => string> = {
  error: () => ui.error,
  info: () => ui.dim,
  warn: () => ui.dirty,
}

const SEPARATOR = '  '

// Padding belongs to the box: the tint covers the whole target and the widths count it.
function Group(props: {
  text: string
  fg: string
  padLeft?: number
  padRight?: number
  attributes?: number
  onClick?: () => void
  command?: string
}) {
  const hover = useTooltip(props.command)
  const bg = () => (props.onClick && hover.lit() ? ui.hoverBg : ui.barBg)
  return (
    <box
      ref={hover.ref}
      paddingLeft={props.padLeft ?? 0}
      paddingRight={props.padRight ?? 0}
      flexShrink={0}
      backgroundColor={bg()}
      onMouseDown={props.onClick}
      onMouseOver={hover.enter}
      onMouseOut={hover.leave}
    >
      <text
        fg={props.fg}
        bg={bg()}
        content={props.text}
        attributes={props.attributes}
      />
    </box>
  )
}

export function StatusBar(props: StatusBarProps) {
  const dimensions = useTerminalDimensions()

  const [frame, setFrame] = createSignal(0)
  // A boolean, so the effect sees one change per operation: `props.busy` ticks restarted it.
  const spinning = createMemo(() => props.busy !== null)

  createEffect(() => {
    if (!spinning()) {
      return
    }
    const timer = setInterval(
      () => setFrame((at) => (at + 1) % SPINNER.length),
      100
    )
    onCleanup(() => clearInterval(timer))
  })

  const busyText = () => {
    const { busy } = props
    if (!busy) {
      return ''
    }
    const count =
      busy.total !== null && busy.total !== undefined && busy.total > 0
        ? ` ${busy.done ?? 0}/${busy.total}`
        : busy.done === null || busy.done === undefined
          ? ''
          : ` ${busy.done}`
    return `${SPINNER[frame()]} ${busy.label}${count}`
  }

  // The branch is the user's own words and cannot shrink: uncut it pushes the bar off screen.
  const branchText = () => {
    if (!props.branch) {
      return ''
    }
    const label = `${props.repo ? `${props.repo}/` : ''}${props.branch}`
    return cut(label, Math.max(12, Math.round(dimensions().width * 0.25)))
  }

  const syncText = () => {
    const parts: string[] = []
    if (props.ahead > 0) {
      parts.push(`↑${props.ahead}`)
    }
    if (props.behind > 0) {
      parts.push(`↓${props.behind}`)
    }
    return parts.join(' ')
  }

  const changedText = () => (props.changed > 0 ? `~${props.changed}` : '')

  // Drawn as three click targets, but this stays the one string the row's width comes from.
  const gitText = () => {
    if (!props.branch) {
      return ''
    }
    return [`⎇ ${branchText()}`, syncText(), changedText()]
      .filter(Boolean)
      .join(' ')
  }

  const cursorText = () =>
    props.cursor
      ? `Ln ${props.cursor.line + 1}, Col ${props.cursor.col + 1}`
      : ''

  const problemsText = () => {
    const { problems } = props
    if (!problems) {
      return ''
    }
    const parts: string[] = []
    if (problems.errors > 0) {
      parts.push(`${SEVERITY_GLYPH.error} ${problems.errors}`)
    }
    if (problems.warnings > 0) {
      parts.push(`${SEVERITY_GLYPH.warning} ${problems.warnings}`)
    }
    return parts.join(' ')
  }

  const groupWidth = (text: string) => (text ? text.length + 2 : 0)

  const fixedWidth = createMemo(
    () =>
      groupWidth(props.vimMode ? MODE_LABELS[props.vimMode] : '') +
      groupWidth(gitText()) +
      groupWidth(props.dirty ? '● unsaved' : '') +
      groupWidth(problemsText()) +
      groupWidth(cursorText()) +
      groupWidth(props.filetype ?? '')
  )

  // Cut and whitespace-collapsed: the box cannot shrink, and a newline would push the groups off.
  const messageText = createMemo(() => {
    const flat = (busyText() || props.message).replaceAll(/\s+/gu, ' ').trim()
    const room = dimensions().width - fixedWidth() - 2
    if (!flat || room < 2) {
      return ''
    }
    return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
  })

  const budget = createMemo(
    () => dimensions().width - fixedWidth() - groupWidth(messageText()) - 3
  )

  // Rebindable, so the chord is asked for rather than spelled.
  const contextual = (): Hint[] => {
    const key = props.pathUnderCursor ? chordFor('goto.file') : ''
    const path: Hint[] = key
      ? [{ id: 'goto.file', key, label: 'open path', rank: 2 }]
      : []
    const jump = props.definitionServed ? chordFor('goto.definition') : ''
    const definition: Hint[] = jump
      ? [{ id: 'goto.definition', key: jump, label: 'definition', rank: 2 }]
      : []
    const peek = props.definitionServed ? chordFor('goto.calls') : ''
    const calls: Hint[] = peek
      ? [{ id: 'goto.calls', key: peek, label: 'calls', rank: 2 }]
      : []
    return [...path, ...definition, ...calls, ...(props.extraHints ?? [])]
  }

  const hints = createMemo(() => {
    const room = budget()
    const shown: Hint[] = []
    let used = 0
    for (const hint of hintsFor(props.focus, contextual())) {
      const width = hint.key.length + 1 + hint.label.length + SEPARATOR.length
      if (used + width > room) {
        break
      }
      shown.push(hint)
      used += width
    }
    return shown
  })

  return (
    <box
      height={1}
      flexDirection="row"
      backgroundColor={ui.barBg}
      flexShrink={0}
    >
      <Show when={props.vimMode}>
        {(mode: () => VimMode) => (
          <box
            backgroundColor={ui.statusBg}
            paddingLeft={1}
            paddingRight={1}
            flexShrink={0}
          >
            <text
              fg={ui.statusFg}
              bg={ui.statusBg}
              content={MODE_LABELS[mode()]}
              attributes={TextAttributes.BOLD}
            />
          </box>
        )}
      </Show>

      <Show when={props.branch}>
        <Group
          text={`⎇ ${branchText()}`}
          fg={ui.dim}
          padLeft={2}
          onClick={props.onBranch}
        />
        <Show when={syncText()}>
          <Group
            text={syncText()}
            fg={ui.dim}
            padLeft={1}
            onClick={props.onSync}
          />
        </Show>
        <Show when={changedText()}>
          <Group
            text={changedText()}
            fg={ui.dim}
            padLeft={1}
            onClick={props.onChanges}
            command="view.git"
          />
        </Show>
      </Show>

      <Show when={messageText()}>
        <Group
          text={messageText()}
          fg={props.busy ? ui.accent : TONE_COLORS[props.tone]()}
          padLeft={2}
        />
      </Show>

      <box
        flexGrow={1}
        flexDirection="row"
        paddingLeft={2}
        backgroundColor={ui.barBg}
      >
        <For each={hints()}>
          {(hint) => {
            const hover = useHover()
            const bg = () =>
              hint.id && hover.hovered() ? ui.hoverBg : ui.barBg
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
          command="problems.list"
        />
      </Show>
      <Show when={props.dirty}>
        <Group
          text="● unsaved"
          fg={ui.dirty}
          padRight={2}
          onClick={props.onSave}
          command="save"
        />
      </Show>
      <Show when={cursorText()}>
        <Group
          text={cursorText()}
          fg={ui.dim}
          padRight={2}
          onClick={props.onGotoLine}
          command="goto"
        />
      </Show>
      <Show when={props.filetype}>
        {(filetype: () => string) => (
          <Group text={filetype()} fg={ui.accent} padRight={2} />
        )}
      </Show>
    </box>
  )
}
