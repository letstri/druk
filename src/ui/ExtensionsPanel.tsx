import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, For, on, Show } from 'solid-js'

import type { ExtensionCategory } from '../extensions'
import { ui } from '../themes'
import { useHover } from './hover'
import { createScrollList, rowBg, scrollbarOptions } from './list'
import { TextInput } from './TextInput'

export type ExtensionRow =
  | { kind: 'section'; id: string; label: string; count: number; collapsed: boolean }
  | {
      kind: 'installed'
      id: string
      label: string
      version: string
      /** What it is — `language`, `lsp`, `theme`, `icons` — drawn where there is room. */
      categories: ExtensionCategory[]
      /** What the market has that this does not, or null. */
      update: string | null
      disabled: boolean
      builtin: boolean
      /** What it contributes — the search matches on it too. */
      about: string
    }
  | {
      kind: 'available'
      id: string
      label: string
      version: string
      about: string
      categories: ExtensionCategory[]
    }
  /** An inert line: what the cap left out. Enter on it does nothing. */
  | { kind: 'note'; id: string; label: string }

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const sectionRow = (row: ExtensionRow) => (row.kind === 'section' ? row : undefined)
const installedRow = (row: ExtensionRow) => (row.kind === 'installed' ? row : undefined)

export interface ExtensionsPanelProps {
  rows: ExtensionRow[]
  cursor: number
  /** How many manifests are loaded, whatever the search leaves on screen. */
  installedCount: number
  /** What the search field holds, or null while it is shut. */
  query: string | null
  focused: boolean
  width: number
  onFocus: () => void
  onSearch: (value: string) => void
  /** The search row clicked: start typing into it. `/` does the same. */
  onOpenSearch: () => void
  /** A row clicked: move the cursor there, and flip it, install it or fold it. */
  onActivate: (index: number) => void
}

/**
 * The sidebar's extensions view — VS Code's left-hand extensions panel, sized
 * down: what is installed under a heading, what the market has under another,
 * `Enter` to enable or install, `Backspace` to uninstall. Keys are handled in
 * `app/keyboard.ts` beside the tree's and the git panel's, so this renders and
 * reports clicks, nothing more.
 */
export function ExtensionsPanel(props: ExtensionsPanelProps) {
  /** A memo so the reveal below fires on the cursor's *value* — see GitPanel. */
  const cursor = createMemo(() => Math.max(0, Math.min(props.cursor, props.rows.length - 1)))

  const list = createScrollList(() => props.rows.length)
  const visible = createMemo(() => props.rows.slice(list.window().start, list.window().end))
  const search = useHover()

  createEffect(on(cursor, row => list.reveal(row)))

  /**
   * The version column. A pending update is drawn as the version it would move
   * to — once one is waiting that is the whole of what the row has to say.
   */
  const version = (row: ExtensionRow) => {
    if (row.kind === 'available') return row.version
    if (row.kind !== 'installed') return ''
    return row.update ? `→ ${row.update}` : row.version
  }

  /**
   * What the row is, drawn dim between the name and the version — and only where
   * the columns are going spare. A sidebar this narrow has none most of the
   * time, and a category that pushed a name out of view would cost more than it
   * told.
   */
  const categories = (row: ExtensionRow) => {
    if (row.kind !== 'installed' && row.kind !== 'available') return ''
    const text = row.categories.join(' ')
    // 5 for the glyph column, 2 for the gaps either side, 1 for the trailing pad.
    const room = props.width - 5 - row.label.length - version(row).length - 3
    return text.length > 0 && text.length <= room ? text : ''
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.sidebarBg}
      flexShrink={0}
      flexGrow={1}
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      {/* One row, as the tree's header and the git panel's are. */}
      <box
        height={1}
        flexDirection="row"
        backgroundColor={ui.sidebarBg}
        paddingLeft={2}
        paddingRight={1}
      >
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={1}
          content={`${props.installedCount} installed`}
          attributes={TextAttributes.BOLD}
        />
        <box flexGrow={1} backgroundColor={ui.sidebarBg} />
        <text fg={ui.faint} bg={ui.sidebarBg} flexShrink={0} content="extensions" />
      </box>

      {/* The panel's own search, and the only one it has: this view is about
          extensions and nothing else, so one field covers what is installed and
          what the market offers alike.

          Always drawn, never conditionally: a search that only appears once its
          key is pressed is a search nobody finds. It is a real input only while
          it is being typed into, though — the panel's letters are its own the
          rest of the time, and two focused inputs would split the typing. */}
      <box
        height={1}
        flexDirection="row"
        backgroundColor={search.hovered() ? ui.hoverBg : ui.sidebarBg}
        paddingLeft={1}
        onMouseDown={() => props.onOpenSearch()}
        onMouseOver={search.enter}
        onMouseOut={search.leave}
      >
        <text
          fg={ui.faint}
          bg={search.hovered() ? ui.hoverBg : ui.sidebarBg}
          flexShrink={0}
          content="/ "
        />
        <box flexGrow={1}>
          <Show
            when={props.query !== null}
            fallback={
              <text
                fg={ui.faint}
                bg={search.hovered() ? ui.hoverBg : ui.sidebarBg}
                content="name, theme, lsp, go…"
              />
            }
          >
            <TextInput
              value={props.query ?? ''}
              placeholder="name, theme, lsp, go…"
              onInput={props.onSearch}
            />
          </Show>
        </box>
      </box>

      <Show
        when={props.rows.length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.sidebarBg} paddingLeft={2}>
            <text fg={ui.faint} bg={ui.sidebarBg} content="nothing matches" />
          </box>
        }
      >
        <scrollbox
          ref={list.ref}
          flexGrow={1}
          backgroundColor={ui.sidebarBg}
          scrollbarOptions={scrollbarOptions()}
        >
          {/* Spacers keep the scrollable extent honest while only a window exists. */}
          <box height={list.window().start} flexShrink={0} backgroundColor={ui.sidebarBg} />
          <For each={visible()}>
            {(row, at) => {
              const index = () => list.window().start + at()
              const hover = useHover()
              const bg = () => rowBg(index() === cursor(), props.focused, hover.hovered())
              return (
                <box
                  height={1}
                  flexDirection="row"
                  backgroundColor={bg()}
                  // Deliberately not stopped: the panel's own handler runs after
                  // this one and focuses it, which is where the keyboard belongs.
                  onMouseDown={() => props.onActivate(index())}
                  onMouseOver={hover.enter}
                  onMouseOut={hover.leave}
                >
                  <Show when={sectionRow(row)}>
                    {(section: () => ExtensionRow & { kind: 'section' }) => (
                      <>
                        <text
                          fg={ui.dim}
                          bg={bg()}
                          flexShrink={0}
                          content={` ${section().collapsed ? '▸' : '▾'} `}
                        />
                        <box flexGrow={1} backgroundColor={bg()}>
                          <text
                            wrapMode="none"
                            fg={ui.folder}
                            bg={bg()}
                            content={section().label}
                            attributes={TextAttributes.BOLD}
                          />
                        </box>
                        <text
                          fg={ui.faint}
                          bg={bg()}
                          flexShrink={0}
                          content={`${section().count} `}
                        />
                      </>
                    )}
                  </Show>
                  <Show when={row.kind === 'note'}>
                    <text wrapMode="none" fg={ui.faint} bg={bg()} content={`   ${row.label}`} />
                  </Show>
                  <Show when={row.kind === 'installed' || row.kind === 'available'}>
                    {/* The state glyph never gives, as the tree's indent does not:
                        shrinking it would slide every name a column left. */}
                    <text
                      fg={row.kind === 'installed' && row.disabled ? ui.faint : ui.accent}
                      bg={bg()}
                      flexShrink={0}
                      content={
                        row.kind === 'installed' ? `   ${row.disabled ? '✗' : '✓'} ` : '   + '
                      }
                    />
                    <text
                      wrapMode="none"
                      fg={row.kind === 'installed' && row.disabled ? ui.dim : ui.text}
                      bg={bg()}
                      flexShrink={1}
                      content={row.label}
                    />
                    <Show when={categories(row)}>
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        flexShrink={0}
                        content={`  ${categories(row)}`}
                      />
                    </Show>
                    <box flexGrow={1} backgroundColor={bg()} />
                    <text
                      fg={installedRow(row)?.update ? ui.accent : ui.faint}
                      bg={bg()}
                      flexShrink={0}
                      content={`${version(row)} `}
                    />
                  </Show>
                </box>
              )
            }}
          </For>
          <box
            height={Math.max(0, props.rows.length - list.window().end)}
            flexShrink={0}
            backgroundColor={ui.sidebarBg}
          />
        </scrollbox>
      </Show>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text fg={ui.faint} bg={ui.sidebarBg} content="↑↓ · Enter · Bksp uninstall" />
      </box>
    </box>
  )
}
