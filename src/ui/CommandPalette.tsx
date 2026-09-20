import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { ui } from '../themes'
import { useHoverKey } from './hover'
import { windowAround } from './list'
import { listRows, modalWidth } from './modal'
import { ModalPanel, topInset } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export interface Command {
  id: string
  label: string
  hint?: string
  run?: () => void
  preview?: () => void
  restore?: () => void
  children?: Command[]
}

export interface FlatCommand {
  command: Command
  trail: string[]
}

export function flattenCommands(commands: Command[], trail: string[] = []): FlatCommand[] {
  return commands.flatMap(command =>
    command.children
      ? flattenCommands(command.children, [...trail, command.label])
      : [{ command, trail }],
  )
}

export interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette(props: CommandPaletteProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [trail, setTrail] = createSignal<Command[]>([])
  const [index, setIndex] = createSignal(0)
  const hover = useHoverKey<number>()
  let restore: (() => void) | undefined

  const width = () => modalWidth(dimensions().width, 0.55, 58, 92)
  const visibleRows = () => listRows(dimensions().height - topInset(dimensions().height), 8, 18)

  const rows = createMemo<FlatCommand[]>(() => {
    const q = query().trim().toLowerCase()
    if (!q) {
      const parent = trail().at(-1)
      const level = parent ? (parent.children ?? []) : props.commands
      return level.map(command => ({ command, trail: [] }))
    }
    return flattenCommands(props.commands).filter(({ command, trail: t }) =>
      [...t, command.label].join(' ').toLowerCase().includes(q),
    )
  })

  const selected = () => Math.min(index(), Math.max(0, rows().length - 1))

  createEffect(() => {
    const row = rows()[selected()]
    if (row?.command.preview) {
      row.command.preview()
      restore = row.command.restore
    } else if (restore) {
      restore()
      restore = undefined
    }
  })

  // A preview must not outlive the palette, and every other way out is a teardown.
  onCleanup(() => restore?.())

  const windowed = createMemo(() => windowAround(rows(), selected(), visibleRows()))

  const enter = (row: FlatCommand) => {
    if (row.command.children) {
      setTrail(t => [...t, row.command])
      setQuery('')
      setIndex(0)
      return
    }
    // `run` writes the previewed value, so the teardown must not put the old one back over it.
    if (row.command.preview) restore = undefined
    props.onClose()
    row.command.run?.()
  }

  const back = () => {
    if (trail().length === 0) {
      props.onClose()
      return
    }
    setTrail(t => t.slice(0, -1))
    setIndex(0)
  }

  useKeys((key: KeyEvent) => {
    const k = key.name
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + rows().length) % Math.max(1, rows().length))
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % Math.max(1, rows().length))
    } else if (k === 'return' || k === 'enter' || k === 'right') {
      key.preventDefault()
      const row = rows()[selected()]
      if (row) enter(row)
    } else if (k === 'left' || k === 'escape') {
      key.preventDefault()
      back()
    }
  })

  return (
    <ModalPanel
      zIndex={150}
      align="top"
      width={width()}
      title={
        trail().length > 0
          ? ` ${trail()
              .map(c => c.label)
              .join(' › ')} `
          : ' Commands '
      }
    >
      <TextInput
        value={query()}
        placeholder="Type to filter…"
        onInput={v => {
          setQuery(v)
          setIndex(0)
        }}
      />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      {/* Fixed height: a list that shrinks per keystroke moves the input being typed in. */}
      <box flexDirection="column" height={visibleRows()}>
        <Show
          when={rows().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matching commands" />}
        >
          <For each={windowed().rows}>
            {(row, i) => {
              const at = () => windowed().start + i()
              const active = () => at() === selected()
              const bg = () =>
                active() ? ui.treeSelectedBg : hover.hovered(at()) ? ui.hoverBg : ui.panelBg
              const prefix = row.trail.length > 0 ? `${row.trail.join(' › ')} › ` : ''
              return (
                <box
                  flexDirection="row"
                  backgroundColor={bg()}
                  onMouseDown={() => enter(row)}
                  onMouseOver={() => hover.enter(at())}
                  onMouseOut={() => hover.leave(at())}
                >
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <box flexGrow={1}>
                    <text
                      wrapMode="none"
                      fg={active() ? ui.text : ui.dim}
                      bg={bg()}
                      content={`${prefix}${row.command.label}${row.command.children ? ' ›' : ''}`}
                    />
                  </box>
                  <Show when={row.command.hint}>
                    {(hint: () => string) => (
                      <text wrapMode="none" fg={ui.faint} bg={bg()} content={`${hint()} `} />
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={trail().length > 0 ? '←/Esc back · Enter run' : '↑↓ move · Enter open · Esc close'}
      />
    </ModalPanel>
  )
}
