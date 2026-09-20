import { homedir } from 'node:os'

import type { KeyEvent, MouseEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'

import type { ConfigScope } from '../core/config'
import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { useHover } from './hover'
import { SettingEditor } from './SettingEditor'
import type { SettingEdit } from './SettingEditor'
import { SettingPicker } from './SettingPicker'
import { cut } from './text'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export type { SettingEdit } from './SettingEditor'

export interface SettingRow {
  section: string
  label: string
  value: string
  // → is 1, ← is -1; two-state settings flip either way.
  cycle: (dir: 1 | -1) => void
  select?: {
    options: string[]
    pick: (index: number) => void | SettingEdit
    preview?: (index: number) => void
    restore?: () => void
  }
  // Enter opens this directly, ahead of `select`.
  edit?: SettingEdit
  local?: boolean
  clear?: () => void
}

export interface SettingsViewProps {
  rows: SettingRow[]
  scope: ConfigScope
  onToggleScope: () => void
  configFile: string
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onClose: () => void
}

export function SettingsView(props: SettingsViewProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)
  const [picking, setPicking] = createSignal(false)
  const [editing, setEditing] = createSignal<SettingEdit | null>(null)
  const [searching, setSearching] = createSignal(false)
  const [query, setQuery] = createSignal('')

  // In page order: sorting by score would scramble the sections.
  const rows = createMemo(() => {
    const q = query().trim()
    if (!q) return props.rows
    return props.rows.filter(row => fuzzyScore(`${row.section} ${row.label}`, q) !== null)
  })

  const selected = () => Math.min(index(), Math.max(0, rows().length - 1))
  const selectedRow = () => rows()[selected()]

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    setIndex(0)
  }

  const activate = (row: SettingRow) => {
    if (row.edit) setEditing(row.edit)
    else if (row.select) setPicking(true)
    else row.cycle(1)
  }

  useKeys((key: KeyEvent, k: string) => {
    // A page, not a modal: the value list owns the keyboard while open, so j/k type into its filter.
    if (props.blocked || !props.focused || key.defaultPrevented || picking() || editing()) return
    const count = Math.max(1, rows().length)
    // While the filter is up every printable key belongs to it; Esc backs out of it first.
    if (searching()) {
      if (k === 'up') setIndex((selected() - 1 + count) % count)
      else if (k === 'down') setIndex((selected() + 1) % count)
      else if (k === 'return' || k === 'enter') {
        const row = rows()[selected()]
        if (row) activate(row)
      } else if (k === 'escape') closeSearch()
      else return
      key.preventDefault()
      return
    }
    if (k === 'up' || k === 'k') setIndex((selected() - 1 + count) % count)
    else if (k === 'down' || k === 'j') setIndex((selected() + 1) % count)
    else if (k === 'home') setIndex(0)
    else if (k === 'end') setIndex(count - 1)
    else if (k === 'left' || k === 'h') rows()[selected()]?.cycle(-1)
    else if (k === 'right' || k === 'l') rows()[selected()]?.cycle(1)
    else if (k === 'tab') props.onToggleScope()
    else if (k === 'backspace' || k === 'delete') {
      const clear = rows()[selected()]?.clear
      if (!clear) return
      clear()
    } else if (!key.ctrl && (k === '/' || key.sequence === '/')) {
      setSearching(true)
      setIndex(0)
    } else if (k === 'return' || k === 'enter' || k === 'space') {
      const row = rows()[selected()]
      if (row) activate(row)
    } else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  // Measured in drawn rows: a heading costs its own row plus a blank one above it.
  const heading = (at: number) => at === 0 || rows()[at - 1]!.section !== rows()[at]!.section
  const cost = (at: number) => (heading(at) ? (at > 0 ? 3 : 2) : 1)
  const budget = () => Math.max(3, dimensions().height - 4 - (searching() ? 2 : 0))

  const [top, setTop] = createSignal(0)

  const fits = (from: number) => {
    let drawn = 0
    let count = 0
    while (from + count < rows().length && drawn + cost(from + count) <= budget()) {
      drawn += cost(from + count)
      count += 1
    }
    return Math.max(1, count)
  }

  // `on`, so only a moved selection touches the window: a rebuild would yank a wheel-scrolled page.
  createEffect(
    on(selected, at => {
      setTop(previous => {
        if (at < previous) return at
        let start = previous
        while (start < at && start + fits(start) <= at) start += 1
        return start
      })
    }),
  )

  const visible = createMemo(() => {
    const start = Math.min(top(), Math.max(0, rows().length - 1))
    return { start, rows: rows().slice(start, start + fits(start)) }
  })

  const maxTop = () => {
    let start = Math.max(0, rows().length - 1)
    while (start > 0 && start - 1 + fits(start - 1) >= rows().length) start -= 1
    return start
  }

  const wheel = (event: MouseEvent) => {
    const scroll = event.scroll
    if (picking() || editing() || !scroll) return
    if (scroll.direction !== 'up' && scroll.direction !== 'down') return
    const delta = Math.max(1, scroll.delta)
    setTop(previous =>
      Math.max(
        0,
        Math.min(scroll.direction === 'down' ? previous + delta : previous - delta, maxTop()),
      ),
    )
  }

  const title = () => ` Settings — ${props.scope === 'project' ? 'Project' : 'User'}`

  const hints = () => {
    const reset = selectedRow()?.clear ? ' · Bksp reset' : ''
    const full = searching()
      ? ' ↑↓ move · Enter change · Esc filter off '
      : ` ↑↓ move · ←→ change · Tab scope${reset} · / filter · Esc close `
    if (full.length + title().length + 2 <= props.width) return full
    return searching() ? ' ↑↓ · Enter · Esc ' : ' ↑↓ · ←→ · Tab · / · Esc '
  }

  const valueRoom = () => Math.max(8, Math.floor(props.width / 2) - 4)

  const footer = () => {
    const marked = props.rows.some(row => row.local)
    const legend = !marked
      ? ''
      : props.scope === 'project'
        ? ' · ◆ set here'
        : ' · ◆ set by project'
    const home = homedir()
    let path =
      home && props.configFile.startsWith(`${home}/`)
        ? `~${props.configFile.slice(home.length)}`
        : props.configFile
    const room = Math.max(8, props.width - 2 - legend.length)
    if (path.length > room) path = `…${path.slice(path.length - room + 1)}`
    return ` ${path}${legend}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
      onMouseScroll={wheel}
    >
      <box flexDirection="row" backgroundColor={ui.solidBarBg}>
        <text fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content={title()} />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>

      <Show when={searching()}>
        <box flexDirection="row" backgroundColor={ui.solidBg} paddingLeft={2} paddingRight={2}>
          <box flexGrow={1}>
            {/* Two focused inputs split the typing, so the field is plain text while the list is up. */}
            <Show
              when={!picking()}
              fallback={
                <text
                  fg={query() ? ui.text : ui.faint}
                  bg={ui.solidBg}
                  content={query() || 'Filter settings…'}
                />
              }
            >
              <TextInput
                value={query()}
                placeholder="Filter settings…"
                onInput={value => {
                  setQuery(value)
                  setIndex(0)
                  setTop(0)
                }}
              />
            </Show>
          </box>
        </box>
        <text fg={ui.solidBg} bg={ui.solidBg} content="" />
      </Show>

      <Show when={rows().length === 0}>
        <text fg={ui.dim} bg={ui.solidBg} content="  No matching settings" />
      </Show>

      <For each={visible().rows}>
        {(row, at) => {
          const i = () => visible().start + at()
          const active = () => i() === selected()
          const hover = useHover()
          const bg = () =>
            active() ? ui.treeSelectedBg : hover.hovered() ? ui.hoverBg : ui.solidBg
          const showHeading = () => heading(i())
          return (
            <>
              <Show when={showHeading()}>
                <Show when={i() > 0}>
                  <text fg={ui.solidBg} bg={ui.solidBg} content="" />
                </Show>
                <text fg={ui.faint} bg={ui.solidBg} content={`  ${row.section}`} />
              </Show>
              <box
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => {
                  props.onFocus()
                  if (active()) activate(row)
                  else setIndex(i())
                }}
                onMouseOver={hover.enter}
                onMouseOut={hover.leave}
              >
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                <text
                  wrapMode="none"
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={row.label}
                />
                <box flexGrow={1} backgroundColor={bg()} />
                <Show when={row.local}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content="◆ " />
                </Show>
                {/* Cannot shrink and the text is the user's: wrapped, the row window stops matching. */}
                <text
                  wrapMode="none"
                  fg={active() ? ui.accent : ui.text}
                  bg={bg()}
                  flexShrink={0}
                  content={cut(row.value, valueRoom())}
                />
                <text fg={bg()} bg={bg()} flexShrink={0} content=" " />
              </box>
            </>
          )
        }}
      </For>

      <box flexGrow={1} backgroundColor={ui.solidBg} />
      <text fg={ui.faint} bg={ui.solidBg} content={footer()} />

      <Show when={picking()}>
        {(() => {
          const row = selectedRow()
          return (
            <SettingPicker
              title={row?.label ?? ''}
              options={row?.select?.options ?? []}
              activeIndex={(row?.select?.options ?? []).indexOf(row?.value ?? '')}
              paneWidth={props.width}
              onPick={at => {
                // Close first: picking rebuilds the rows, and a keyed read then tears the popup down.
                setPicking(false)
                const edit = row?.select?.pick(at)
                if (edit) setEditing(edit)
              }}
              onClose={() => setPicking(false)}
              onPreview={row?.select?.preview}
              onRestore={row?.select?.restore}
            />
          )
        })()}
      </Show>

      <Show when={editing()} keyed>
        {(edit: SettingEdit) => (
          <SettingEditor
            edit={edit}
            paneWidth={props.width}
            onDone={values => {
              // Close first, as the picker does: applying rebuilds the rows.
              setEditing(null)
              if (values !== null) edit.apply(values)
            }}
          />
        )}
      </Show>
    </box>
  )
}
