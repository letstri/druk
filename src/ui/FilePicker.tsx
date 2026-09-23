import { relative } from 'node:path'

import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, Show } from 'solid-js'

import { fileScore, listFiles } from '../core/search'
import { ui } from '../themes'
import { FilterList } from './FilterList'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { topInset } from './Overlay'

// 0-based, the way the editor counts — the query writes them 1-based.
interface PickPosition {
  line: number
  col: number
}

interface FilePickerProps {
  rootDir: string
  files?: string[]
  title?: string
  onPick: (path: string, position?: PickPosition) => void
  onClose: () => void
}

// A trailing `:line` or `:line:col` is a destination: anchored and digits-only, or `foo:bar` breaks.
const POSITION = /:(\d+)(?::(\d+))?$/u

export function FilePicker(props: FilePickerProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.62, 72, 110)
  const visibleRows = () =>
    listRows(dimensions().height - topInset(dimensions().height), 8, 18)

  // Scanned and relativised once per open: `relative()` in the filter cost 5 000 calls a keystroke.
  const files = (props.files ?? listFiles(props.rootDir, 5000)).map((path) => ({
    label: relative(props.rootDir, path),
    path,
  }))

  const target = createMemo(() => {
    const raw = query().trim()
    const at = POSITION.exec(raw)
    if (!at) {
      return { position: undefined, text: raw }
    }
    return {
      position: {
        col: Math.max(0, Number(at[2] ?? 1) - 1),
        line: Math.max(0, Number(at[1]) - 1),
      },
      text: raw.slice(0, at.index),
    }
  })

  const matches = createMemo(() => {
    const q = target().text
    const scored: { path: string; label: string; score: number }[] = []
    for (const file of files) {
      const score = fileScore(file.label, q)
      if (score !== null) {
        scored.push({ ...file, score })
      }
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  const openAt = () => {
    const at = target().position
    return at ? ` at ${at.line + 1}:${at.col + 1}` : ''
  }

  const open = (row: number) => {
    const match = matches()[row]
    if (match) {
      props.onPick(match.path, target().position)
    }
  }

  useListKeys({
    close: () => props.onClose(),
    count: () => matches().length,
    move: setIndex,
    pick: () => open(selected()),
  })

  return (
    <FilterList
      title={` ${props.title ?? 'Open file'} — ${files.length} `}
      placeholder="Type part of a path, :line or :line:col to land on…"
      footer={`↑↓ move · Enter open${openAt()} · Esc close`}
      align="top"
      width={width()}
      rows={visibleRows()}
      items={matches()}
      selected={selected()}
      query={query()}
      onQuery={(v) => {
        setQuery(v)
        setIndex(0)
      }}
      onPick={open}
      onClose={props.onClose}
    >
      {(match, active, bg) => {
        const shown = () => match.label.slice(0, width() - PAD * 2 - 4)
        const dir = () => shown().lastIndexOf('/') + 1
        return (
          <>
            {/* Only when there is a folder: an empty <text> still occupies a column. */}
            <Show when={dir() > 0}>
              <text
                fg={ui.faint}
                bg={bg()}
                flexShrink={0}
                content={shown().slice(0, dir())}
              />
            </Show>
            <box flexGrow={1} backgroundColor={bg()}>
              <text
                fg={active() ? ui.text : ui.dim}
                bg={bg()}
                content={shown().slice(dir())}
              />
            </box>
          </>
        )
      }}
    </FilterList>
  )
}
