import { basename } from 'node:path'

import { RGBA } from '@opentui/core'
import type { BoxRenderable, OptimizedBuffer } from '@opentui/core'
import { createMemo, createSignal, Show } from 'solid-js'

import { errorMessage } from '../core/errors'
import { decodeImage, toCells } from '../core/image'
import type { CellImage, RawImage } from '../core/image'
import { ui } from '../themes'

export interface ImageViewProps {
  path: string
  width: number
  height: number
  onFocus: () => void
}

type Loaded = { image: RawImage; kb: string } | { error: string }

// Painted into the frame buffer: per-cell `<text>` hits the Zig core's renderable cap.
export function ImageView(props: ImageViewProps) {
  const [box, setBox] = createSignal<BoxRenderable | null>(null)

  const loaded = createMemo<Loaded>(() => {
    try {
      const image = decodeImage(props.path)
      return { image, kb: `${Math.max(1, Math.round(image.bytes / 1024))} KB` }
    } catch (e) {
      return { error: errorMessage(e) }
    }
  })

  const view = createMemo<CellImage | null>(() => {
    const l = loaded()
    if ('error' in l) return null
    return toCells(l.image, Math.max(1, props.width), Math.max(1, props.height - 1))
  })

  const painted = createMemo(() => {
    const cells = view()
    if (!cells) return null
    const pane = RGBA.fromHex(ui.bg)
    const colors: ({ fg: RGBA; bg: RGBA } | null)[] = Array.from({
      length: cells.cols * cells.rows,
    })
    for (let at = 0; at < colors.length; at++) {
      const o = at * 8
      const upperA = cells.cells[o + 3]!
      const lowerA = cells.cells[o + 7]!
      if (upperA === 0 && lowerA === 0) {
        colors[at] = null
        continue
      }
      const channel = (i: number, alpha: number) =>
        alpha === 0
          ? pane
          : RGBA.fromInts(cells.cells[i]!, cells.cells[i + 1]!, cells.cells[i + 2]!, alpha)
      colors[at] = { fg: channel(o, upperA), bg: channel(o + 4, lowerA) }
    }
    return { cols: cells.cols, rows: cells.rows, colors }
  })

  // Runs every frame outside Solid's tracking; the memos and the box's position are settled by then.
  const draw = (buffer: OptimizedBuffer) => {
    const host = box()
    const image = painted()
    if (!host || !image) return
    const left = host.x + Math.max(0, Math.floor((host.width - image.cols) / 2))
    const top = host.y + Math.max(0, Math.floor((host.height - image.rows) / 2))
    for (let row = 0; row < image.rows; row++) {
      for (let col = 0; col < image.cols; col++) {
        const cell = image.colors[row * image.cols + col]
        if (!cell) continue
        buffer.setCellWithAlphaBlending(left + col, top + row, '▀', cell.fg, cell.bg)
      }
    }
  }

  const caption = () => {
    const l = loaded()
    if ('error' in l) return `Cannot show ${basename(props.path)}: ${l.error}`
    return `${basename(props.path)} — ${l.image.width}×${l.image.height} · ${l.kb}`
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
      <Show when={painted()}>
        <box flexGrow={1} backgroundColor={ui.bg} ref={setBox} renderAfter={draw} />
      </Show>
    </box>
  )
}
