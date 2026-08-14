import type { KeyEvent, MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
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
  /** True when the patch was cut at DIFF_MAX_LINES. */
  truncated: boolean
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
  /** Inline or side-by-side, for every section at once — `diffView`. */
  mode: DiffMode
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onToggleMode: () => void
  /** Stage or unstage one file — its `+`/`−`, and Space on its header. */
  onToggleStage: (key: string) => void
  /** False against a comparison base, where there is no index to stage into. */
  staging: boolean
  onClose: () => void
}

interface LaidOut {
  y: number
  height: number
}

export interface StickyHeader {
  index: number
  /** How many rows of the header have been pushed off the top. 0 = fully stuck. */
  clipped: number
}

/**
 * Two rows so the next file can push this header off one row at a time. A
 * one-row header snaps, which is not the sticky bar this page is copying.
 */
export const SECTION_HEADER_ROWS = 2

/** Left column the selection mark occupies. A box border drew `│` in accent,
 * which several palettes put too close to `barBg` to see. A full cell of
 * accent plus `treeSelectedBg` is the pair every other list already uses. */
const HEADER_MARK = 1

/** Frames the first reveal waits for the stack to lay out — half a second. */
const REVEAL_TRIES = 30

/**
 * Frames a re-anchor keeps re-applying itself after the layout flips. The
 * scrollbox clamps an offset against the height it still has, and the sections'
 * new heights land a layout pass later — one shot at it either overshoots or is
 * cut short, and the reader watches the page jump and come back.
 */
const HOLD_FRAMES = 6

/**
 * One frame. The renderables' positions are written by the layout pass, which
 * has not run when the macrotask after a state change fires — re-reading them
 * any sooner than this hands back the geometry from before the change.
 */
const LAYOUT_FRAME = 16

/**
 * Which in-flow header should be mirrored at the top of the viewport.
 * `ys` are content-space y of each header's first row, in section order.
 * Returns null when the in-flow header is already at the top (nothing to pin)
 * or has been fully pushed off by the next one.
 */
export function stickyHeader(scrollTop: number, ys: number[]): StickyHeader | null {
  if (ys.length === 0 || ys.some(y => !Number.isFinite(y))) return null
  let index = -1
  for (let i = 0; i < ys.length; i++) {
    if (ys[i]! <= scrollTop) index = i
    else break
  }
  if (index < 0) return null
  const y = ys[index]!
  if (y >= scrollTop) return null
  let clipped = 0
  const next = ys[index + 1]
  if (next !== undefined) {
    const room = next - scrollTop
    if (room <= 0) return null
    if (room < SECTION_HEADER_ROWS) clipped = SECTION_HEADER_ROWS - room
  }
  return { index, clipped }
}

const areaBadge = (area: ChangeArea) =>
  area === 'unstaged' ? undefined : area === 'merge' ? 'merge' : 'staged'

/** Tail of a path identifies the file — same cut the one-file diff header uses. */
function cutPath(rel: string, room: number): string {
  if (room <= 0) return ''
  if (rel.length <= room) return rel
  return `…${rel.slice(rel.length - room + 1)}`
}

function displayRel(section: ChangeSection): string {
  const oldPath = section.file?.oldPath
  return oldPath && oldPath !== section.rel ? `${oldPath} → ${section.rel}` : section.rel
}

function headerMeta(section: ChangeSection): string {
  if (!section.file) return '  binary'
  const bits = [`+${section.adds} −${section.dels}`]
  const badge = areaBadge(section.area)
  if (badge) bits.push(badge)
  if (section.truncated) bits.push(`first ${DIFF_MAX_LINES} lines`)
  else if (
    section.file.oldText.length + section.file.newText.length > DIFF_HIGHLIGHT_LIMIT ||
    section.lines > DIFF_HIGHLIGHT_MAX_LINES
  ) {
    bits.push('plain (large file)')
  }
  return `  ${bits.join(' · ')}`
}

/**
 * The scrollbox emits no scroll event, so the sticky overlay is refreshed from
 * the renderable's own mouse hook — same override the sidebar lists use.
 */
function watchScroll(el: ScrollBoxRenderable, moved: (top: number) => void) {
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    handle(event)
    moved(el.scrollTop)
  }
}

interface FileHeaderProps {
  section: ChangeSection
  width: number
  collapsed: boolean
  /** `meta` is the counts row alone — the leftover while the next header pushes. */
  part: 'full' | 'meta'
  hovered: boolean
  selected: boolean
  /** Draw the stage button at all — off against a comparison base. */
  staging: boolean
  onToggle: () => void
  onStage: () => void
  onEnter: () => void
  onLeave: () => void
}

function FileHeader(props: FileHeaderProps) {
  const stageHover = useHoverKey<string>()
  const bg = () => (props.selected ? ui.treeSelectedBg : props.hovered ? ui.hoverBg : ui.solidBarBg)
  const mark = () => (props.selected ? ui.accent : bg())
  const label = () => diffStatusLabel(props.section.status)
  const color = () => diffStatusColor(props.section.status)
  const chevron = () => (props.collapsed ? '▸' : '▾')
  const textWidth = () => Math.max(8, props.width - HEADER_MARK)
  const path = () => {
    const word = label()
    const right = word ? ` ${word} ` : ''
    const prefix = ` ${chevron()} ${diffMark(props.section.status)} `
    // The stage button's two columns are held whether or not it is drawn: the
    // path would otherwise grow and shrink as the selection walked past.
    const button = props.staging ? 2 : 0
    const room = Math.max(8, textWidth() - prefix.length - right.length - button)
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
          <text wrapMode="none" fg={mark()} bg={mark()} flexShrink={0} content=" " />
          <text wrapMode="none" fg={ui.dim} bg={bg()} flexShrink={0} content={` ${chevron()} `} />
          <text
            wrapMode="none"
            fg={color()}
            bg={bg()}
            flexShrink={0}
            content={`${diffMark(props.section.status)} `}
          />
          <text wrapMode="none" fg={ui.text} bg={bg()} flexShrink={0} content={path()} />
          <box flexGrow={1} backgroundColor={bg()} />
          <Show when={label()}>
            {(word: Accessor<string>) => (
              <text wrapMode="none" fg={color()} bg={bg()} flexShrink={0} content={` ${word()} `} />
            )}
          </Show>
          {/* Staged files unstage, everything else stages — the panel's `+`/`−`,
              on the file the reader is looking at. Drawn on the selected header
              and under the pointer only, as the panel draws it on the cursor's
              row alone: a terminal has no hover to hide a button behind. Its own
              handler, and it runs before the row's — pressing `+` is not
              pressing the row, which would fold the file away. */}
          <Show when={props.staging && (props.selected || props.hovered)}>
            <box
              flexShrink={0}
              backgroundColor={stageHover.hovered('stage') ? ui.hoverBg : bg()}
              onMouseDown={event => {
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
        <text wrapMode="none" fg={mark()} bg={mark()} flexShrink={0} content=" " />
        <text wrapMode="none" fg={ui.dim} bg={bg()} flexShrink={0} content={meta()} />
        <box flexGrow={1} backgroundColor={bg()} />
      </box>
    </box>
  )
}

/**
 * Every changed file stacked in one scroll, over the editor slot — Cursor's
 * Changes page, sized to a terminal. The source-control panel keeps the list
 * and the commit; this is the reading surface.
 */
export function ChangesView(props: ChangesViewProps) {
  const dimensions = useTerminalDimensions()
  const hover = useHoverKey<string>()
  const [folded, setFolded] = createSignal(new Set<string>())
  const [scrollTop, setScrollTop] = createSignal(0)
  const [pickedKey, setPickedKey] = createSignal<string | null>(null)

  // Bumped when the stack's geometry has moved for a reason `scrollTop` cannot
  // report. `equals: false` so a bump always notifies.
  const [layout, bumpLayout] = createSignal(0, { equals: false })

  let box: ScrollBoxRenderable | undefined
  const anchors = new Map<string, LaidOut>()
  const headers = new Map<string, LaidOut>()
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let modeTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(revealTimer)
    clearTimeout(layoutTimer)
    clearTimeout(modeTimer)
  })

  const syncScroll = () => {
    if (box) setScrollTop(box.scrollTop)
  }

  /**
   * Folding moves every header below it and can shorten the stack enough that
   * the scrollbox clamps its own `scrollTop`. Both are read straight off the
   * renderables and neither is a signal, so the pinned header otherwise keeps
   * the position it had before the fold and is painted a second time over the
   * one now back in flow. The reconciler flushes on a macrotask, so the
   * re-read has to wait one out.
   */
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
    setFolded(cur => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    remeasure()
  }
  const setFold = (key: string, collapse: boolean) => {
    let changed = false
    setFolded(cur => {
      if (cur.has(key) === collapse) return cur
      changed = true
      const next = new Set(cur)
      if (collapse) next.add(key)
      else next.delete(key)
      return next
    })
    if (changed) remeasure()
  }

  const scroll = (delta: number) => {
    // A hold re-applies its offset for a few frames; a reader scrolling inside
    // that window must win, or the page would pull itself back under them.
    clearTimeout(modeTimer)
    if (box) box.scrollTop = Math.max(0, box.scrollTop + delta)
    syncScroll()
  }
  const scrollTo = (row: number) => {
    clearTimeout(modeTimer)
    if (box) box.scrollTop = Math.max(0, row)
    syncScroll()
  }

  /**
   * Put a file at the top of the page. Always, even when it is already on
   * screen: moving onto a change and having the page hold still reads as a key
   * that did nothing, and where a change *starts* is what the reader was asking
   * for. Both pagers land here — the panel's cursor and Tab inside the page.
   */
  const reveal = (key: string) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el) return
    host.scrollTop = el.y - host.y + host.scrollTop
    syncScroll()
  }

  const headerYs = (): number[] => {
    layout()
    const host = box
    if (!host) return []
    return props.sections.map(section => {
      const el = headers.get(section.key)
      if (!el || el.height <= 0) return Number.NaN
      return el.y - host.y + host.scrollTop
    })
  }

  const sticky = createMemo(() => {
    const pin = stickyHeader(scrollTop(), headerYs())
    if (!pin) return null
    const section = props.sections[pin.index]
    if (!section) return null
    return { section, clipped: pin.clipped }
  })

  const currentIndex = () => {
    const ys = headerYs()
    const pin = stickyHeader(scrollTop(), ys)
    if (pin) return pin.index
    for (let i = 0; i < ys.length; i++) {
      if (Number.isFinite(ys[i]) && ys[i]! >= scrollTop()) return i
    }
    const at = props.sections.findIndex(section => section.key === props.focusKey)
    return at >= 0 ? at : 0
  }

  /** Which header ←/→ and Tab talk about. Nothing is marked while the panel
   * still has the keyboard — Tab into the page is what lights one. A memo, not
   * a plain call: every header row asks, and each answer walks all the sections. */
  const selectedKey = createMemo(() => {
    if (!props.focused) return null
    const keys = props.sections.map(section => section.key)
    const picked = pickedKey()
    if (picked && keys.includes(picked)) return picked
    return keys[currentIndex()] ?? null
  })

  const isSelected = (key: string) => selectedKey() === key

  /** The file the reader is on: the header Tab lit, else the panel cursor's. */
  const anchorKey = () => {
    const keys = props.sections.map(section => section.key)
    const picked = pickedKey()
    if (picked && keys.includes(picked)) return picked
    if (props.focusKey && keys.includes(props.focusKey)) return props.focusKey
    return keys[currentIndex()] ?? null
  }

  /**
   * Hold a file at the top of the page across a relayout. Applied at once and
   * again over the next few frames: the first attempt runs before the new
   * heights exist and is clamped to the old ones, and only a later one lands —
   * re-applying an offset that is already right costs nothing and is what keeps
   * the wrong frame from being one the reader sees.
   */
  const holdAt = (key: string) => {
    clearTimeout(modeTimer)
    let tries = HOLD_FRAMES
    const apply = () => {
      reveal(key)
      remeasure()
      if (--tries <= 0) return
      // The first retry is a macrotask, not a frame: when the reconciler has
      // already applied the new heights there is nothing to wait for, and the
      // sooner the offset is right the fewer frames can show it wrong.
      modeTimer = setTimeout(apply, tries === HOLD_FRAMES - 1 ? 0 : LAYOUT_FRAME / 2)
    }
    apply()
  }

  /**
   * Split pairs each change block row for row and pads the shorter side, so
   * every section changes height when the layout flips — a scroll offset kept
   * across that lands on a different file.
   */
  createEffect(
    on(
      () => props.mode,
      () => {
        const key = anchorKey()
        if (key) holdAt(key)
      },
      { defer: true },
    ),
  )

  const moveSelection = (delta: number) => {
    const keys = props.sections.map(section => section.key)
    if (keys.length === 0) return
    const at = Math.max(0, keys.indexOf(selectedKey() ?? keys[0]!))
    const next = keys[(at + delta + keys.length) % keys.length]!
    setPickedKey(next)
    reveal(next)
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
        // Capped: a section that never lays out would otherwise hold a 16ms
        // timer for as long as the page is open.
        let tries = REVEAL_TRIES
        const tryReveal = () => {
          const el = anchors.get(key)
          const first = props.sections[0]?.key === key
          // y stays 0 until layout; treating that as ready scrolled a later
          // file to the top of the stack on first open. Not `y > 0`: a section
          // scrolled off the top of the page has a negative y, and waiting for
          // it to turn positive is waiting forever — which is a click on a file
          // above the one on screen scrolling nowhere.
          const ready = el && box && el.height > 0 && (first || el.y !== 0)
          if (ready) {
            reveal(key)
            return
          }
          if (--tries <= 0) return
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
    else if (k === 'pagedown' || (key.ctrl && k === 'd')) scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'left' || k === 'h') {
      const sel = selectedKey()
      if (sel) setFold(sel, true)
    } else if (k === 'right' || k === 'l') {
      const sel = selectedKey()
      if (sel) setFold(sel, false)
    } else if (k === 'tab') moveSelection(key.shift ? -1 : 1)
    // Tab already walks the file headers here, so the layout gets the two keys
    // the one-file page also answered to.
    else if (k === 's' || k === 'd') props.onToggleMode()
    // Space is the panel's stage key, and it means the same here rather than
    // paging: PgDn and Ctrl+D already page, and nothing else on this side of
    // Tab could stage the file being read.
    else if (k === 'space') {
      const sel = selectedKey()
      if (sel) props.onToggleStage(sel)
    } else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  const summary = () => changesSummary(props.title, props.sections.length, props.meta)

  const hints = () => {
    const layout = props.mode === 'inline' ? 'inline' : 'side-by-side'
    // The page answers to `s`; the panel, which holds the keyboard until Tab is
    // pressed, answers to `S` — plain `s` is sync there. Naming the key that
    // works from where the keyboard actually is, is the whole point of a hint.
    const key = props.focused ? 's' : 'S'
    const stage = props.staging ? ' · Space stage' : ''
    const full = ` ${layout} · ${key} layout${stage} · ↑↓ scroll · Tab file · ← fold · Esc close `
    if (full.length + 28 <= props.width) return full
    const short = ` ${layout} · ${key} · Tab · ← fold · Esc close `
    if (short.length + 28 <= props.width) return short
    return ' Tab · ← fold · Esc close '
  }

  const header = () => {
    const right = hints()
    const room = Math.max(8, props.width - right.length - 1)
    return ` ${cut(summary(), room)}`
  }

  const rule = () => '─'.repeat(inner())

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
        <box flexGrow={1}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => {
              box = el
              watchScroll(el, top => {
                if (top !== scrollTop()) setScrollTop(top)
              })
            }}
            flexGrow={1}
            backgroundColor={ui.solidBg}
            stickyScroll={false}
            scrollbarOptions={{
              trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
            }}
          >
            <For each={props.sections}>
              {section => {
                onCleanup(() => {
                  anchors.delete(section.key)
                  headers.delete(section.key)
                })
                return (
                  <box
                    ref={(el: LaidOut) => {
                      if (el) anchors.set(section.key, el)
                    }}
                    width="100%"
                    flexShrink={0}
                    flexDirection="column"
                  >
                    {/* A blank row on solidBg is invisible — it reads as an empty
                        line of the diff. The rule is what separates one file from
                        the next. */}
                    <text
                      wrapMode="none"
                      fg={ui.border}
                      bg={ui.solidBg}
                      flexShrink={0}
                      content={rule()}
                    />
                    <box
                      ref={(el: LaidOut) => {
                        if (el) headers.set(section.key, el)
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
                          toggleFold(section.key)
                        }}
                        onEnter={() => hover.enter(section.key)}
                        onLeave={() => hover.leave(section.key)}
                      />
                    </box>
                    <Show when={!isFolded(section.key) ? section.file : undefined}>
                      {(file: Accessor<DiffFile>) => (
                        <DiffView
                          file={file()}
                          mode={props.mode}
                          variant="section"
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
    </box>
  )
}
