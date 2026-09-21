import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { ImageRenderProtocol } from '@opentui/core'
import { createSignal } from 'solid-js'

import { errorMessage } from '../core/errors'
import { ui } from '../themes'

interface ImageViewProps {
  path: string
  blocked?: boolean
  onFocus: () => void
}

// The core picks kitty, sixel or half-blocks from the terminal's own answer; this overrides it.
const forced = (): ImageRenderProtocol => {
  const env = process.env.DRUK_KITTY_IMAGES
  if (env === '1') {
    return 'kitty'
  }
  return env === '0' ? 'blocks' : 'auto'
}

const sizeOf = (path: string): string => {
  try {
    return `${Math.max(1, Math.round(statSync(path).size / 1024))} KB`
  } catch {
    return ''
  }
}

export function ImageView(props: ImageViewProps) {
  // The pixels stay the renderable's, which disposes them: the caption keeps numbers.
  const [size, setSize] = createSignal<{
    height: number
    width: number
  } | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const caption = () => {
    const failed = error()
    if (failed) {
      return `Cannot show ${basename(props.path)}: ${failed}`
    }
    const loaded = size()
    const note = [
      loaded ? `${loaded.width}×${loaded.height}` : null,
      sizeOf(props.path),
    ]
      .filter(Boolean)
      .join(' · ')
    return `${basename(props.path)}${note ? ` — ${note}` : ''}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.bg}
      onMouseDown={() => props.onFocus()}
    >
      <text fg={ui.dim} bg={ui.bg} content={` ${caption()}`} />
      <image
        flexGrow={1}
        source={props.path}
        fit="fit"
        // A modal draws in the cells, and kitty puts its image over them, not under.
        protocol={props.blocked ? 'blocks' : forced()}
        onLoad={(loaded) => {
          setError(null)
          setSize({ height: loaded.height, width: loaded.width })
        }}
        onError={(failed) => {
          setSize(null)
          setError(errorMessage(failed))
        }}
      />
    </box>
  )
}
