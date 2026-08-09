import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { ui } from '../themes'
import { windowAround } from './list'
import { listRows, modalWidth } from './modal'
import { ModalPanel, topInset } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export interface Command {
  id: string
  label: string
  /** Keybinding shown right-aligned, e.g. "Ctrl+S". Leaves only. */
  hint?: string
  run?: () => void
  /** Paint a value while the selection sits on it — used by the themes submenu. */
  preview?: () => void
  /** Put back what the config says, once the preview is over. */
  restore?: () => void
  children?: Command[]
}

export interface FlatCommand {
  command: Command
  /** Breadcrumb of ancestor labels, e.g. ["Themes"]. */
  trail: string[]
}

/** Every runnable leaf, with its path — used while filtering. */
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
  /** Undo for the preview on screen, until it is confirmed or left behind. */
  let restore: (() => void) | undefined

  const width = () => modalWidth(dimensions().width, 0.55, 58, 92)
  /** Border, input, blank line and footer. */
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

  /** Paint a command's preview whenever the selection lands on one. */
  createEffect(() => {
    const row = rows()[selected()]
    if (row?.command.preview) {
      row.command.preview()
      restore = row.command.restore
    } else if (restore) {
      // Filtered away from it, or backed out of the submenu: the selection has
      // left the previewed value, so the paint goes with it.
      restore()
      restore = undefined
    }
  })

  // Every other way out closes the palette rather than moving the selection, and
  // a preview must not outlive it — so the undo hangs off the teardown.
  onCleanup(() => restore?.())

  // A filter can match every leaf in the tree; rendering them all pushes the
  // input and the footer off an 80x24 screen, so only a window is drawn.
  const windowed = createMemo(() => windowAround(rows(), selected(), visibleRows()))

  const enter = (row: FlatCommand) => {
    if (row.command.children) {
      setTrail(t => [...t, row.command])
      setQuery('')
      setIndex(0)
      return
    }
    // Confirming the preview on screen: `run` writes the value it is showing,
    // so the teardown must not put the old one back over it.
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
      {/* A blank line between the field and the list, so the two read as separate
            things rather than one dense block. */}
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      {/* Fixed height, not content height: the panel is centered, so a list that
            shrinks with every keystroke moves the input field the user is typing in. */}
      <box flexDirection="column" height={visibleRows()}>
        <Show
          when={rows().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matching commands" />}
        >
          <For each={windowed().rows}>
            {(row, i) => {
              const active = () => windowed().start + i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              const prefix = row.trail.length > 0 ? `${row.trail.join(' › ')} › ` : ''
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  {/* A bar on the selected row: the background alone is easy to miss
                        on a low-contrast theme. */}
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <box flexGrow={1}>
                    {/* A row each: a label can carry a theme name an extension
                        chose, and one long enough to wrap grows the fixed-height
                        list past the footer. */}
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
