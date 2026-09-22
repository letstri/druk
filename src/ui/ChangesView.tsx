import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js'
import type { Accessor } from 'solid-js'

import type { ChangeArea } from '../core/git'
import { ui } from '../themes'
import {
  DIFF_HIGHLIGHT_LIMIT,
  DIFF_HIGHLIGHT_MAX_LINES,
  DIFF_MAX_LINES,
  DiffView,
  diffMark,
  diffStatusColor,
  diffStatusLabel,
} from './DiffView'
import type { DiffFile, DiffFileStatus, DiffMode } from './DiffView'
import { useHoverKey } from './hover'
import {
  followScroll,
  LAYOUT_FRAME,
  retryFrames,
  scrollbarOptions,
} from './list'
import { Page } from './PanelHeader'
import { cut } from './text'
import { useKeys } from './useKeys'

export interface ChangeSection {
  // `${area}:${path}`: one path can sit under both headings.
  key: string
  rel: string
  area: ChangeArea
  status: DiffFileStatus
  file: DiffFile | null
  lines: number
  adds: number
  dels: number
  truncated: boolean
}

export interface ChangesMeta {
  total: number
  adds: number
  dels: number
}

export function changesSummary(
  title: string,
  shown: number,
  meta: ChangesMeta
): string {
  const counts = `+${meta.adds} −${meta.dels}`
  if (meta.total > shown) {
    return `${title} · showing ${shown} of ${meta.total} files · ${counts}`
  }
  return `${title} · ${meta.total} files · ${counts}`
}

interface ChangesViewProps {
  sections: ChangeSection[]
  meta: ChangesMeta
  focusKey: string | null
  title: string
  mode: DiffMode
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onToggleMode: () => void
  onToggleStage: (key: string) => void
  onOpen: (key: string, line: number | null) => void
  staging: boolean
  escLabel?: string
  onClose: () => void
}

interface LaidOut {
  y: number
  height: number
}

export interface StickyHeader {
  index: number
  // Rows of the header pushed off the top; 0 = fully stuck.
  clipped: number
}

const SECTION_HEADER_ROWS = 2

const HEADER_MARK = 1

const REVEAL_TRIES = 30

// Frames a re-anchor keeps re-applying: the scrollbox clamps against the height it still has.
const HOLD_FRAMES = 6

// `ys`: content-space y of each header's first row, in section order. Null when nothing pins.
export function stickyHeader(
  scrollTop: number,
  ys: number[]
): StickyHeader | null {
  if (ys.length === 0 || ys.some((y) => !Number.isFinite(y))) {
    return null
  }
  let index = -1
  for (let i = 0; i < ys.length; i += 1) {
    if (ys[i]! <= scrollTop) {
      index = i
    } else {
      break
    }
  }
  if (index < 0) {
    return null
  }
  const y = ys[index]!
  if (y >= scrollTop) {
    return null
  }
  let clipped = 0
  const next = ys[index + 1]
  if (next !== undefined) {
    const room = next - scrollTop
    if (room <= 0) {
      return null
    }
    if (room < SECTION_HEADER_ROWS) {
      clipped = SECTION_HEADER_ROWS - room
    }
  }
  return { clipped, index }
}

const areaBadge = (area: ChangeArea) =>
  area === 'unstaged' ? undefined : area === 'merge' ? 'merge' : 'staged'

function cutPath(rel: string, room: number): string {
  if (room <= 0) {
    return ''
  }
  if (rel.length <= room) {
    return rel
  }
  return `…${rel.slice(rel.length - room + 1)}`
}

function displayRel(section: ChangeSection): string {
  const oldPath = section.file?.oldPath
  return oldPath && oldPath !== section.rel
    ? `${oldPath} → ${section.rel}`
    : section.rel
}

function headerMeta(section: ChangeSection): string {
  if (!section.file) {
    return '  binary'
  }
  const bits = [`+${section.adds} −${section.dels}`]
  const badge = areaBadge(section.area)
  if (badge) {
    bits.push(badge)
  }
  if (section.truncated) {
    bits.push(`first ${DIFF_MAX_LINES} lines`)
  } else if (
    section.file.oldText.length + section.file.newText.length >
      DIFF_HIGHLIGHT_LIMIT ||
    section.lines > DIFF_HIGHLIGHT_MAX_LINES
  ) {
    bits.push('plain (large file)')
  }
  return `  ${bits.join(' · ')}`
}

interface FileHeaderProps {
  section: ChangeSection
  width: number
  collapsed: boolean
  part: 'full' | 'meta'
  hovered: boolean
  selected: boolean
  staging: boolean
  onToggle: () => void
  onStage: () => void
  onEnter: () => void
  onLeave: () => void
}

function FileHeader(props: FileHeaderProps) {
  const stageHover = useHoverKey<string>()
  const bg = () =>
    props.selected
      ? ui.treeSelectedBg
      : props.hovered
        ? ui.hoverBg
        : ui.solidBarBg
  const mark = () => (props.selected ? ui.accent : bg())
  const label = () => diffStatusLabel(props.section.status)
  const color = () => diffStatusColor(props.section.status)
  const chevron = () => (props.collapsed ? '▸' : '▾')
  const textWidth = () => Math.max(8, props.width - HEADER_MARK)
  const path = () => {
    const word = label()
    const right = word ? ` ${word} ` : ''
    const prefix = ` ${chevron()} ${diffMark(props.section.status)} `
    // Held whether or not the button is drawn, or the path jumps as the selection walks past.
    const button = props.staging ? 2 : 0
    const room = Math.max(
      8,
      textWidth() - prefix.length - right.length - button
    )
    return cutPath(displayRel(props.section), room)
  }
  const meta = () => cut(headerMeta(props.section), textWidth())

  return (
    <box flexShrink={0} flexDirection="column" backgroundColor={bg()}>
      <Show when={props.part === 'full'}>
        <box
          height={1}
          flexDirection="row"
          flexShrink={0}
          backgroundColor={bg()}
          onMouseDown={() => props.onToggle()}
          onMouseOver={() => props.onEnter()}
          onMouseOut={() => props.onLeave()}
        >
          <text
            wrapMode="none"
            fg={mark()}
            bg={mark()}
            flexShrink={0}
            content=" "
          />
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={bg()}
            flexShrink={0}
            content={` ${chevron()} `}
          />
          <text
            wrapMode="none"
            fg={color()}
            bg={bg()}
            flexShrink={0}
            content={`${diffMark(props.section.status)} `}
          />
          <text
            wrapMode="none"
            fg={ui.text}
            bg={bg()}
            flexShrink={0}
            content={path()}
          />
          <box flexGrow={1} backgroundColor={bg()} />
          <Show when={label()}>
            {(word: Accessor<string>) => (
              <text
                wrapMode="none"
                fg={color()}
                bg={bg()}
                flexShrink={0}
                content={` ${word()} `}
              />
            )}
          </Show>
          {/* stopPropagation: a press on `+` must not reach the row, which would fold the file. */}
          <Show when={props.staging && (props.selected || props.hovered)}>
            <box
              flexShrink={0}
              backgroundColor={stageHover.hovered('stage') ? ui.hoverBg : bg()}
              onMouseDown={(event) => {
                event.stopPropagation()
                props.onStage()
              }}
              onMouseOver={() => stageHover.enter('stage')}
              onMouseOut={() => stageHover.leave('stage')}
            >
              <text
                wrapMode="none"
                fg={ui.accent}
                bg={stageHover.hovered('stage') ? ui.hoverBg : bg()}
                content={`${props.section.area === 'staged' ? '−' : '+'} `}
              />
            </box>
          </Show>
        </box>
      </Show>
      <box
        height={1}
        flexDirection="row"
        flexShrink={0}
        backgroundColor={bg()}
        onMouseDown={() => props.onToggle()}
        onMouseOver={() => props.onEnter()}
        onMouseOut={() => props.onLeave()}
      >
        <text
          wrapMode="none"
          fg={mark()}
          bg={mark()}
          flexShrink={0}
          content=" "
        />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={bg()}
          flexShrink={0}
          content={meta()}
        />
        <box flexGrow={1} backgroundColor={bg()} />
      </box>
    </box>
  )
}

export function ChangesView(props: ChangesViewProps) {
  const dimensions = useTerminalDimensions()
  const hover = useHoverKey<string>()
  const [folded, setFolded] = createSignal(new Set<string>())
  const [scrollTop, setScrollTop] = createSignal(0)
  const [pickedKey, setPickedKey] = createSignal<string | null>(null)
  const [pickedLine, setPickedLine] = createSignal<number | null>(null)

  // Bumped when the stack's geometry moved for a reason `scrollTop` cannot report.
  const [layout, bumpLayout] = createSignal(0, { equals: false })

  let box: ScrollBoxRenderable | undefined
  const anchors = new Map<string, LaidOut>()
  const headers = new Map<string, LaidOut>()
  // Not a signal: never read while rendering.
  let drifted = false
  let cancelReveal: (() => void) | null = null
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let cancelHold: (() => void) | null = null
  onCleanup(() => {
    cancelReveal?.()
    clearTimeout(layoutTimer)
    cancelHold?.()
  })

  const syncScroll = () => {
    if (box) {
      setScrollTop(box.scrollTop)
    }
  }

  // Read off renderables, not signals: the reconciler flushes on a macrotask, so wait one out.
  const remeasure = () => {
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      syncScroll()
      bumpLayout(0)
    }, LAYOUT_FRAME)
  }

  const inner = () => Math.max(1, props.width - 1)
  const isFolded = (key: string) => folded().has(key)
  const toggleFold = (key: string) => {
    setFolded((cur) => {
      const next = new Set(cur)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    remeasure()
  }
  const setFold = (key: string, collapse: boolean) => {
    let changed = false
    setFolded((cur) => {
      if (cur.has(key) === collapse) {
        return cur
      }
      changed = true
      const next = new Set(cur)
      if (collapse) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
    if (changed) {
      remeasure()
    }
  }

  const scroll = (delta: number) => {
    cancelHold?.()
    drifted = true
    if (box) {
      box.scrollTop = Math.max(0, box.scrollTop + delta)
    }
    syncScroll()
  }
  const scrollTo = (row: number) => {
    cancelHold?.()
    drifted = true
    if (box) {
      box.scrollTop = Math.max(0, row)
    }
    syncScroll()
  }

  const reveal = (key: string, into = 0) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el) {
      return
    }
    host.scrollTop =
      el.y - host.y + host.scrollTop + Math.round(into * el.height)
    drifted = into > 0
    syncScroll()
  }

  // A share of the section's height, not rows: split pads every block, so rows do not survive a flip.
  const offsetIn = (key: string) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el || el.height <= 0) {
      return 0
    }
    const y = el.y - host.y + host.scrollTop
    return Math.min(1, Math.max(0, (scrollTop() - y) / el.height))
  }

  const headerYs = (): number[] => {
    layout()
    const host = box
    if (!host) {
      return []
    }
    return props.sections.map((section) => {
      const el = headers.get(section.key)
      if (!el || el.height <= 0) {
        return Number.NaN
      }
      return el.y - host.y + host.scrollTop
    })
  }

  const sticky = createMemo(() => {
    const pin = stickyHeader(scrollTop(), headerYs())
    if (!pin) {
      return null
    }
    const section = props.sections[pin.index]
    if (!section) {
      return null
    }
    return { clipped: pin.clipped, section }
  })

  const currentIndex = () => {
    const ys = headerYs()
    const pin = stickyHeader(scrollTop(), ys)
    if (pin) {
      return pin.index
    }
    for (let i = 0; i < ys.length; i += 1) {
      if (Number.isFinite(ys[i]) && ys[i]! >= scrollTop()) {
        return i
      }
    }
    const at = props.sections.findIndex(
      (section) => section.key === props.focusKey
    )
    return at === -1 ? 0 : at
  }

  const selectedKey = createMemo(() => {
    if (!props.focused) {
      return null
    }
    const keys = props.sections.map((section) => section.key)
    const picked = pickedKey()
    if (picked && keys.includes(picked)) {
      return picked
    }
    return keys[currentIndex()] ?? null
  })

  const isSelected = (key: string) => selectedKey() === key

  // Not `currentIndex()`: measured off renderables, a layout pass behind the offset it set.
  const anchorKey = () => {
    const keys = props.sections.map((section) => section.key)
    if (!drifted) {
      const picked = pickedKey()
      if (picked && keys.includes(picked)) {
        return picked
      }
      if (props.focusKey && keys.includes(props.focusKey)) {
        return props.focusKey
      }
    }
    return keys[currentIndex()] ?? null
  }

  // Re-applied over the next frames: the first attempt is clamped to the old heights.
  const holdAt = (key: string, into = 0) => {
    cancelHold?.()
    cancelHold = retryFrames(
      () => {
        reveal(key, into)
        remeasure()
        return false
      },
      { delay: LAYOUT_FRAME / 2, tries: HOLD_FRAMES }
    )
  }

  createEffect(
    on(
      () => props.mode,
      () => {
        const key = anchorKey()
        // Read before the flip lays out — the heights the reader's offset was measured against.
        if (key) {
          holdAt(key, offsetIn(key))
        }
      },
      { defer: true }
    )
  )

  const moveSelection = (delta: number) => {
    const keys = props.sections.map((section) => section.key)
    if (keys.length === 0) {
      return
    }
    const at = Math.max(0, keys.indexOf(selectedKey() ?? keys[0]!))
    const next = keys[(at + delta + keys.length) % keys.length]!
    setPickedKey(next)
    setPickedLine(null)
    // A walk outranks the reveal hold below.
    cancelReveal?.()
    reveal(next)
  }

  // A memo, not a plain accessor: `on` re-runs its body whenever a dependency notifies,
  // so a refresh rebuilding the same sections would yank the scroll back to the cursor's file.
  const revealTarget = createMemo(
    () =>
      `${props.focusKey ?? ''}\n${props.sections.map((s) => s.key).join('\n')}`
  )

  createEffect(
    on(revealTarget, () => {
      const key = props.focusKey
      if (!key || !props.sections.some((s) => s.key === key)) {
        return
      }
      cancelReveal?.()
      cancelReveal = retryFrames(
        () => {
          const el = anchors.get(key)
          const first = props.sections[0]?.key === key
          // y is 0 before layout and negative when scrolled off the top: neither is ready.
          if (!el || !box || el.height <= 0 || (!first && el.y === 0)) {
            return false
          }
          reveal(key)
          // The first file is the top of the page, which nothing above it can move. Any
          // other one is pushed down as the files above land their rows with their
          // highlights, so the hold re-applies for its whole budget.
          return first
        },
        { tries: REVEAL_TRIES }
      )
    })
  )

  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    if (props.blocked || !props.focused || key.defaultPrevented) {
      return
    }
    if (k === 'up' || k === 'k') {
      scroll(-1)
    } else if (k === 'down' || k === 'j') {
      scroll(1)
    } else if (k === 'pageup' || (key.ctrl && k === 'u')) {
      scroll(-page())
    } else if (k === 'pagedown' || (key.ctrl && k === 'd')) {
      scroll(page())
    } else if (k === 'end' || (k === 'g' && key.shift)) {
      scrollTo(Number.MAX_SAFE_INTEGER)
    } else if (k === 'home' || k === 'g') {
      scrollTo(0)
    } else if (k === 'left' || k === 'h') {
      const sel = selectedKey()
      if (sel) {
        setFold(sel, true)
      }
    } else if (k === 'right' || k === 'l') {
      const sel = selectedKey()
      if (sel) {
        setFold(sel, false)
      }
    } else if (k === 'tab') {
      moveSelection(key.shift ? -1 : 1)
    } else if (k === 's' || k === 'd') {
      props.onToggleMode()
    } else if (k === 'space') {
      const sel = selectedKey()
      if (sel) {
        props.onToggleStage(sel)
      }
    } else if (k === 'return' || k === 'enter') {
      const sel = selectedKey()
      if (sel) {
        props.onOpen(sel, sel === pickedKey() ? pickedLine() : null)
      }
    } else if (k === 'escape' || k === 'q') {
      props.onClose()
    } else {
      return
    }
    key.preventDefault()
  })

  const summary = () =>
    changesSummary(props.title, props.sections.length, props.meta)

  const hints = () => {
    const mode = props.mode === 'inline' ? 'inline' : 'side-by-side'
    const key = props.focused ? 's' : 'S'
    const stage = props.staging ? ' · Space stage' : ''
    const esc = `Esc ${props.escLabel ?? 'close'}`
    const full = ` ${mode} · ${key} layout${stage} · Tab file · Enter open · ← fold · ${esc} `
    if (full.length + 28 <= props.width) {
      return full
    }
    const short = ` ${mode} · ${key} · Tab · Enter open · ← fold · ${esc} `
    if (short.length + 28 <= props.width) {
      return short
    }
    return ` Tab · Enter open · ${esc} `
  }

  const header = () => {
    const right = hints()
    const room = Math.max(8, props.width - right.length - 1)
    return ` ${cut(summary(), room)}`
  }

  return (
    <Page title={header()} hints={hints()} onFocus={props.onFocus}>
      <Show
        when={props.sections.length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={2} paddingTop={1}>
            <text fg={ui.dim} content="No file changes." />
          </box>
        }
      >
        <box flexGrow={1}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => {
              box = el
              followScroll(el, (top) => {
                if (top === scrollTop()) {
                  return
                }
                drifted = true
                setScrollTop(top)
              })
            }}
            flexGrow={1}
            backgroundColor={ui.solidBg}
            stickyScroll={false}
            scrollbarOptions={scrollbarOptions(ui.solidBg)}
          >
            <For each={props.sections}>
              {(section) => {
                onCleanup(() => {
                  anchors.delete(section.key)
                  headers.delete(section.key)
                })
                return (
                  <box
                    ref={(el: LaidOut) => {
                      if (el) {
                        anchors.set(section.key, el)
                      }
                    }}
                    width="100%"
                    flexShrink={0}
                    flexDirection="column"
                  >
                    <box
                      ref={(el: LaidOut) => {
                        if (el) {
                          headers.set(section.key, el)
                        }
                      }}
                      flexShrink={0}
                    >
                      <FileHeader
                        section={section}
                        width={inner()}
                        collapsed={isFolded(section.key)}
                        part="full"
                        hovered={hover.hovered(section.key)}
                        selected={isSelected(section.key)}
                        staging={props.staging}
                        onStage={() => {
                          setPickedKey(section.key)
                          props.onToggleStage(section.key)
                        }}
                        onToggle={() => {
                          setPickedKey(section.key)
                          setPickedLine(null)
                          toggleFold(section.key)
                        }}
                        onEnter={() => hover.enter(section.key)}
                        onLeave={() => hover.leave(section.key)}
                      />
                    </box>
                    <Show
                      when={isFolded(section.key) ? undefined : section.file}
                    >
                      {(file: Accessor<DiffFile>) => (
                        <DiffView
                          file={file()}
                          mode={props.mode}
                          variant="section"
                          width={props.width}
                          focused={false}
                          blocked={true}
                          onFocus={props.onFocus}
                          onPickLine={(line) => {
                            setPickedKey(section.key)
                            setPickedLine(line)
                          }}
                        />
                      )}
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>
          <Show when={sticky()}>
            {(pin: Accessor<NonNullable<ReturnType<typeof sticky>>>) => (
              <box
                position="absolute"
                top={0}
                left={0}
                width={inner()}
                height={SECTION_HEADER_ROWS - pin().clipped}
                zIndex={2}
                flexShrink={0}
              >
                <FileHeader
                  section={pin().section}
                  width={inner()}
                  collapsed={isFolded(pin().section.key)}
                  part={pin().clipped > 0 ? 'meta' : 'full'}
                  hovered={hover.hovered(pin().section.key)}
                  selected={isSelected(pin().section.key)}
                  staging={props.staging}
                  onStage={() => {
                    setPickedKey(pin().section.key)
                    props.onToggleStage(pin().section.key)
                  }}
                  onToggle={() => {
                    setPickedKey(pin().section.key)
                    toggleFold(pin().section.key)
                  }}
                  onEnter={() => hover.enter(pin().section.key)}
                  onLeave={() => hover.leave(pin().section.key)}
                />
              </box>
            )}
          </Show>
        </box>
      </Show>
    </Page>
  )
}
