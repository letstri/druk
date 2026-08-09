import { createMemo, For, Index, Show } from 'solid-js'

import { isDeprecated, kindInfo, kindName, matchRuns } from '../lsp/completion'
import type { KindGroup, Match } from '../lsp/completion'
import { ui } from '../themes'
import { DESC_MAX, ROW_CHROME, SIG_MAX, signatureOf } from './completionLayout'
import type { MenuLayout } from './completionLayout'
import { windowAround } from './list'
import { cut } from './text'

export interface CompletionMenuProps {
  matches: Match[]
  selected: number
  /** Size and detail rows, computed once by EditorPane so placement agrees. */
  layout: MenuLayout
  /** Placement inside the pane box, already flipped/clamped by EditorPane. */
  top: number
  left: number
}

/** Read at paint time: `ui` is a store, a module-scope table would freeze a theme. */
const GROUP_COLORS: Record<KindGroup, () => string> = {
  fn: () => ui.accent,
  var: () => ui.gitModified,
  type: () => ui.folder,
  module: () => ui.gitAdded,
  keyword: () => ui.dim,
  text: () => ui.dim,
}

/**
 * The completion popup: a windowed list with its own scrollbar, a counter row
 * naming the selected item's kind, and a panel under it carrying the signature
 * and documentation for whichever item is selected.
 *
 * Purely presentational — EditorPane owns every decision, what is in the list,
 * what is selected, what has been resolved and where the box sits — so this
 * stays a painter that a test can drive through the real keyboard flow.
 */
export function CompletionMenu(props: CompletionMenuProps) {
  const windowed = createMemo(() => windowAround(props.matches, props.selected, props.layout.rows))
  /** Columns inside the border. */
  const inner = () => props.layout.width - 2
  /** Reserved rows the current item did not fill; drawn blank so nothing moves. */
  const filler = () =>
    props.layout.panelRows - props.layout.signature.length - props.layout.documentation.length

  const kind = () =>
    cut(kindName(props.matches[props.selected]?.item.kind), Math.max(0, inner() - 12))
  const counter = () => `${props.selected + 1}/${props.matches.length} `
  const ACCEPT = ' · Tab accepts'
  const acceptHint = () =>
    inner() - kind().length - counter().length - ACCEPT.length >= 2 ? ACCEPT : ''

  /**
   * The scrollbar cell for visible row `at`: a thumb whose size and travel say
   * how much of the list is off screen, which a bare counter cannot.
   */
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
          {/* The one key the menu cannot be used without, and the only place the
              user is looking while it is up. Dropped rather than cut where the
              row is too narrow: half a key name is worse than none. */}
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
            {line => <text fg={ui.text} bg={ui.panelBg} wrapMode="none" content={` ${line()}`} />}
          </Index>
          <Index each={props.layout.documentation}>
            {line => <text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={` ${line()}`} />}
          </Index>
          <box height={Math.max(0, filler())} backgroundColor={ui.panelBg} />
        </Show>
      </Show>
    </box>
  )
}
