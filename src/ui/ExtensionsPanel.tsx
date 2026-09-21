import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, on, Show } from 'solid-js'

import type { ExtensionCategory } from '../extensions'
import { ui } from '../themes'
import { useHover, useHoverKey } from './hover'
import { createScrollList, rowBg } from './list'
import { Panel, PanelHeader } from './PanelHeader'
import { PanelList } from './PanelList'
import { TextInput } from './TextInput'

export type ExtensionRow =
  | {
      kind: 'section'
      id: string
      label: string
      count: number
      collapsed: boolean
    }
  | {
      kind: 'installed'
      id: string
      label: string
      version: string
      categories: ExtensionCategory[]
      update: string | null
      disabled: boolean
      builtin: boolean
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
  | { kind: 'note'; id: string; label: string }

// `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row.
const sectionRow = (row: ExtensionRow) =>
  row.kind === 'section' ? row : undefined
const installedRow = (row: ExtensionRow) =>
  row.kind === 'installed' ? row : undefined

interface ExtensionsPanelProps {
  rows: ExtensionRow[]
  cursor: number
  installedCount: number
  query: string | null
  focused: boolean
  width: number
  onFocus: () => void
  onSearch: (value: string) => void
  onOpenSearch: () => void
  onActivate: (index: number) => void
}

export function ExtensionsPanel(props: ExtensionsPanelProps) {
  // A memo so the reveal below fires on the cursor's *value* — see GitPanel.
  const cursor = createMemo(() =>
    Math.max(0, Math.min(props.cursor, props.rows.length - 1))
  )

  const list = createScrollList(() => props.rows.length)
  const search = useHover()
  const rowHover = useHoverKey<number>()

  createEffect(on(cursor, (row) => list.reveal(row)))

  const version = (row: ExtensionRow) => {
    if (row.kind === 'available') {
      return row.version
    }
    if (row.kind !== 'installed') {
      return ''
    }
    return row.update ? `→ ${row.update}` : row.version
  }

  const categories = (row: ExtensionRow) => {
    if (row.kind !== 'installed' && row.kind !== 'available') {
      return ''
    }
    const text = row.categories.join(' ')
    // 5 for the glyph column, 2 for the gaps either side, 1 for the trailing pad.
    const room = props.width - 5 - row.label.length - version(row).length - 3
    return text.length > 0 && text.length <= room ? text : ''
  }

  return (
    <Panel width={props.width} onFocus={props.onFocus}>
      <PanelHeader
        title="Extensions"
        width={props.width}
        focused={props.focused}
      >
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          flexShrink={0}
          wrapMode="none"
          content={`${props.installedCount} installed`}
        />
      </PanelHeader>

      {/* Always drawn, a real input only while typed into: two focused inputs split the typing. */}
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
        <PanelList list={list} items={props.rows}>
          {(row, index) => {
            const bg = () =>
              rowBg(
                index() === cursor(),
                props.focused,
                rowHover.hovered(index())
              )
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                // Not stopped: the panel's own handler runs after this and focuses it.
                onMouseDown={() => props.onActivate(index())}
                onMouseOver={() => rowHover.enter(index())}
                onMouseOut={() => rowHover.leave(index())}
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
                  <text
                    wrapMode="none"
                    fg={ui.faint}
                    bg={bg()}
                    content={`   ${row.label}`}
                  />
                </Show>
                <Show
                  when={row.kind === 'installed' || row.kind === 'available'}
                >
                  {/* The state glyph never gives: shrinking it slides every name left. */}
                  <text
                    fg={
                      row.kind === 'installed' && row.disabled
                        ? ui.faint
                        : ui.accent
                    }
                    bg={bg()}
                    flexShrink={0}
                    content={
                      row.kind === 'installed'
                        ? `   ${row.disabled ? '✗' : '✓'} `
                        : '   + '
                    }
                  />
                  <text
                    wrapMode="none"
                    fg={
                      row.kind === 'installed' && row.disabled
                        ? ui.dim
                        : ui.text
                    }
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
        </PanelList>
      </Show>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          content="↑↓ · Enter · Bksp uninstall"
        />
      </box>
    </Panel>
  )
}
