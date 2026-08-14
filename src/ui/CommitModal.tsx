import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal, For, Show } from 'solid-js'

import type { FileStatus } from '../core/git'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { useKeys } from './useKeys'

export interface CommitFile {
  path: string
  /** Shown to the user; `path` is what git gets. */
  rel: string
  status: FileStatus
  /** Whether the file starts checked — the caller's read of the index. */
  checked: boolean
}

export interface CommitModalProps {
  files: CommitFile[]
  /** The files left checked, in tree order. Never empty — Enter refuses instead. */
  onSubmit: (paths: string[]) => void
  onCancel: () => void
}

/** Pick which of the changed files a commit should carry. */
export function CommitModal(props: CommitModalProps) {
  const dimensions = useTerminalDimensions()
  const [cursor, setCursor] = createSignal(0)
  const [top, setTop] = createSignal(0)
  // Read once on open: the modal is remounted per showing, and the files array
  // does not change underneath it.
  const [excluded, setExcluded] = createSignal<Set<string>>(
    new Set(props.files.filter(file => !file.checked).map(file => file.path)),
  )

  const width = () => modalWidth(dimensions().width, 0.6, 70, 100)
  const rows = () => listRows(dimensions().height, 9, 16)

  const picked = () => props.files.filter(file => !excluded().has(file.path))

  const move = (delta: number) => {
    const count = props.files.length
    if (count === 0) return
    const next = (cursor() + delta + count) % count
    setCursor(next)
    if (next < top()) setTop(next)
    else if (next >= top() + rows()) setTop(next - rows() + 1)
  }

  const toggle = () => {
    const file = props.files[cursor()]
    if (!file) return
    setExcluded(prev => {
      const next = new Set(prev)
      if (!next.delete(file.path)) next.add(file.path)
      return next
    })
  }

  const toggleAll = () =>
    setExcluded(prev =>
      prev.size > 0 ? new Set<string>() : new Set(props.files.map(file => file.path)),
    )

  useKeys((key: KeyEvent, k: string) => {
    if (k === 'up') {
      key.preventDefault()
      move(-1)
    } else if (k === 'down') {
      key.preventDefault()
      move(1)
    } else if (k === 'space' || key.sequence === ' ') {
      key.preventDefault()
      toggle()
    } else if (k === 'a') {
      key.preventDefault()
      toggleAll()
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      const paths = picked().map(file => file.path)
      // Nothing checked: an empty commit is never what was meant, so the key
      // does nothing and the "0 of N" in the title says why.
      if (paths.length > 0) props.onSubmit(paths)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onCancel()
    }
  })

  return (
    <ModalPanel
      zIndex={150}
      width={width()}
      title={` Commit — ${picked().length} of ${props.files.length} files `}
    >
      <For each={props.files.slice(top(), top() + rows())}>
        {(file, i) => {
          const active = () => top() + i() === cursor()
          const checked = () => !excluded().has(file.path)
          const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
          const shown = () => file.rel.slice(0, width() - PAD * 2 - 10)
          return (
            <box flexDirection="row" backgroundColor={bg()}>
              <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
              <text
                fg={checked() ? ui.accent : ui.dim}
                bg={bg()}
                flexShrink={0}
                content={checked() ? '[x] ' : '[ ] '}
              />
              <text
                fg={statusColor(file.status)}
                bg={bg()}
                flexShrink={0}
                content={`${MARKS[file.status]} `}
              />
              <box flexGrow={1} backgroundColor={bg()}>
                <text fg={checked() ? ui.text : ui.dim} bg={bg()} content={shown()} />
              </box>
            </box>
          )
        }}
      </For>
      <Show when={top() + rows() < props.files.length}>
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={`  … ${props.files.length - top() - rows()} more`}
        />
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content="" />
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content="↑↓ move · Space toggle · A all · Enter message · Esc cancel"
      />
    </ModalPanel>
  )
}
