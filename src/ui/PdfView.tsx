import { basename } from 'node:path'

import { RGBA } from '@opentui/core'
import type { BoxRenderable, KeyEvent, OptimizedBuffer } from '@opentui/core'
import { useRenderer } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'

import { errorMessage } from '../core/errors'
import { toCells } from '../core/image'
import type { CellImage } from '../core/image'
import { centerPdfPan, clampPdfPan, openPdf, stepPdfZoom } from '../core/pdf'
import type { PdfFile, PdfPan } from '../core/pdf'
import { ui } from '../themes'
import { useKeys } from './useKeys'

export interface PdfViewProps {
  path: string | null
  width: number
  height: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
}

interface Painted {
  cols: number
  rows: number
  colors: Array<{ fg: RGBA; bg: RGBA } | null>
}

interface RenderRequest {
  id: number
  pdf: PdfFile
  page: number
  cols: number
  rows: number
  zoom: number
}

const PAN_COLS = 4
const PAN_ROWS = 2

function cellColor(cells: Uint8Array, pane: RGBA, channel: number, alpha: number): RGBA {
  return alpha === 0
    ? pane
    : RGBA.fromInts(cells[channel]!, cells[channel + 1]!, cells[channel + 2]!, alpha)
}

async function closePdf(pdf: PdfFile): Promise<void> {
  try {
    await pdf.close()
  } catch {
    // There is nowhere to report cleanup failure after a path leaves the viewer.
  }
}

export function PdfView(props: PdfViewProps) {
  const renderer = useRenderer()
  const [host, setHost] = createSignal<BoxRenderable | null>(null)
  const [pdf, setPdf] = createSignal<PdfFile | null>(null)
  const [page, setPage] = createSignal(0)
  const [zoom, setZoom] = createSignal(100)
  const [pan, setPan] = createSignal<PdfPan>({ x: 0, y: 0 })
  const [cells, setCells] = createSignal<CellImage | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  let requestId = 0
  let wanted: RenderRequest | null = null
  let draining = false
  let pendingPath: string | null | undefined
  let opening = false
  let owned: PdfFile | null = null
  let disposed = false

  const drainOpen = async () => {
    if (opening) return
    opening = true
    try {
      while (pendingPath !== undefined) {
        if (disposed) break
        const path = pendingPath
        pendingPath = undefined
        const previous = owned
        owned = null
        if (previous) await closePdf(previous)
        if (disposed) break
        if (pendingPath !== undefined || !path) continue

        try {
          const opened = await openPdf(path)
          if (disposed || pendingPath !== undefined || props.path !== path) {
            await closePdf(opened)
            continue
          }
          owned = opened
          setPdf(opened)
        } catch (cause) {
          if (!disposed && pendingPath === undefined && props.path === path) {
            setError(errorMessage(cause))
            setLoading(false)
          }
        }
      }
    } finally {
      opening = false
      if (!disposed && pendingPath !== undefined) void drainOpen()
    }
  }

  createEffect(
    on(
      () => props.path,
      path => {
        requestId++
        wanted = null
        pendingPath = path
        setPdf(null)
        setPage(0)
        setZoom(100)
        setPan({ x: 0, y: 0 })
        setCells(null)
        setError(null)
        setLoading(true)
        void drainOpen()
      },
    ),
  )

  onCleanup(() => {
    disposed = true
    requestId++
    wanted = null
    pendingPath = undefined
    const live = owned
    owned = null
    if (live) void closePdf(live)
  })

  const painted = createMemo<Painted | null>(() => {
    const image = cells()
    if (!image) return null
    const pane = RGBA.fromHex(ui.bg)
    const colors: Painted['colors'] = Array.from({ length: image.cols * image.rows })
    for (let at = 0; at < colors.length; at++) {
      const offset = at * 8
      const upperAlpha = image.cells[offset + 3]!
      const lowerAlpha = image.cells[offset + 7]!
      if (upperAlpha === 0 && lowerAlpha === 0) {
        colors[at] = null
        continue
      }
      colors[at] = {
        fg: cellColor(image.cells, pane, offset, upperAlpha),
        bg: cellColor(image.cells, pane, offset + 4, lowerAlpha),
      }
    }
    return { cols: image.cols, rows: image.rows, colors }
  })

  const drain = async () => {
    if (draining) return
    draining = true
    while (wanted) {
      const request = wanted
      wanted = null
      setLoading(true)
      try {
        const image = await request.pdf.renderPage(
          request.page,
          request.cols,
          request.rows,
          request.zoom,
        )
        if (request.id !== requestId) continue
        const next = toCells(image, image.width, Math.ceil(image.height / 2))
        setCells(next)
        setPan(centerPdfPan(next.cols, next.rows, request.cols, request.rows))
        setError(null)
      } catch (cause) {
        if (request.id === requestId) setError(errorMessage(cause))
      }
    }
    draining = false
    setLoading(false)
  }

  createEffect(() => {
    const opened = pdf()
    const currentPage = page()
    const currentZoom = zoom()
    const cols = Math.max(1, Math.floor(props.width))
    const rows = Math.max(1, Math.floor(props.height - 1))
    if (!opened) return
    wanted = {
      id: ++requestId,
      pdf: opened,
      page: currentPage,
      cols,
      rows,
      zoom: currentZoom,
    }
    setCells(null)
    void drain()
  })

  const movePage = (delta: number) => {
    const opened = pdf()
    if (!opened) return
    setPage(current => Math.max(0, Math.min(opened.pageCount - 1, current + delta)))
  }

  const movePan = (dx: number, dy: number) => {
    const image = painted()
    const box = host()
    if (!image || !box) return
    setPan(current =>
      clampPdfPan(
        { x: current.x + dx, y: current.y + dy },
        image.cols,
        image.rows,
        box.width,
        box.height,
      ),
    )
    renderer.requestRender()
  }

  useKeys((key: KeyEvent, name: string) => {
    if (!props.path || props.blocked || !props.focused || key.defaultPrevented) return
    if (name === 'pageup' || name === 'k') movePage(-1)
    else if (name === 'pagedown' || name === 'j' || name === 'space') movePage(1)
    else if (name === '+' || name === '=') setZoom(current => stepPdfZoom(current, 1))
    else if (name === '-') setZoom(current => stepPdfZoom(current, -1))
    else if (name === '0') setZoom(100)
    else if (name === 'left') movePan(-PAN_COLS, 0)
    else if (name === 'right') movePan(PAN_COLS, 0)
    else if (name === 'up') movePan(0, -PAN_ROWS)
    else if (name === 'down') movePan(0, PAN_ROWS)
    else return
    key.preventDefault()
  })

  const draw = (buffer: OptimizedBuffer) => {
    const box = host()
    const image = painted()
    if (!box || !image) return
    const offset = clampPdfPan(pan(), image.cols, image.rows, box.width, box.height)
    const cols = Math.min(box.width, image.cols - offset.x)
    const rows = Math.min(box.height, image.rows - offset.y)
    const left = box.x + Math.max(0, Math.floor((box.width - image.cols) / 2))
    const top = box.y + Math.max(0, Math.floor((box.height - image.rows) / 2))

    buffer.pushScissorRect(box.x, box.y, box.width, box.height)
    try {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = image.colors[(row + offset.y) * image.cols + col + offset.x]
          if (cell) buffer.setCellWithAlphaBlending(left + col, top + row, '▀', cell.fg, cell.bg)
        }
      }
    } finally {
      buffer.popScissorRect()
    }
  }

  const size = () => {
    const opened = pdf()
    return opened ? `${Math.max(1, Math.round(opened.bytes / 1024))} KB` : ''
  }

  const caption = () => {
    const failure = error()
    if (failure) return `Cannot show ${basename(props.path ?? '')}: ${failure}`
    const opened = pdf()
    if (!opened) return `${basename(props.path ?? '')} — loading…`
    const base = `${basename(props.path ?? '')} — ${page() + 1}/${opened.pageCount} · ${zoom()}% · ${size()}`
    return loading() ? `${base} · rendering…` : base
  }

  const hints = () => {
    const full = ' PgUp/PgDn page · +/- zoom · arrows pan · 0 fit '
    return full.length + caption().length <= props.width ? full : ' +/- zoom · 0 fit '
  }

  return (
    <Show when={props.path}>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={40}
        flexDirection="column"
        backgroundColor={ui.bg}
        onMouseDown={() => props.onFocus()}
      >
        <box flexDirection="row" backgroundColor={ui.bg}>
          <text fg={ui.dim} bg={ui.bg} flexShrink={0} content={` ${caption()}`} />
          <box flexGrow={1} backgroundColor={ui.bg} />
          <text fg={ui.faint} bg={ui.bg} flexShrink={0} content={hints()} />
        </box>
        <Show when={painted()}>
          <box flexGrow={1} backgroundColor={ui.bg} ref={setHost} renderAfter={draw} />
        </Show>
      </box>
    </Show>
  )
}
