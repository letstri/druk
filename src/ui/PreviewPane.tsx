import { basename } from 'node:path'

import type { ScrollBoxRenderable, TreeSitterClient } from '@opentui/core'
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  Show,
} from 'solid-js'

import { BinaryFileError, readFile, sizeOf } from '../core/fs'
import { isImagePath } from '../core/image'
import {
  filetypeForPath,
  getSyntaxStyle,
  highlightClient,
} from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { ImageView } from './ImageView'
import { scrollbarOptions } from './list'
import { Page } from './PanelHeader'
import { cut } from './text'

interface PreviewPaneProps {
  path: string
  isDir: boolean
  buffer?: string
  width: number
  height: number
  scroll: { pages: number; at: number } | null
  onFocus: () => void
}

// Past this the file is named rather than shown: read and highlight run on every step.
const MAX_PREVIEW_BYTES = 512 * 1024

type Shown =
  | { kind: 'text'; text: string }
  | { kind: 'image' }
  | { kind: 'note'; note: string }

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`

export function PreviewPane(props: PreviewPaneProps) {
  // `<code>`'s default client would be a second, empty one with no vendored grammars.
  const [client, setClient] = createSignal<
    TreeSitterClient | null | undefined
  >()
  onMount(async () => {
    setClient(await highlightClient())
  })

  // Keyed on the painted theme: the style table is rebuilt when the palette changes.
  const style = createMemo(
    on(
      () => paintedTheme(),
      () => getSyntaxStyle()
    )
  )

  let box: ScrollBoxRenderable | undefined

  const page = () => Math.max(1, props.height - 2)

  createEffect(
    on(
      () => props.scroll,
      (request) => {
        if (box && request) {
          box.scrollTop = Math.max(0, box.scrollTop + request.pages * page())
        }
      },
      { defer: true }
    )
  )

  // Keyed on the path, not the content, which changes on every keystroke in the editor.
  createEffect(
    on(
      () => props.path,
      () => {
        if (box) {
          box.scrollTop = 0
        }
      },
      { defer: true }
    )
  )

  const shown = createMemo<Shown>(() => {
    if (props.isDir) {
      return { kind: 'note', note: 'Folder — → opens it' }
    }
    if (isImagePath(props.path)) {
      return { kind: 'image' }
    }
    if (props.buffer !== undefined) {
      return { kind: 'text', text: props.buffer }
    }
    const bytes = sizeOf(props.path)
    if (bytes > MAX_PREVIEW_BYTES) {
      return {
        kind: 'note',
        note: `${sizeLabel(bytes)} — too big to preview; Enter opens it`,
      }
    }
    try {
      return { kind: 'text', text: readFile(props.path) }
    } catch (error) {
      return {
        kind: 'note',
        note:
          error instanceof BinaryFileError
            ? `Binary — ${sizeLabel(bytes)}, nothing to show`
            : (error as Error).message,
      }
    }
  })

  const note = createMemo(() => {
    const what = shown()
    return what.kind === 'note' ? what.note : null
  })
  const text = createMemo(() => {
    const what = shown()
    return what.kind === 'text' ? what.text : null
  })

  const hints = () => {
    const full = ' preview · Enter opens · Space closes '
    return full.length + 12 <= props.width ? full : ' preview · Esc '
  }

  const name = () =>
    cut(basename(props.path), Math.max(0, props.width - hints().length - 2))

  return (
    <Page title={` ${name()}`} hints={hints()} onFocus={props.onFocus}>
      <Show when={shown().kind === 'image'}>
        <ImageView
          path={props.path}
          width={props.width}
          height={props.height - 1}
          onFocus={props.onFocus}
        />
      </Show>
      <Show when={note()}>
        {(what: () => string) => (
          <text fg={ui.dim} bg={ui.solidBg} content={`  ${what()}`} />
        )}
      </Show>
      <Show when={text() !== null}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (box = el)}
          flexGrow={1}
          backgroundColor={ui.solidBg}
          paddingLeft={1}
          scrollbarOptions={scrollbarOptions(ui.solidBg)}
        >
          {/* Wrapped whatever the editor's `wrap` says: nothing here scrolls sideways. */}
          <code
            content={text() ?? ''}
            filetype={filetypeForPath(props.path)}
            syntaxStyle={style()}
            treeSitterClient={client() ?? undefined}
            wrapMode="word"
            fg={ui.text}
            bg={ui.solidBg}
          />
        </scrollbox>
      </Show>
    </Page>
  )
}
