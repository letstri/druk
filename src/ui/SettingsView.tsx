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

export type { SettingEdit, SettingField } from './SettingEditor'

export interface SettingRow {
  /** Heading the row is grouped under; consecutive rows share one heading. */
  section: string
  label: string
  /** Current value, drawn right-aligned. */
  value: string
  /** Step the setting: → is 1, ← is -1. Two-state settings flip either way. */
  cycle: (dir: 1 | -1) => void
  /**
   * When set, Enter opens a filterable list of every value instead of stepping.
   * A pick may hand back a `SettingEdit` to type into — that is how list rows
   * (formatters, server commands) chain into free text.
   */
  select?: {
    options: string[]
    pick: (index: number) => void | SettingEdit
    /** Paint a value while the selection sits on it — used by the theme rows. */
    preview?: (index: number) => void
    /** Put back what the config says, once the list is gone. */
    restore?: () => void
  }
  /** When set, Enter opens this edit directly. Takes precedence over `select`. */
  edit?: SettingEdit
  /** The project's own settings file is what supplies this value. */
  local?: boolean
  /** Drop that project override — offered only where there is one to drop. */
  clear?: () => void
}

export interface SettingsViewProps {
  rows: SettingRow[]
  /** Which file the rows show and changes are written to. */
  scope: ConfigScope
  onToggleScope: () => void
  /** Where changes persist, shown at the foot of the page. */
  configFile: string
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** The page shares the editor's focus slot; unfocused, its keys stay dead. */
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onClose: () => void
}

/**
 * The settings page: takes the editor's place while open, one row per setting.
 * Every change applies immediately and persists through the row's own `cycle`,
 * so this component owns nothing but the selection and the keyboard.
 */
export function SettingsView(props: SettingsViewProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)
  /** The value list floating over the page, for the selected row's `select`. */
  const [picking, setPicking] = createSignal(false)
  /** The text field floating over the page, for a row's (or a pick's) `edit`. */
  const [editing, setEditing] = createSignal<SettingEdit | null>(null)
  /** The filter field above the rows; absent until `/` opens it. */
  const [searching, setSearching] = createSignal(false)
  const [query, setQuery] = createSignal('')

  /** Rows the filter leaves, in page order — sorting by score would scramble the sections. */
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

  /** Enter's meaning: open the row's edit or list when it has one, step otherwise. */
  const activate = (row: SettingRow) => {
    if (row.edit) setEditing(row.edit)
    else if (row.select) setPicking(true)
    else row.cycle(1)
  }

  useKeys((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse. The value
    // list owns the keyboard while open — j/k must type into its filter.
    if (props.blocked || !props.focused || key.defaultPrevented || picking() || editing()) return
    const k = key.name
    const count = Math.max(1, rows().length)
    // While the filter field is up every printable key belongs to it — only the
    // keys it has no use for are still the page's, and Esc backs out of the
    // filter before it closes the page.
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
    // The global keymap hands Tab to whatever holds the editor slot, so it is
    // this page's to spend on the thing it has two of: files to write.
    else if (k === 'tab') props.onToggleScope()
    else if (k === 'backspace' || k === 'delete') {
      const clear = rows()[selected()]?.clear
      if (!clear) return
      clear()
    }
    // Ctrl+F is the global file search, so the filter takes the vim-ish key
    // instead — the page has no text to search anyway.
    else if (!key.ctrl && (k === '/' || key.sequence === '/')) {
      setSearching(true)
      setIndex(0)
    } else if (k === 'return' || k === 'enter' || k === 'space') {
      const row = rows()[selected()]
      if (row) activate(row)
    } else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  /**
   * Rows the page can draw. A section heading costs its own row plus a blank one
   * above it, so the window is measured in drawn rows, not settings — and it has
   * to be measured at all: overflowing the column pushes the title bar off the
   * top of the page instead of scrolling, which reads as the page being broken.
   */
  const heading = (at: number) => at === 0 || rows()[at - 1]!.section !== rows()[at]!.section
  const cost = (at: number) => (heading(at) ? (at > 0 ? 3 : 2) : 1)
  /** The filter field and its blank line cost two more rows when it is up. */
  const budget = () => Math.max(3, dimensions().height - 4 - (searching() ? 2 : 0))

  /** First row on screen; moves only when the selection leaves the window. */
  const [top, setTop] = createSignal(0)

  /** How many rows starting at `from` fit in `budget`, at least one. */
  const fits = (from: number) => {
    let drawn = 0
    let count = 0
    while (from + count < rows().length && drawn + cost(from + count) <= budget()) {
      drawn += cost(from + count)
      count += 1
    }
    return Math.max(1, count)
  }

  // `on`, so only a moved selection touches the window: editing a value rebuilds
  // `props.rows`, and a plain effect tracks that through `fits` — which yanked a
  // wheel-scrolled page back to the selection every time the rows were rebuilt.
  createEffect(
    on(selected, at => {
      setTop(previous => {
        if (at < previous) return at
        // Walk the window's start down until the selection is inside it: with
        // variable row heights there is no arithmetic for this.
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

  /**
   * Furthest the window may start: the first row whose window still reaches the
   * last one. Walked backwards because a heading costs three rows and a plain
   * setting one, so there is no arithmetic for it.
   */
  const maxTop = () => {
    let start = Math.max(0, rows().length - 1)
    while (start > 0 && start - 1 + fits(start - 1) >= rows().length) start -= 1
    return start
  }

  /** The wheel moves the window alone — the selection is the keyboard's. */
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

  /** Which of the two files is on show — the page is otherwise identical. */
  const title = () => ` Settings — ${props.scope === 'project' ? 'Project' : 'User'}`

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const reset = selectedRow()?.clear ? ' · Bksp reset' : ''
    const full = searching()
      ? ' ↑↓ move · Enter change · Esc filter off '
      : ` ↑↓ move · ←→ change · Tab scope${reset} · / filter · Esc close `
    if (full.length + title().length + 2 <= props.width) return full
    return searching() ? ' ↑↓ · Enter · Esc ' : ' ↑↓ · ←→ · Tab · / · Esc '
  }

  /**
   * Columns a row's value may take. Half the pane: every label is fixed text and
   * shorter than that, so the split costs nothing readable — and the value is
   * the half that carries paths and commands somebody typed.
   */
  const valueRoom = () => Math.max(8, Math.floor(props.width / 2) - 4)

  /**
   * The file the changes land in, plus what the ◆ rows mean — which is not the
   * same thing in the two scopes: here it is "set in this file", on the user's
   * page it is "and the project overrides it anyway".
   */
  const footer = () => {
    const marked = props.rows.some(row => row.local)
    const legend = !marked
      ? ''
      : props.scope === 'project'
        ? ' · ◆ set here'
        : ' · ◆ set by project'
    // `~` first: a home-relative path is what the user would type, and cutting
    // the front off an absolute one leaves the unreadable middle of a temp dir.
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
            {/* Two focused inputs would split the typing between them, so while
                the value list is up the field is drawn as plain text. */}
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
                {/* The value column cannot shrink, and half of what it shows is
                    typed by the user — a formatter command, a tsdk path. Left
                    whole, one of those wraps into a column of single characters
                    and the page's row window stops matching what is drawn. */}
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
                // Close first: picking rebuilds the rows, and a keyed accessor read
                // after that tears the popup down mid-handler ("stale read").
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
