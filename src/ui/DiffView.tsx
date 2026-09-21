import type { DiffRenderable, KeyEvent, TreeSitterClient } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'

import { unifiedDiff } from '../core/diff'
import type { UnifiedDiff } from '../core/diff'
import type { ComparisonFileStatus, FileStatus } from '../core/git'
import {
  computeHighlights,
  DIFF_FILLER,
  filetypeForPath,
  getSyntaxStyle,
  highlightClient,
  STALE,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { allowSelectionIn } from './selection'
import { useKeys } from './useKeys'

export type DiffMode = 'inline' | 'split'
export type DiffFileStatus = FileStatus | ComparisonFileStatus

export interface DiffFile {
  path: string
  rel: string
  oldPath?: string | null
  status: DiffFileStatus
  oldText: string
  newText: string
}

interface DiffViewProps {
  file: DiffFile
  mode: DiffMode
  variant?: 'page' | 'section'
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onToggleMode?: () => void
  onClose?: () => void
  onMoveFile?: (delta: number) => void
  onPickLine?: (line: number | null) => void
  escLabel?: string
}

// Bytes across both sides: one native span edit per capture stalls on a package-lock (#66).
export const DIFF_HIGHLIGHT_LIMIT = 1024 * 1024

export const DIFF_HIGHLIGHT_MAX_LINES = 1000

export const DIFF_MAX_LINES = 10_000

export function diffMark(status: DiffFileStatus): string {
  if (status === 'renamed') {
    return 'R'
  }
  if (status === 'copied') {
    return 'C'
  }
  if (status === 'typeChanged') {
    return 'T'
  }
  return MARKS[status]
}

export function diffStatusLabel(status: DiffFileStatus): string | undefined {
  if (status === 'added' || status === 'untracked') {
    return 'new'
  }
  if (status === 'deleted') {
    return 'deleted'
  }
  if (status === 'renamed') {
    return 'renamed'
  }
  if (status === 'copied') {
    return 'copied'
  }
  if (status === 'typeChanged') {
    return 'type'
  }
  return undefined
}

export function diffStatusColor(status: DiffFileStatus): string {
  if (
    status === 'added' ||
    status === 'untracked' ||
    status === 'deleted' ||
    status === 'modified'
  ) {
    return statusColor(status)
  }
  return statusColor('modified')
}

function blend(color: string, base: string, amount: number): string {
  const rgb = (hex: string): number[] | null =>
    /^#[0-9a-f]{6}$/iu.test(hex)
      ? [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
      : null
  const from = rgb(color)
  const to = rgb(base)
  if (!from || !to) {
    return base
  }
  const mix = (i: number) =>
    Math.round(from[i]! * amount + to[i]! * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

export const HATCH = '╱'

const onlyHatch = new RegExp(`^${HATCH}+$`, 'u')

// `[startOffset, endOffset, captureGroup]` in the pane document's coordinates.
type PaneHighlight = [number, number, string]

// A reused pane keeps its filetype: a pass under it must land as "no spans", not raw captures.
const NO_HIGHLIGHTS: OnHighlight = () => Promise.resolve([])

type OnHighlight = (
  given: PaneHighlight[],
  context: { content: string }
) => Promise<PaneHighlight[] | undefined>

interface CodePane {
  x: number
  y: number
  scrollY: number
  maxScrollY: number
  isDestroyed: boolean
  width: number
  content: string
  filetype: string | undefined
  onHighlight?: OnHighlight
}

// Private upstream: the panes inside the `<diff>` renderable.
interface DiffSides {
  leftCodeRenderable?: CodePane | null
  rightCodeRenderable?: CodePane | null
}

interface LineRef {
  side: 'old' | 'new'
  line: number
}

// Replays exactly how the `<diff>` renderable assembles its panes; a null is split's padding row.
function paneLines(patch: string, view: 'unified' | 'split') {
  const left: (LineRef | null)[] = []
  const right: (LineRef | null)[] = []
  const lines = patch.split('\n')
  let at = 0
  let oldLine = 0
  let newLine = 0
  while (at < lines.length) {
    const header = lines[at]!.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/u)
    at += 1
    if (!header) {
      continue
    }
    oldLine = Math.max(0, Number(header[1]) - 1)
    newLine = Math.max(0, Number(header[2]) - 1)
    while (at < lines.length && !lines[at]!.startsWith('@@')) {
      const [mark] = lines[at]!
      if (mark === ' ') {
        if (view === 'split') {
          left.push({ line: oldLine, side: 'old' })
          right.push({ line: newLine, side: 'new' })
        } else {
          left.push({ line: newLine, side: 'new' })
        }
        oldLine += 1
        newLine += 1
        at += 1
      } else if (mark === '-' || mark === '+') {
        const dels: LineRef[] = []
        const adds: LineRef[] = []
        while (
          at < lines.length &&
          (lines[at]![0] === '-' || lines[at]![0] === '+')
        ) {
          if (lines[at]![0] === '-') {
            dels.push({ line: oldLine, side: 'old' })
            oldLine += 1
          } else {
            adds.push({ line: newLine, side: 'new' })
            newLine += 1
          }
          at += 1
        }
        if (view === 'split') {
          for (let i = 0; i < Math.max(dels.length, adds.length); i += 1) {
            left.push(dels[i] ?? null)
            right.push(adds[i] ?? null)
          }
        } else {
          left.push(...dels, ...adds)
        }
      } else {
        at += 1
      }
    }
  }
  return { left, right }
}

/** The new-side line a reader landing in this file wants: the first one that differs. */
export function firstChangedLine(file: DiffFile): number {
  const old = file.oldText.split('\n')
  const now = file.newText.split('\n')
  let at = 0
  while (at < old.length && at < now.length && old[at] === now[at]) {
    at += 1
  }
  return Math.min(at, Math.max(0, now.length - 1))
}

export function DiffView(props: DiffViewProps) {
  const dimensions = useTerminalDimensions()

  // `<diff>` takes its client at construction only; a default would spin up a grammarless second one.
  const [client, setClient] = createSignal<
    TreeSitterClient | null | undefined
  >()
  onMount(async () => {
    setClient(await highlightClient())
  })

  let pane: DiffRenderable | undefined

  // The deferred attach must not fire after the page is gone (#70).
  let attachTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(attachTimer))

  // The ref is never called back on removal: every accessor on a destroyed pane throws.
  const livePane = () => {
    if (pane?.isDestroyed) {
      pane = undefined
    }
    return pane
  }

  const sides = () => {
    const host = livePane() as unknown as DiffSides | undefined
    return [host?.leftCodeRenderable, host?.rightCodeRenderable].filter(
      (side): side is CodePane =>
        side !== null && side !== undefined && !side.isDestroyed
    )
  }

  // Fragment parses lose captures to error recovery: full documents are highlighted and remapped.
  // Cached by content, and per pane/view: a new identity re-runs the `diff` setter and the pass.
  interface Derived {
    diff: UnifiedDiff
    highlighter: (
      which: 'left' | 'right',
      view: 'unified' | 'split'
    ) => OnHighlight
  }
  const derivedCache = new Map<string, { file: DiffFile; value: Derived }>()
  const DERIVED_CACHE_LIMIT = 4

  const current = createMemo((): Derived => {
    const f = props.file
    const hit = derivedCache.get(f.path)
    if (
      hit &&
      (hit.file === f ||
        (hit.file.oldText === f.oldText && hit.file.newText === f.newText))
    ) {
      return hit.value
    }
    const diff = unifiedDiff(f.rel, f.oldText, f.newText, DIFF_MAX_LINES)

    const docs = new Map<string, Promise<Highlighted | null>>()
    const fullDoc = (side: 'old' | 'new') => {
      let doc = docs.get(side)
      if (!doc) {
        doc = (async () => {
          const result = await computeHighlights(
            side === 'old' ? f.oldText : f.newText,
            filetypeForPath(f.path)
          )
          return result === STALE ? null : result
        })()
        docs.set(side, doc)
      }
      return doc
    }

    const cbCache = new Map<string, OnHighlight>()
    const highlighter = (
      which: 'left' | 'right',
      view: 'unified' | 'split'
    ): OnHighlight => {
      const key = `${view}:${which}`
      const cached = cbCache.get(key)
      if (cached) {
        return cached
      }
      const cb: OnHighlight = async (_given, context) => {
        const refs = paneLines(diff.patch, view)[which]
        const [oldDoc, newDoc] = await Promise.all([
          fullDoc('old'),
          fullDoc('new'),
        ])

        const paneStarts = [0]
        for (let i = 0; i < context.content.length; i += 1) {
          if (context.content.codePointAt(i) === 10) {
            paneStarts.push(i + 1)
          }
        }
        const bySource = {
          new: new Map<number, number[]>(),
          old: new Map<number, number[]>(),
        }
        for (const [paneLine, ref] of refs.entries()) {
          if (!ref) {
            continue
          }
          const rows = bySource[ref.side].get(ref.line)
          if (rows) {
            rows.push(paneLine)
          } else {
            bySource[ref.side].set(ref.line, [paneLine])
          }
        }

        const out: PaneHighlight[] = []
        for (const [paneLine, ref] of refs.entries()) {
          if (ref) {
            continue
          }
          const from = paneStarts[paneLine]!
          const to =
            paneLine + 1 < paneStarts.length
              ? paneStarts[paneLine + 1]! - 1
              : context.content.length
          if (to > from) {
            out.push([from, to, DIFF_FILLER])
          }
        }
        // Per-line buckets: a small change in a big file is a few rows against 10^5 captures.
        const emit = (doc: Highlighted | null, side: 'old' | 'new') => {
          if (!doc || bySource[side].size === 0) {
            return
          }
          const paint = (
            capture: { start: number; end: number; group: string },
            lineStart: number,
            lineEnd: number,
            rows: number[]
          ) => {
            // Guides carry a background fill that would stamp over the diff's.
            if (capture.group === 'indent.guide') {
              return
            }
            const from = Math.max(capture.start, lineStart)
            const to = Math.min(capture.end, lineEnd)
            if (to <= from) {
              return
            }
            for (const paneLine of rows) {
              const base = paneStarts[paneLine]!
              out.push([
                base + (from - lineStart),
                base + (to - lineStart),
                capture.group,
              ])
            }
          }
          for (const [line, rows] of bySource[side]) {
            if (line >= doc.starts.length) {
              continue
            }
            const lineStart = doc.starts[line]!
            const lineEnd =
              line + 1 < doc.starts.length
                ? doc.starts[line + 1]! - 1
                : doc.content.length
            const bucket = doc.byLine[line] ?? []
            const wides = doc.wide.filter(
              (w) => w.start < lineEnd && w.end > lineStart
            )
            if (wides.length === 0) {
              for (const capture of bucket) {
                paint(capture, lineStart, lineEnd, rows)
              }
              continue
            }
            let b = 0
            let w = 0
            while (b < bucket.length || w < wides.length) {
              const takeWide =
                b >= bucket.length ||
                (w < wides.length && wides[w]!.ord < bucket[b]!.ord)
              const next = takeWide ? wides[w]! : bucket[b]!
              if (takeWide) {
                w += 1
              } else {
                b += 1
              }
              paint(next, lineStart, lineEnd, rows)
            }
          }
        }
        emit(oldDoc, 'old')
        emit(newDoc, 'new')
        return out
      }
      cbCache.set(key, cb)
      return cb
    }

    const value: Derived = { diff, highlighter }
    derivedCache.delete(f.path)
    derivedCache.set(f.path, { file: f, value })
    while (derivedCache.size > DERIVED_CACHE_LIMIT) {
      derivedCache.delete(derivedCache.keys().next().value!)
    }
    return value
  })

  const diff = () => current().diff

  const plain = createMemo(() => {
    const f = props.file
    return (
      f.oldText.length + f.newText.length > DIFF_HIGHLIGHT_LIMIT ||
      current().diff.lines > DIFF_HIGHLIGHT_MAX_LINES
    )
  })

  const oneSided = () => props.file.oldText === '' || props.file.newText === ''
  const section = () => props.variant === 'section'
  const mode = (): DiffMode => (oneSided() ? 'inline' : props.mode)

  // Split pads the shorter side of each block, so it is taller than the unified patch's row count.
  const sectionRows = () =>
    mode() === 'split'
      ? Math.max(1, paneLines(diff().patch, 'split').left.length)
      : Math.max(1, diff().lines)

  // `setLineColor` cannot put text in a padding row; exact only because `wrapMode` is `none`.
  const paintHatch = (host: DiffSides, view: 'unified' | 'split') => {
    if (view !== 'split') {
      return
    }
    const refs = paneLines(diff().patch, 'split')
    for (const [which, code] of [
      ['left', host.leftCodeRenderable],
      ['right', host.rightCodeRenderable],
    ] as const) {
      if (!code || code.isDestroyed) {
        continue
      }
      // Not `code.width`: it is a layout behind, and a bar cut short stays that length for good.
      const bar = HATCH.repeat(Math.max(1, props.width))
      const lines = code.content.split('\n')
      let hatched = false
      for (const [row, ref] of refs[which].entries()) {
        const line = lines[row]
        if (ref || line === undefined || line === bar) {
          continue
        }
        if (line !== '' && !onlyHatch.test(line)) {
          continue
        }
        lines[row] = bar
        hatched = true
      }
      if (hatched) {
        code.content = lines.join('\n')
      }
    }
  }

  // A tick after the renderable's microtask rebuild; theme and width are read, both rebuild panes.
  createEffect(
    on(
      [
        current,
        mode,
        client,
        () => props.width,
        () => ui.dim,
        () => ui.solidBg,
      ],
      () => {
        const { highlighter } = current()
        const view = mode() === 'split' ? 'split' : 'unified'
        clearTimeout(attachTimer)
        attachTimer = setTimeout(() => {
          attachTimer = undefined
          const host = livePane() as unknown as DiffSides | undefined
          if (!host) {
            return
          }
          for (const [which, code] of [
            ['left', host.leftCodeRenderable],
            ['right', host.rightCodeRenderable],
          ] as const) {
            if (!code || code.isDestroyed) {
              continue
            }
            if (plain()) {
              // A reused pane keeps the previous change's filetype; clearing it is what stops the parse.
              code.filetype = undefined
              code.onHighlight = NO_HIGHLIGHTS
            } else {
              code.onHighlight = highlighter(which, view)
            }
          }
          paintHatch(host, view)
        }, 0)
      }
    )
  )
  // Split's panes are row-aligned by construction, so the right one answers a click on either.
  const lineAtPoint = (y: number): number | null => {
    const host = livePane() as unknown as DiffSides | undefined
    const code = host?.leftCodeRenderable
    if (!host || !code || code.isDestroyed) {
      return null
    }
    const view = mode() === 'split' ? 'split' : 'unified'
    const refs = paneLines(diff().patch, view)
    const list = view === 'split' ? refs.right : refs.left
    const row = y - code.y + code.scrollY
    for (let at = Math.max(0, row); at < list.length; at += 1) {
      if (list[at]?.side === 'new') {
        return list[at]!.line
      }
    }
    // A deletion at the end of the file has no new line after it.
    for (let at = Math.min(row, list.length) - 1; at >= 0; at -= 1) {
      if (list[at]?.side === 'new') {
        return list[at]!.line
      }
    }
    return null
  }

  const scroll = (delta: number) => {
    for (const side of sides()) {
      side.scrollY = Math.max(
        0,
        Math.min(side.maxScrollY, side.scrollY + delta)
      )
    }
  }
  const scrollTo = (row: number) => {
    for (const side of sides()) {
      side.scrollY = Math.max(0, Math.min(side.maxScrollY, row))
    }
  }

  // Keyed on the path, not the file: a refresh rebuilds the same change on every save.
  createEffect(
    on([() => props.file.path, mode], () => scrollTo(0), { defer: true })
  )

  // Tabs, header and status bar off.
  const page = () => Math.max(1, dimensions().height - 3)

  useKeys((key: KeyEvent, k: string) => {
    if (section() || props.blocked || !props.focused || key.defaultPrevented) {
      return
    }
    if (k === 'up' || k === 'k') {
      scroll(-1)
    } else if (k === 'down' || k === 'j') {
      scroll(1)
    } else if (k === 'left' && props.onMoveFile) {
      props.onMoveFile(-1)
    } else if (k === 'right' && props.onMoveFile) {
      props.onMoveFile(1)
    } else if (k === 'pageup' || (key.ctrl && k === 'u')) {
      scroll(-page())
    } else if (k === 'pagedown' || k === 'space' || (key.ctrl && k === 'd')) {
      scroll(page())
    } else if (k === 'end' || (k === 'g' && key.shift)) {
      scrollTo(Number.MAX_SAFE_INTEGER)
    } else if (k === 'home' || k === 'g') {
      scrollTo(0)
    } else if (k === 'tab' || k === 's' || k === 'd') {
      if (!oneSided()) {
        props.onToggleMode?.()
      }
    } else if (k === 'escape' || k === 'q') {
      props.onClose?.()
    } else {
      return
    }
    key.preventDefault()
  })

  const hints = () => {
    if (section()) {
      return ''
    }
    const layout = mode() === 'inline' ? 'inline' : 'side-by-side'
    if (oneSided()) {
      const full = ` ${layout} · Esc ${props.escLabel ?? 'close'} `
      return full.length + 28 <= props.width ? full : ` ${layout} · Esc `
    }
    const full = ` ${layout} · Tab layout · Esc ${props.escLabel ?? 'close'} `
    if (full.length + 28 <= props.width) {
      return full
    }
    return ` ${layout} · Tab · Esc `
  }

  // Neither header span may shrink, so the path is cut here or it pushes the hints off screen.
  const header = () => {
    const d = diff()
    const note = d.truncated
      ? ` · first ${DIFF_MAX_LINES} lines`
      : plain()
        ? ' · plain (large file)'
        : ''
    const tail = ` · +${d.adds} −${d.dels}${note}`
    const room = Math.max(8, props.width - hints().length - tail.length - 3)
    let rel =
      props.file.oldPath && props.file.oldPath !== props.file.rel
        ? `${props.file.oldPath} → ${props.file.rel}`
        : props.file.rel
    if (rel.length > room) {
      rel = `…${rel.slice(rel.length - room + 1)}`
    }
    return ` ${diffMark(props.file.status)} ${rel}${tail}`
  }

  return (
    <box
      width="100%"
      height={section() ? undefined : '100%'}
      flexShrink={section() ? 0 : undefined}
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={(event: { y: number }) => {
        props.onFocus()
        props.onPickLine?.(lineAtPoint(event.y))
      }}
    >
      {/* flexShrink={0}: the pane below measures as tall as the whole patch, so yoga would crush it. */}
      <Show when={!section()}>
        <box flexDirection="row" flexShrink={0} backgroundColor={ui.solidBarBg}>
          <text
            wrapMode="none"
            fg={diffStatusColor(props.file.status)}
            bg={ui.solidBarBg}
            flexShrink={0}
            content={header()}
          />
          <box flexGrow={1} backgroundColor={ui.solidBarBg} />
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={ui.solidBarBg}
            flexShrink={0}
            content={hints()}
          />
        </box>
      </Show>

      <Show
        when={diff().patch !== '' && client() !== undefined}
        fallback={
          <text
            fg={ui.dim}
            bg={ui.solidBg}
            content={diff().patch === '' ? '  No changes in this file' : ''}
          />
        }
      >
        <diff
          ref={(el: DiffRenderable) => {
            pane = el
            allowSelectionIn(el)
          }}
          diff={diff().patch}
          view={mode() === 'split' ? 'split' : 'unified'}
          filetype={plain() ? undefined : filetypeForPath(props.file.path)}
          syntaxStyle={getSyntaxStyle()}
          treeSitterClient={client() ?? undefined}
          syncScroll
          wrapMode="none"
          flexGrow={section() ? 0 : 1}
          flexShrink={section() ? 0 : undefined}
          height={section() ? sectionRows() : undefined}
          width="100%"
          fg={ui.text}
          lineNumberFg={ui.gutter}
          lineNumberBg={ui.solidBg}
          contextBg={ui.solidBg}
          addedBg={blend(ui.gitAdded, ui.solidBg, 0.14)}
          removedBg={blend(ui.gitDeleted, ui.solidBg, 0.14)}
          addedLineNumberBg={blend(ui.gitAdded, ui.solidBg, 0.28)}
          removedLineNumberBg={blend(ui.gitDeleted, ui.solidBg, 0.28)}
          addedSignColor={ui.gitAdded}
          removedSignColor={ui.gitDeleted}
          selectionBg={ui.treeSelectedBg}
        />
      </Show>
    </box>
  )
}
