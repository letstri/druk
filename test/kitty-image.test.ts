import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'

import { resample } from '../src/core/image'
import {
  claimScreen,
  encodeDelete,
  encodeDeleteAll,
  encodePlace,
  placementError,
  supportsKittyImages,
} from '../src/core/kittyImage'

describe('encodePlace', () => {
  // Noise: a flat fill deflates to a single chunk and would not exercise the chunking.
  let seed = 1
  const pixels = new Uint8Array(64 * 64 * 4).map(() =>
    Math.floor(
      (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 65_536
    )
  )

  test('places the image at a 1-based cell, chunked, with the payload recoverable', () => {
    const out = encodePlace(
      pixels,
      64,
      64,
      { col: 12, row: 3 },
      { cols: 7, rows: 4 },
      9
    )
    expect(out.startsWith('\u001B7\u001B[3;12H')).toBe(true)
    expect(out.endsWith('\u001B8')).toBe(true)

    const chunks = out
      .split('\u001B_G')
      .slice(1)
      .map((part) => part.split('\u001B\\')[0]!.split(';') as [string, string])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]![0]).toContain('a=T,q=1,f=32,o=z,i=9,s=64,v=64,c=7,r=4')
    expect(chunks.every((c) => c[1]!.length <= 4096)).toBe(true)
    expect(chunks.slice(0, -1).every((c) => c[0]!.endsWith('m=1'))).toBe(true)
    expect(chunks.at(-1)![0]).toBe('m=0')

    const payload = Buffer.from(chunks.map((c) => c[1]).join(''), 'base64')
    expect(new Uint8Array(inflateSync(payload))).toEqual(pixels)
  })

  test('deletes by id', () => {
    expect(encodeDelete(9)).toBe('\u001B_Ga=d,d=i,i=9,q=2\u001B\\')
  })

  test('claims the screen once, clearing what an earlier run left behind', () => {
    const written: string[] = []
    claimScreen((t) => written.push(t))
    claimScreen((t) => written.push(t))
    expect(written).toEqual([encodeDeleteAll()])
    expect(encodeDeleteAll()).toBe('\u001B_Ga=d,d=A,q=2\u001B\\')
  })
})

describe('placementError', () => {
  test('reads the terminal verdict for this image and ignores every other reply', () => {
    expect(placementError('\u001B_Gi=4;OK\u001B\\', 4)).toBeNull()
    expect(placementError('\u001B_Gi=4;EINVAL:bad key\u001B\\', 4)).toBe(
      'EINVAL:bad key'
    )
    expect(placementError('\u001B_Gi=9;EINVAL:bad key\u001B\\', 4)).toBeNull()
    expect(placementError('\u001B[6n', 4)).toBeNull()
  })
})

describe('supportsKittyImages', () => {
  test('follows the terminal unless the env overrides it', () => {
    expect(supportsKittyImages(true, {}, true)).toBe(true)
    expect(supportsKittyImages(false, {}, true)).toBe(false)
    expect(supportsKittyImages(false, { DRUK_KITTY_IMAGES: '1' }, true)).toBe(
      true
    )
    expect(supportsKittyImages(true, { DRUK_KITTY_IMAGES: '0' }, true)).toBe(
      false
    )
    expect(supportsKittyImages(true, {}, false)).toBe(false)
  })
})

test('resample averages the pixels it merges', () => {
  const pixels = new Uint8Array([
    0, 0, 0, 255, 100, 100, 100, 255, 50, 50, 50, 255, 50, 50, 50, 255,
  ])
  const out = resample({ bytes: 0, height: 2, pixels, width: 2 }, 1, 1)
  expect(out).toMatchObject({ height: 1, width: 1 })
  expect([...out.pixels]).toEqual([50, 50, 50, 255])
})
