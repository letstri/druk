import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

import { convertIndexedToRgb, decode as decodePng } from 'fast-png'
import { decode as decodeJpeg } from 'jpeg-js'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extname(path).toLowerCase())
}

export interface RawImage {
  width: number
  height: number
  // RGBA, 8 bits per channel, row-major.
  pixels: Uint8Array
  bytes: number
}

export function decodeImage(path: string): RawImage {
  const bytes = readFileSync(path)
  const ext = extname(path).toLowerCase()
  if (ext === '.png') {
    const png = decodePng(bytes)
    const data = png.palette ? convertIndexedToRgb(png) : png.data
    const channels = png.palette ? 3 : png.channels
    return {
      width: png.width,
      height: png.height,
      pixels: toRgba(data, png.width * png.height, channels, png.palette ? 8 : png.depth),
      bytes: bytes.byteLength,
    }
  }
  const jpg = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true })
  return { width: jpg.width, height: jpg.height, pixels: jpg.data, bytes: bytes.byteLength }
}

function toRgba(
  data: Uint8Array | Uint8ClampedArray | Uint16Array,
  count: number,
  channels: number,
  depth: number,
): Uint8Array {
  const read = depth === 16 ? (i: number) => (data[i] ?? 0) >> 8 : (i: number) => data[i] ?? 0
  const out = new Uint8Array(count * 4)
  for (let p = 0; p < count; p++) {
    const at = p * channels
    const o = p * 4
    if (channels >= 3) {
      out[o] = read(at)
      out[o + 1] = read(at + 1)
      out[o + 2] = read(at + 2)
      out[o + 3] = channels === 4 ? read(at + 3) : 255
    } else {
      const grey = read(at)
      out[o] = grey
      out[o + 1] = grey
      out[o + 2] = grey
      out[o + 3] = channels === 2 ? read(at + 1) : 255
    }
  }
  return out
}

export interface CellImage {
  cols: number
  rows: number
  // 8 bytes per cell, row-major: the upper pixel's RGBA then the lower's; drawn as `▀`.
  cells: Uint8Array
}

export function toCells(img: RawImage, maxCols: number, maxRows: number): CellImage {
  const scale = Math.min(maxCols / img.width, (maxRows * 2) / img.height, 1)
  const cols = Math.max(1, Math.round(img.width * scale))
  const pixelRows = Math.max(1, Math.round(img.height * scale))
  const rows = Math.ceil(pixelRows / 2)
  const cells = new Uint8Array(cols * rows * 8)
  for (let y = 0; y < pixelRows; y++) {
    for (let x = 0; x < cols; x++) {
      const rgba = boxAverage(img, x, y, cols, pixelRows)
      const cell = (Math.floor(y / 2) * cols + x) * 8 + (y % 2) * 4
      cells.set(rgba, cell)
    }
  }
  // An odd pixel count leaves the last row's lower halves at alpha 0: the viewer's pane background.
  return { cols, rows, cells }
}

function boxAverage(
  img: RawImage,
  tx: number,
  ty: number,
  targetW: number,
  targetH: number,
): [number, number, number, number] {
  const x0 = Math.floor((tx * img.width) / targetW)
  const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / targetW))
  const y0 = Math.floor((ty * img.height) / targetH)
  const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / targetH))
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const at = (y * img.width + x) * 4
      r += img.pixels[at]!
      g += img.pixels[at + 1]!
      b += img.pixels[at + 2]!
      a += img.pixels[at + 3]!
    }
  }
  const n = (x1 - x0) * (y1 - y0)
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]
}
