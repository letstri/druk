import { basename, relative } from 'node:path'

import { TextAttributes } from '@opentui/core'
import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  Show,
} from 'solid-js'

import { readFile } from '../core/fs'
import type { Context, Match, SearchOptions } from '../core/search'
import {
  buildQuery,
  contextIn,
  searchProject,
  searchText,
} from '../core/search'
import { plural } from '../core/text'
import { ui } from '../themes'
import { createHighlighted, paintLine, sliceSpans } from './codeSpans'
import type { Span } from './codeSpans'
import { windowAround } from './list'
import { modalWidth, PAD } from './modal'
import { ModalPanel, topInset } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export type SearchScope = 'file' | 'project'

export interface SearchMemory {
  query: string
  options: SearchOptions
  // Row index, not match index: a folded heading is a row and no match.
  index: number
  folded: readonly string[]
}

interface SearchPanelProps {
  scope: SearchScope
  rootDir: string
  activePath: string | null
  activeContent: string
  initial?: SearchMemory
  replacing?: boolean
  // A function: each rescan wants the buffers as they are now.
  buffers?: () => ReadonlyMap<string, string>
  // Every key handler hears every key: without this, Enter on a confirm also applies the match.
  suspended?: boolean
  onSearch?: (state: SearchMemory) => void
  onPick: (match: Match) => void
  onReplaceOne?: (match: Match, replacement: string) => void
  onReplaceAll?: (
    query: string,
    replacement: string,
    options: SearchOptions
  ) => void
  onClose: () => void
}

export const MIN_QUERY = 2

const MIN_CONTEXT = 2
const MAX_CONTEXT = 9

const PREVIEW_MIN_HEIGHT = 24

const SLACK = 2

const SCAN_DEBOUNCE_MS = 140

// `at` indexes into `matches()`; a heading points at the first of its own.
type Row =
  | { kind: 'file'; path: string; count: number; at: number; folded: boolean }
  | { kind: 'match'; match: Match; at: number }

const selectable = (row: Row) => row.kind === 'match' || row.folded

export function SearchPanel(props: SearchPanelProps) {
  const dimensions = useTerminalDimensions()
  // Read once: re-reading would fight whatever has been typed since.
  const { initial } = props
  const opened = initial?.query ?? ''
  const [query, setQuery] = createSignal(opened)
  const [scanned, setScanned] = createSignal(opened)
  const [replacement, setReplacement] = createSignal('')
  const [replacing, setReplacing] = createSignal(props.replacing ?? false)
  const [field, setField] = createSignal<'query' | 'replace'>(
    props.replacing && opened ? 'replace' : 'query'
  )
  const [index, setIndex] = createSignal(props.initial?.index ?? 0)
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(
    new Set(props.initial?.folded)
  )
  const [options, setOptions] = createSignal<SearchOptions>(
    props.initial?.options ?? {}
  )

  let scanTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (scanTimer) {
      clearTimeout(scanTimer)
    }
  })

  const type = (value: string) => {
    setQuery(value)
    setIndex(0)
    setFolded(new Set<string>())
    if (props.scope !== 'project') {
      return setScanned(value)
    }
    if (scanTimer) {
      clearTimeout(scanTimer)
    }
    scanTimer = setTimeout(() => setScanned(value), SCAN_DEBOUNCE_MS)
  }

  const pending = () => props.scope === 'project' && scanned() !== query()

  // Bumped after a project-scope replace: the scan reads disk and buffers, which no signal covers.
  const [generation, setGeneration] = createSignal(0)

  createEffect(
    on([query, options, index, folded], ([q, opts, at, shut]) => {
      if (q.length >= MIN_QUERY) {
        props.onSearch?.({
          folded: [...shut],
          index: at,
          options: opts,
          query: q,
        })
      }
    })
  )

  const matches = createMemo(() => {
    generation()
    const q = scanned()
    if (q.length < MIN_QUERY) {
      return []
    }
    return props.scope === 'project'
      ? searchProject(props.rootDir, q, options(), undefined, props.buffers?.())
      : searchText(props.activeContent, q, props.activePath ?? '', options())
  })

  const rows = createMemo<Row[]>(() => {
    const out: Row[] = []
    const all = matches()
    const hidden = folded()
    for (let i = 0; i < all.length; i += 1) {
      const match = all[i]!
      if (props.scope === 'project' && match.path !== all[i - 1]?.path) {
        let count = 0
        while (all[i + count]?.path === match.path) {
          count += 1
        }
        const shut = hidden.has(match.path)
        out.push({ at: i, count, folded: shut, kind: 'file', path: match.path })
        if (shut) {
          i += count - 1
          continue
        }
      }
      out.push({ at: i, kind: 'match', match })
    }
    return out
  })

  const selected = createMemo(() => {
    const all = rows()
    if (all.length === 0) {
      return -1
    }
    const from = Math.min(index(), all.length - 1)
    for (let i = from; i < all.length; i += 1) {
      if (selectable(all[i]!)) {
        return i
      }
    }
    for (let i = from - 1; i >= 0; i -= 1) {
      if (selectable(all[i]!)) {
        return i
      }
    }
    return -1
  })

  const cursor = () => rows()[selected()]
  const current = () => matches()[cursor()?.at ?? -1]

  const move = (step: number) => {
    const all = rows()
    if (all.length === 0) {
      return
    }
    let at = selected()
    for (const _ of all) {
      at = (at + step + all.length) % all.length
      if (selectable(all[at]!)) {
        break
      }
    }
    setIndex(at)
  }

  const toggleFoldAll = () => {
    const paths = [...new Set(matches().map((match) => match.path))]
    const shut = paths.length > 0 && paths.every((path) => folded().has(path))
    // Read before the rows move under the selection.
    const row = cursor()
    const path = row && (row.kind === 'file' ? row.path : row.match.path)
    setFolded(shut ? new Set<string>() : new Set(paths))
    const heading = rows().findIndex(
      (other) => other.kind === 'file' && other.path === path
    )
    if (heading !== -1) {
      setIndex(shut ? heading + 1 : heading)
    }
  }

  const toggleFold = () => {
    const row = cursor()
    if (!row) {
      return
    }
    const path = row.kind === 'file' ? row.path : row.match.path
    const folding = !folded().has(path)
    setFolded((prev) => {
      const next = new Set(prev)
      if (folding) {
        next.add(path)
      } else {
        next.delete(path)
      }
      return next
    })
    const heading = rows().findIndex(
      (entry) => entry.kind === 'file' && entry.path === path
    )
    if (heading !== -1) {
      setIndex(folding ? heading : heading + 1)
    }
  }

  const width = () => modalWidth(dimensions().width, 0.86, 64, 160)
  // Inside the border *and* the padding — miss either and every long row wraps.
  const contentWidth = () => width() - 2 - PAD * 2

  const swap = () => (replacing() ? replacement() : '')

  // The whole file, not the window: tree-sitter error recovery misreads a fragment.
  type Source = { path: string; text: string } | null
  const source = createMemo<Source, Source>(
    () => {
      const match = current()
      if (!match) {
        return null
      }
      if (props.scope !== 'project') {
        return { path: match.path, text: props.activeContent }
      }
      try {
        return { path: match.path, text: readFile(match.path) }
      } catch {
        return null
      }
    },
    null,
    // Stepping between matches in one file must not restart the parse below.
    { equals: (a, b) => a?.path === b?.path && a?.text === b?.text }
  )

  const chromeRows = () =>
    7 + topInset(dimensions().height) + (replacing() ? 1 : 0)

  const contextLines = () => {
    const spare = dimensions().height - chromeRows() - SLACK
    return Math.max(MIN_CONTEXT, Math.min(MAX_CONTEXT, Math.floor(spare / 5)))
  }

  const previewRows = () => contextLines() * 2 + 3

  const preview = createMemo<Context | null>(() => {
    const match = current()
    const file = source()
    if (!match || !file || dimensions().height < PREVIEW_MIN_HEIGHT) {
      return null
    }
    return contextIn(file.text, match.line, contextLines())
  })

  const parsed = createHighlighted(source)

  const resultRows = () => {
    const chrome = chromeRows() + SLACK + (preview() ? previewRows() : 0)
    return Math.max(2, Math.min(18, dimensions().height - chrome))
  }

  const windowed = createMemo(() =>
    windowAround(rows(), selected(), resultRows(), 2)
  )

  const toggleOption = (name: keyof SearchOptions) => {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }))
    setIndex(0)
    setFolded(new Set<string>())
  }
  const OPTION_KEYS: Partial<Record<string, keyof SearchOptions>> = {
    c: 'caseSensitive',
    r: 'regex',
    w: 'wholeWord',
  }

  useKeys((key: KeyEvent) => {
    if (props.suspended) {
      return
    }
    const k = key.name
    const option = key.ctrl ? OPTION_KEYS[k] : undefined
    if (option) {
      key.preventDefault()
      toggleOption(option)
    } else if (k === 'up') {
      key.preventDefault()
      move(-1)
    } else if (k === 'down') {
      key.preventDefault()
      move(1)
    } else if (k === 'tab' && key.shift && props.scope === 'project') {
      key.preventDefault()
      toggleFoldAll()
    } else if (k === 'tab' && props.scope === 'file' && props.onReplaceAll) {
      key.preventDefault()
      const next = !replacing()
      setReplacing(next)
      setField(next ? 'replace' : 'query')
    } else if (k === 'tab' && props.scope === 'project' && replacing()) {
      key.preventDefault()
      setField((f) => (f === 'query' ? 'replace' : 'query'))
    } else if (k === 'tab' && props.scope === 'project') {
      key.preventDefault()
      toggleFold()
    } else if (key.ctrl && k === 'a' && replacing() && props.onReplaceAll) {
      key.preventDefault()
      props.onReplaceAll(query(), replacement(), options())
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      if (cursor()?.kind === 'file') {
        return toggleFold()
      }
      const match = current()
      if (!match) {
        return
      }
      if (replacing() && props.onReplaceOne) {
        props.onReplaceOne(match, replacement())
        if (props.scope === 'project') {
          setGeneration((g) => g + 1)
        }
      } else {
        props.onPick(match)
      }
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  const flags = () => {
    const toggles = options()
    const parts = [
      toggles.caseSensitive && 'case',
      toggles.wholeWord && 'word',
      toggles.regex && 'regex',
    ]
    const active = parts.filter(Boolean)
    return active.length > 0 ? ` · ${active.join(' ')}` : ''
  }

  const summary = () => {
    if (query().length < MIN_QUERY) {
      return `Type at least 2 characters${flags()}`
    }
    if (pending()) {
      return `Searching…${flags()}`
    }
    if (options().regex && !buildQuery(scanned(), options())) {
      return `Invalid regex${flags()}`
    }
    const all = matches()
    if (all.length === 0) {
      return `No matches${flags()}`
    }
    const files = new Set(all.map((m) => m.path)).size
    const capped = all.length >= 200 ? '+' : ''
    const where =
      props.scope === 'project' ? ` in ${plural(files, 'file')}` : ''
    return `${(cursor()?.at ?? 0) + 1} of ${all.length}${capped}${where}${flags()}`
  }

  const label = (path: string) =>
    relative(props.rootDir, path) || basename(path)

  const sliceAround = (text: string, col: number, room: number) => {
    if (text.length <= room) {
      return { col, cut: false, text }
    }
    const start = Math.max(0, Math.min(col - 12, text.length - room))
    return {
      col: col - start,
      cut: start > 0,
      text: text.slice(start, start + room),
    }
  }

  const painted = (line: string, at: number, plain: string): Span[] =>
    paintLine(parsed(), line, at, plain)

  const previewRoom = () => contentWidth() - 6

  const previewShift = () => {
    const match = current()
    if (!match || match.col + match.length <= previewRoom()) {
      return 0
    }
    return Math.max(0, match.col - 12)
  }

  const previewLine = (line: string, at: number): Span[] => {
    const match = current()
    const hit = match && at === match.line
    const spans = painted(line, at, hit ? ui.text : ui.dim)
    if (!hit) {
      return sliceSpans(spans, 0, previewRoom())
    }
    const shift = previewShift()
    const room = previewRoom() - (shift > 0 ? 1 : 0)
    const cut: Span[] = shift > 0 ? [{ fg: ui.dim, text: '…' }] : []
    const text = line.slice(match.col, match.col + match.length)
    return [
      ...cut,
      ...sliceSpans(
        [
          ...sliceSpans(spans, shift, match.col),
          swap()
            ? {
                attributes: TextAttributes.STRIKETHROUGH,
                fg: ui.gitDeleted,
                text,
              }
            : { attributes: TextAttributes.BOLD, fg: ui.accent, text },
          ...(swap()
            ? [
                {
                  attributes: TextAttributes.BOLD,
                  fg: ui.gitAdded,
                  text: swap(),
                },
              ]
            : []),
          ...sliceSpans(spans, match.col + match.length, line.length),
        ],
        0,
        room
      ),
    ]
  }

  return (
    <ModalPanel
      zIndex={150}
      align="top"
      width={width()}
      title={
        props.scope === 'project' ? ' Search in project ' : ' Search in file '
      }
    >
      <TextInput
        value={query()}
        placeholder="Search…"
        focused={!props.suspended && (!replacing() || field() === 'query')}
        selectAllOnMount
        onInput={type}
      />
      <Show when={replacing()}>
        <TextInput
          value={replacement()}
          placeholder="Replace with…"
          focused={!props.suspended && field() === 'replace'}
          onInput={setReplacement}
        />
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content={summary()} />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />

      <For each={windowed().rows}>
        {(row, i) => {
          const at = () => windowed().start + i()
          const active = () => at() === selected()

          if (row.kind === 'file') {
            const bg = () => (active() ? ui.treeSelectedBg : ui.solidBarBg)
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text
                  fg={ui.folder}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.folded ? '▸' : '▾'} ${label(row.path)} `}
                  attributes={TextAttributes.BOLD}
                />
                <box flexGrow={1} backgroundColor={bg()} />
                <text
                  fg={active() ? ui.accent : ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.count} match${row.count === 1 ? '' : 'es'} `}
                />
              </box>
            )
          }

          const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
          const gutter = () => `${row.match.line + 1}`.padStart(5)
          // Marker 1 + number and gap 7 + cut marker 1; one column over and the row wraps.
          const cut = () =>
            sliceAround(
              row.match.text,
              row.match.col,
              contentWidth() - 9 - swap().length
            )
          const head = () => cut().text.slice(0, cut().col)
          const hit = () =>
            cut().text.slice(cut().col, cut().col + row.match.length)
          const tail = () => cut().text.slice(cut().col + row.match.length)

          return (
            <box flexDirection="row" backgroundColor={bg()}>
              <text
                fg={ui.accent}
                bg={bg()}
                flexShrink={0}
                content={active() ? '▌' : ' '}
              />
              <text
                fg={active() ? ui.accent : ui.faint}
                bg={bg()}
                flexShrink={0}
                content={`${gutter()}  `}
              />
              <text
                fg={ui.dim}
                bg={bg()}
                flexShrink={0}
                content={cut().cut ? '…' : ''}
              />
              <text
                fg={active() ? ui.text : ui.dim}
                bg={bg()}
                flexShrink={0}
                content={head()}
              />
              <text
                fg={swap() ? ui.gitDeleted : ui.accent}
                bg={bg()}
                flexShrink={0}
                content={hit()}
                attributes={
                  swap() ? TextAttributes.STRIKETHROUGH : TextAttributes.BOLD
                }
              />
              <Show when={swap()}>
                <text
                  fg={ui.gitAdded}
                  bg={bg()}
                  flexShrink={0}
                  content={swap()}
                  attributes={TextAttributes.BOLD}
                />
              </Show>
              <box flexGrow={1} backgroundColor={bg()}>
                <text
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={tail()}
                />
              </box>
            </box>
          )
        }}
      </For>

      <Show when={preview()}>
        {(around: () => Context) => (
          <box flexDirection="column" marginTop={1}>
            <text
              fg={ui.border}
              bg={ui.panelBg}
              content={'─'.repeat(Math.max(0, contentWidth()))}
            />
            <box flexDirection="column" backgroundColor={ui.solidBg}>
              {/* Index, not For: a fixed column whose values change on every step. */}
              <Index each={around().lines}>
                {(line, i) => {
                  const at = () => around().start + i
                  const isMatch = () => at() === current()?.line
                  const bg = () => (isMatch() ? ui.currentLine : ui.solidBg)
                  return (
                    <box flexDirection="row" backgroundColor={bg()}>
                      <text
                        fg={ui.gutter}
                        bg={bg()}
                        flexShrink={0}
                        content={`${`${at() + 1}`.padStart(5)} `}
                      />
                      <Index each={previewLine(line(), at())}>
                        {(span) => (
                          <text
                            fg={span().fg}
                            bg={bg()}
                            flexShrink={0}
                            content={span().text}
                            attributes={span().attributes}
                          />
                        )}
                      </Index>
                      <box flexGrow={1} backgroundColor={bg()} />
                    </box>
                  )
                }}
              </Index>
            </box>
          </box>
        )}
      </Show>

      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          props.onReplaceAll
            ? replacing()
              ? '↑↓ move · Enter replace · Ctrl+A replace all · Tab back · Esc close'
              : '↑↓ move · Enter jump · Tab replace · Ctrl+C/W/R case/word/regex · Esc close'
            : '↑↓ move · Enter jump · Tab fold · Shift+Tab all · Ctrl+C/W/R case/word/regex · Esc close'
        }
      />
    </ModalPanel>
  )
}
