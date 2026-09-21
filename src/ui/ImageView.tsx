import { basename } from 'node:path'

import { RGBA } from '@opentui/core'
import type { BoxRenderable, OptimizedBuffer } from '@opentui/core'
import { useRenderer } from '@opentui/solid'
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'

import { errorMessage } from '../core/errors'
import { cellFit, decodeImage, resample, toCells } from '../core/image'
import type { CellImage, RawImage } from '../core/image'
import {
  claimScreen,
  encodeDelete,
  encodePlace,
  placementError,
  supportsKittyImages,
} from '../core/kittyImage'
import type { CellSize } from '../core/kittyImage'
import { ui } from '../themes'

interface ImageViewProps {
  path: string
  width: number
  height: number
  blocked?: boolean
  onFocus: () => void
}

type Loaded = { image: RawImage; kb: string } | { error: string }

const CELL_FALLBACK: CellSize = { height: 16, width: 8 }

// The Zig core owns the output stream and writes frames from its own thread, so a second
// writer on the same fd splices bytes into a frame. `writeOut` is the renderer's own
// serialised path — private, and what its capture-stdout mode installs over
// `process.stdout.write`; it falls back to stdout itself when nothing owns the stream.
interface NativeOut {
  writeOut?: (chunk: string) => boolean
}

function serialWrite(renderer: object): (text: string) => void {
  const out = (renderer as NativeOut).writeOut
  if (typeof out !== 'function') {
    return (text) => {
      process.stdout.write(text)
    }
  }
  return (text) => {
    out.call(renderer, text)
  }
}

let nextId = 1

// Painted into the frame buffer: per-cell `<text>` hits the Zig core's renderable cap.
export function ImageView(props: ImageViewProps) {
  const renderer = useRenderer()
  const write = serialWrite(renderer)
  const [box, setBox] = createSignal<BoxRenderable | null>(null)
  const id = nextId
  nextId += 1

  const loaded = createMemo<Loaded>(() => {
    try {
      const image = decodeImage(props.path)
      return { image, kb: `${Math.max(1, Math.round(image.bytes / 1024))} KB` }
    } catch (error) {
      return { error: errorMessage(error) }
    }
  })

  const cellSize = (): CellSize => {
    const res = renderer.resolution
    const cols = renderer.terminalWidth
    const rows = renderer.terminalHeight
    if (!res || !cols || !rows) {
      return CELL_FALLBACK
    }
    const cell = { height: res.height / rows, width: res.width / cols }
    return cell.width > 0 && cell.height > 0 ? cell : CELL_FALLBACK
  }

  let shown = ''
  const clearNative = () => {
    if (!shown) {
      return
    }
    shown = ''
    write(encodeDelete(id))
  }
  onCleanup(clearNative)

  // The renderer answers the capability query after mount and exposes no signal for it.
  const [graphics, setGraphics] = createSignal(false)
  const [refused, setRefused] = createSignal<string | null>(null)

  onMount(() => {
    const handler = (sequence: string) => {
      const error = placementError(sequence, id)
      if (!error) {
        return false
      }
      setRefused(error)
      clearNative()
      return true
    }
    renderer.prependInputHandler(handler)
    onCleanup(() => renderer.removeInputHandler(handler))
  })

  const native = createMemo(() => {
    const l = loaded()
    if ('error' in l || !graphics() || refused()) {
      return null
    }
    const cell = cellSize()
    const cells = cellFit(
      l.image,
      Math.max(1, props.width),
      Math.max(1, props.height - 1)
    )
    const scaled = resample(
      l.image,
      Math.round(cells.cols * cell.width),
      Math.round(cells.rows * cell.height)
    )
    return { cells, ...scaled }
  })

  const view = createMemo<CellImage | null>(() => {
    const l = loaded()
    if ('error' in l) {
      return null
    }
    return toCells(
      l.image,
      Math.max(1, props.width),
      Math.max(1, props.height - 1)
    )
  })

  const painted = createMemo(() => {
    const cells = view()
    if (!cells) {
      return null
    }
    const pane = RGBA.fromHex(ui.bg)
    const colors: ({ fg: RGBA; bg: RGBA } | null)[] = Array.from({
      length: cells.cols * cells.rows,
    })
    for (let at = 0; at < colors.length; at += 1) {
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
          : RGBA.fromInts(
              cells.cells[i]!,
              cells.cells[i + 1]!,
              cells.cells[i + 2]!,
              alpha
            )
      colors[at] = { bg: channel(o + 4, lowerA), fg: channel(o, upperA) }
    }
    return { colors, cols: cells.cols, rows: cells.rows }
  })

  const place = (
    left: number,
    top: number,
    image: NonNullable<ReturnType<typeof native>>
  ) => {
    if (props.blocked) {
      return clearNative()
    }
    // Terminal rows and columns are 1-based; the renderable's are not.
    const key = `${props.path}:${left},${top},${image.cells.cols},${image.cells.rows}`
    if (key === shown) {
      return
    }
    claimScreen(write)
    const redraw = shown ? encodeDelete(id) : ''
    shown = key
    write(
      redraw +
        encodePlace(
          image.pixels,
          image.width,
          image.height,
          { col: left + 1, row: top + 1 },
          image.cells,
          id
        )
    )
  }

  // Runs every frame outside Solid's tracking; the memos and the box's position are settled by then.
  const draw = (buffer: OptimizedBuffer) => {
    const host = box()
    if (!host) {
      return
    }
    const supported = supportsKittyImages(renderer.capabilities?.kitty_graphics)
    if (supported !== graphics()) {
      setGraphics(supported)
    }
    const image = painted()
    if (!image) {
      return
    }
    const left = host.x + Math.max(0, Math.floor((host.width - image.cols) / 2))
    const top = host.y + Math.max(0, Math.floor((host.height - image.rows) / 2))
    for (let row = 0; row < image.rows; row += 1) {
      for (let col = 0; col < image.cols; col += 1) {
        const cell = image.colors[row * image.cols + col]
        if (!cell) {
          continue
        }
        buffer.setCellWithAlphaBlending(
          left + col,
          top + row,
          '▀',
          cell.fg,
          cell.bg
        )
      }
    }
    // Over the cells, never instead of them: a terminal that ignores the escape keeps the blocks.
    const inline = native()
    if (inline) {
      place(left, top, inline)
    } else {
      clearNative()
    }
  }

  const caption = () => {
    const l = loaded()
    if ('error' in l) {
      return `Cannot show ${basename(props.path)}: ${l.error}`
    }
    const note = refused() ? ` · terminal refused the image: ${refused()}` : ''
    return `${basename(props.path)} — ${l.image.width}×${l.image.height} · ${l.kb}${note}`
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
        <box
          flexGrow={1}
          backgroundColor={ui.bg}
          ref={setBox}
          renderAfter={draw}
        />
      </Show>
    </box>
  )
}
