import { TextAttributes } from '@opentui/core'
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'

import { computeHighlights, segmentsIn, STALE, styleForId } from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { isDeprecated, kindInfo, kindName, matchRuns } from '../lsp/completion'
import type { KindGroup, Match } from '../lsp/completion'
import { paintedTheme, ui } from '../themes'
import { DESC_MAX, ROW_CHROME, SIG_MAX, signatureOf } from './completionLayout'
import type { MenuLayout, SignatureLine } from './completionLayout'
import { windowAround } from './list'
import { cut } from './text'

export interface CompletionMenuProps {
  matches: Match[]
  selected: number
  layout: MenuLayout
  detail: string
  filetype?: string
  top: number
  left: number
}

interface Span {
  text: string
  fg: string
  attributes: number
}

// Read at paint time: `ui` is a store, a module-scope table would freeze a theme.
const GROUP_COLORS: Record<KindGroup, () => string> = {
  fn: () => ui.accent,
  var: () => ui.gitModified,
  type: () => ui.folder,
  module: () => ui.gitAdded,
  keyword: () => ui.dim,
  text: () => ui.dim,
}

export function CompletionMenu(props: CompletionMenuProps) {
  const windowed = createMemo(() => windowAround(props.matches, props.selected, props.layout.rows))
  const inner = () => props.layout.width - 2
  const filler = () =>
    props.layout.panelRows -
    props.layout.signature.length -
    props.layout.documentation.length -
    (props.layout.origin ? 1 : 0)

  const [parsed, setParsed] = createSignal<Highlighted | null>(null)
  createEffect(
    on([() => props.detail, () => props.filetype], ([detail, filetype]) => {
      setParsed(null)
      if (!detail || !filetype) return
      let dropped = false
      onCleanup(() => {
        dropped = true
      })
      void (async () => {
        const doc = await computeHighlights(detail, filetype, 2, () => dropped)
        if (!dropped && doc !== STALE) setParsed(doc)
      })()
    }),
  )
  const captures = createMemo(() => {
    const doc = parsed()
    return doc ? segmentsIn(doc, 0, 0) : []
  })

  // Offsets are into the flattened signature, so a capture is sliced to this row.
  const painted = (line: SignatureLine): Span[] => {
    // Read for the dependency: a segment's style id belongs to the table its theme built.
    paintedTheme()
    const out: Span[] = []
    const plain = ui.text
    let col = 0
    for (const segment of captures()) {
      const start = Math.max(segment.start - line.start, col)
      const end = Math.min(segment.end - line.start, line.text.length)
      if (end <= start) continue
      const style = styleForId(segment.styleId)
      const fg = typeof style?.fg === 'string' ? style.fg : undefined
      if (!style || !fg) continue
      if (start > col) out.push({ text: line.text.slice(col, start), fg: plain, attributes: 0 })
      out.push({
        text: line.text.slice(start, end),
        fg,
        attributes:
          (style.bold ? TextAttributes.BOLD : 0) | (style.italic ? TextAttributes.ITALIC : 0),
      })
      col = end
    }
    if (col < line.text.length) out.push({ text: line.text.slice(col), fg: plain, attributes: 0 })
    return out
  }

  const kind = () =>
    cut(kindName(props.matches[props.selected]?.item.kind), Math.max(0, inner() - 12))
  const counter = () => `${props.selected + 1}/${props.matches.length} `
  const ACCEPT = ' · Tab accepts'
  const acceptHint = () =>
    inner() - kind().length - counter().length - ACCEPT.length >= 2 ? ACCEPT : ''

  const track = (at: number): string => {
    const total = props.matches.length
    const shown = props.layout.rows
    if (total <= shown) return ' '
    const thumb = Math.max(1, Math.round((shown / total) * shown))
    const span = shown - thumb
    const top = Math.round((windowed().start / (total - shown)) * span)
    return at >= top && at < top + thumb ? '█' : '│'
  }

  return (
    <box
      position="absolute"
      top={props.top}
      left={props.left}
      width={props.layout.width}
      zIndex={30}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.scrollbar}
    >
      <Show
        when={props.matches.length > 0}
        fallback={<text fg={ui.dim} bg={ui.panelBg} content=" No suggestions" />}
      >
        <For each={windowed().rows}>
          {(match, i) => {
            const active = () => windowed().start + i() === props.selected
            const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
            const kind = kindInfo(match.item.kind)
            const dim = isDeprecated(match.item)
            const room = () => inner() - ROW_CHROME
            const labelRoom = () => Math.max(1, Math.min(match.item.label.length, room()))
            const signature = signatureOf(match.item)
            const sigRoom = () => Math.min(room() - labelRoom() - 1, SIG_MAX)
            const sigShown = () =>
              signature && sigRoom() >= 6 ? Math.min(signature.length, sigRoom()) : 0
            const description = match.item.labelDetails?.description ?? ''
            const descRoom = () => Math.min(room() - labelRoom() - sigShown() - 2, DESC_MAX)
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌' : ' '} />
                <text
                  fg={GROUP_COLORS[kind.group]()}
                  bg={bg()}
                  flexShrink={0}
                  content={`${kind.glyph} `}
                />
                <box flexDirection="row" flexShrink={0}>
                  <For each={matchRuns(cut(match.item.label, labelRoom()), match.positions)}>
                    {run => (
                      <text
                        fg={run.hit ? ui.accent : dim ? ui.faint : active() ? ui.text : ui.dim}
                        bg={bg()}
                        content={run.text}
                      />
                    )}
                  </For>
                </box>
                <Show when={sigShown() > 0}>
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    wrapMode="none"
                    content={` ${cut(signature, sigShown())}`}
                  />
                </Show>
                <box flexGrow={1} backgroundColor={bg()} />
                <Show when={description && descRoom() >= 6}>
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    wrapMode="none"
                    content={` ${cut(description, descRoom())} `}
                  />
                </Show>
                <text fg={ui.scrollbar} bg={bg()} flexShrink={0} content={track(i())} />
              </box>
            )
          }}
        </For>
        <box flexDirection="row" backgroundColor={ui.panelBg}>
          <text
            fg={ui.faint}
            bg={ui.panelBg}
            flexShrink={0}
            wrapMode="none"
            content={` ${kind()}`}
          />
          {/* Dropped rather than cut on a narrow row: half a key name is worse than none. */}
          <text
            fg={ui.faint}
            bg={ui.panelBg}
            flexShrink={0}
            wrapMode="none"
            content={acceptHint()}
          />
          <box flexGrow={1} backgroundColor={ui.panelBg} />
          <text fg={ui.faint} bg={ui.panelBg} flexShrink={0} content={counter()} />
        </box>
        <Show when={props.layout.panelRows > 0}>
          <text
            fg={ui.border}
            bg={ui.panelBg}
            wrapMode="none"
            content={'─'.repeat(Math.max(0, inner()))}
          />
          <Index each={props.layout.signature}>
            {line => (
              <box flexDirection="row" backgroundColor={ui.panelBg}>
                <text fg={ui.text} bg={ui.panelBg} flexShrink={0} content=" " />
                <For each={painted(line())}>
                  {span => (
                    <text
                      fg={span.fg}
                      bg={ui.panelBg}
                      flexShrink={0}
                      wrapMode="none"
                      attributes={span.attributes}
                      content={span.text}
                    />
                  )}
                </For>
                <box flexGrow={1} backgroundColor={ui.panelBg} />
              </box>
            )}
          </Index>
          <Index each={props.layout.documentation}>
            {line => <text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={` ${line()}`} />}
          </Index>
          <Show when={props.layout.origin}>
            <text
              fg={ui.faint}
              bg={ui.panelBg}
              wrapMode="none"
              content={` ${props.layout.origin}`}
            />
          </Show>
          {/* Guarded: a zero-height box still paints a row, over the box's own bottom border. */}
          <Show when={filler() > 0}>
            <box height={filler()} backgroundColor={ui.panelBg} />
          </Show>
        </Show>
      </Show>
    </box>
  )
}
