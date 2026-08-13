import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, For, on, onCleanup, Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import type { ChangeArea } from '../core/git'
import { ui } from '../themes'
import { DiffView, diffMark, diffStatusColor } from './DiffView'
import type { DiffFile, DiffFileStatus } from './DiffView'
import { cut } from './text'
import { useKeys } from './useKeys'

/** One file in the all-changes page — staged and unstaged of the same path are
 * two of these, which is why `key` carries the area. */
export interface ChangeSection {
  /** `${area}:${path}` — unique when a path sits under both headings. */
  key: string
  rel: string
  area: ChangeArea
  status: DiffFileStatus
  /** Null when the file cannot be read as text — binary, or gone from disk. */
  file: DiffFile | null
  /** Patch body rows actually shown, after the per-file cap. */
  lines: number
  adds: number
  dels: number
}

export interface ChangesMeta {
  /** File rows the panel lists, including ones past the display cap. */
  total: number
  /** +/- of the sections on screen — not of the files the cap left out. */
  adds: number
  dels: number
}

/** Header line: when the stack was cut, `+X −Y` is what is showing, not the whole change list. */
export function changesSummary(title: string, shown: number, meta: ChangesMeta): string {
  const counts = `+${meta.adds} −${meta.dels}`
  if (meta.total > shown) {
    return `${title} · showing ${shown} of ${meta.total} files · ${counts}`
  }
  return `${title} · ${meta.total} files · ${counts}`
}

export interface ChangesViewProps {
  sections: ChangeSection[]
  meta: ChangesMeta
  /** Git panel cursor's section, or null on a heading — the page scrolls to it. */
  focusKey: string | null
  /** `Uncommitted`, or the branch the list is against. */
  title: string
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onClose: () => void
}

interface LaidOut {
  y: number
  height: number
}

const areaBadge = (area: ChangeArea) =>
  area === 'unstaged' ? undefined : area === 'merge' ? 'merge' : 'staged'

/**
 * Every changed file stacked in one scroll, over the editor slot — Cursor's
 * Changes page, sized to a terminal. The source-control panel keeps the list
 * and the commit; this is the reading surface.
 */
export function ChangesView(props: ChangesViewProps) {
  const dimensions = useTerminalDimensions()

  let box: ScrollBoxRenderable | undefined
  const anchors = new Map<string, LaidOut>()
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(revealTimer))

  const scroll = (delta: number) => {
    if (box) box.scrollTop = Math.max(0, box.scrollTop + delta)
  }
  const scrollTo = (row: number) => {
    if (box) box.scrollTop = Math.max(0, row)
  }

  const reveal = (key: string) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el) return
    const top = el.y - host.y + host.scrollTop
    const view = host.viewport?.height ?? host.height
    if (top < host.scrollTop) host.scrollTop = top
    else if (top + el.height > host.scrollTop + view) {
      host.scrollTop = Math.max(0, top + el.height - view)
    }
  }

  createEffect(
    on(
      // Membership, not identity: a refresh that reuses the same keys must not
      // yank the scroll back. First open still fires — focusKey is set before
      // the section refs exist, and a tick that misses has to try again.
      () => `${props.focusKey ?? ''}\n${props.sections.map(s => s.key).join('\n')}`,
      () => {
        const key = props.focusKey
        if (!key || !props.sections.some(s => s.key === key)) return
        clearTimeout(revealTimer)
        const tryReveal = () => {
          const el = anchors.get(key)
          const first = props.sections[0]?.key === key
          // y stays 0 until layout; treating that as ready scrolled a later
          // file to the top of the stack on first open.
          const ready = el && box && el.height > 0 && (first || el.y > 0)
          if (ready) {
            reveal(key)
            return
          }
          revealTimer = setTimeout(tryReveal, 16)
        }
        tryReveal()
      },
    ),
  )

  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent) => {
    if (props.blocked || !props.focused || key.defaultPrevented) return
    const k = key.name
    if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page())
    else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  const summary = () => changesSummary(props.title, props.sections.length, props.meta)

  const hints = () => {
    const full = ' ↑↓ scroll · Esc close '
    return full.length + 28 <= props.width ? full : ' Esc close '
  }

  const header = () => {
    const right = hints()
    const room = Math.max(8, props.width - right.length - 1)
    return ` ${cut(summary(), room)}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" flexShrink={0} backgroundColor={ui.solidBarBg}>
        <text wrapMode="none" fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content={header()} />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text wrapMode="none" fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>
      <Show
        when={props.sections.length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={2} paddingTop={1}>
            <text fg={ui.dim} content="No file changes." />
          </box>
        }
      >
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (box = el)}
          flexGrow={1}
          backgroundColor={ui.solidBg}
          stickyScroll={false}
          scrollbarOptions={{
            trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
          }}
        >
          <For each={props.sections}>
            {section => {
              onCleanup(() => anchors.delete(section.key))
              return (
                <box
                  ref={(el: LaidOut) => {
                    if (el) anchors.set(section.key, el)
                  }}
                  width="100%"
                  flexShrink={0}
                >
                  <Show
                    when={section.file}
                    fallback={
                      <box flexShrink={0} backgroundColor={ui.solidBarBg} paddingLeft={1}>
                        <text
                          wrapMode="none"
                          fg={diffStatusColor(section.status)}
                          bg={ui.solidBarBg}
                          content={cut(
                            ` ${diffMark(section.status)} ${section.rel} · binary`,
                            Math.max(8, props.width - 2),
                          )}
                        />
                      </box>
                    }
                  >
                    {(file: Accessor<DiffFile>) => (
                      <DiffView
                        file={file()}
                        mode="inline"
                        variant="section"
                        badge={areaBadge(section.area)}
                        width={props.width}
                        focused={false}
                        blocked={true}
                        onFocus={props.onFocus}
                      />
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}
