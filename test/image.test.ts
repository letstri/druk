import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encode } from 'fast-png'

import { decodeImage, isImagePath, toCells } from '../src/core/image'
import type { RawImage } from '../src/core/image'
import { tempDir } from './temp'

/** A PNG on disk with the given RGBA pixels. */
function pngFixture(width: number, height: number, rgba: number[]): string {
  const dir = tempDir('druk-img-')
  const path = join(dir, 'img.png')
  writeFileSync(path, encode({ width, height, data: new Uint8Array(rgba), channels: 4 }))
  return path
}

const raw = (width: number, height: number, rgba: number[]): RawImage => ({
  width,
  height,
  pixels: new Uint8Array(rgba),
  bytes: rgba.length,
})

describe('isImagePath', () => {
  test('matches the decodable extensions, case-insensitively', () => {
    expect(isImagePath('/a/logo.png')).toBe(true)
    expect(isImagePath('/a/photo.JPG')).toBe(true)
    expect(isImagePath('/a/photo.jpeg')).toBe(true)
    expect(isImagePath('/a/anim.gif')).toBe(false)
    expect(isImagePath('/a/main.ts')).toBe(false)
    expect(isImagePath('/a/png')).toBe(false)
  })
})

describe('decodeImage', () => {
  test('round-trips RGBA pixels through a PNG on disk', () => {
    const path = pngFixture(2, 1, [255, 0, 0, 255, 0, 0, 255, 128])
    const img = decodeImage(path)
    expect(img.width).toBe(2)
    expect(img.height).toBe(1)
    expect([...img.pixels]).toEqual([255, 0, 0, 255, 0, 0, 255, 128])
    expect(img.bytes).toBeGreaterThan(0)
  })

  test('throws a readable error on a file that is not an image', () => {
    const dir = tempDir('druk-img-')
    const path = join(dir, 'fake.png')
    writeFileSync(path, 'not a png at all')
    expect(() => decodeImage(path)).toThrow()
  })
})

describe('toCells', () => {
  test('maps two pixel rows onto one cell row', () => {
    // 1x2: red above, blue below — one cell, red foreground, blue background.
    const img = raw(1, 2, [255, 0, 0, 255, 0, 0, 255, 255])
    const cells = toCells(img, 10, 10)
    expect(cells.cols).toBe(1)
    expect(cells.rows).toBe(1)
    expect([...cells.cells]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  test('leaves the lower half transparent when the pixel height is odd', () => {
    const img = raw(1, 1, [10, 20, 30, 255])
    const cells = toCells(img, 10, 10)
    expect(cells.rows).toBe(1)
    // Upper pixel set, lower untouched: alpha 0.
    expect([...cells.cells]).toEqual([10, 20, 30, 255, 0, 0, 0, 0])
  })

  test('never upscales past one image pixel per half-block', () => {
    const img = raw(
      2,
      2,
      Array.from({ length: 16 }, () => 255),
    )
    const cells = toCells(img, 100, 100)
    expect(cells.cols).toBe(2)
    expect(cells.rows).toBe(1)
  })

  test('downscales to fit and keeps the aspect ratio', () => {
    // 100x100 into 10 columns: 10x10 pixels -> 10 cols, 5 cell rows.
    const img = raw(
      100,
      100,
      Array.from({ length: 100 * 100 * 4 }, () => 128),
    )
    const cells = toCells(img, 10, 100)
    expect(cells.cols).toBe(10)
    expect(cells.rows).toBe(5)
  })

  test('box-averages the source pixels a target pixel covers', () => {
    // 2x4 greys into one column: halving keeps the aspect, so the cell's upper
    // half averages the top 2x2 block and the lower half the bottom one.
    const grey = (v: number) => [v, v, v, 255]
    const img = raw(2, 4, [
      ...grey(100),
      ...grey(200),
      ...grey(100),
      ...grey(200),
      ...grey(0),
      ...grey(50),
      ...grey(0),
      ...grey(50),
    ])
    const cells = toCells(img, 1, 10)
    expect(cells.cols).toBe(1)
    expect(cells.rows).toBe(1)
    const got = [...cells.cells]
    expect(got.slice(0, 4)).toEqual([150, 150, 150, 255])
    expect(got.slice(4, 8)).toEqual([25, 25, 25, 255])
  })
})
