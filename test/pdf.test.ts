import { afterAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  centerPdfPan,
  clampPdfPan,
  isPdfPath,
  openPdf,
  pdfRenderSize,
  stepPdfZoom,
} from '../src/core/pdf'
import { pdfFixture } from './pdf-fixture'
import { tempDir } from './temp'

const dir = tempDir('druk-pdf-')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('PDF geometry', () => {
  test('recognises PDF paths case-insensitively', () => {
    expect(isPdfPath('/tmp/report.pdf')).toBe(true)
    expect(isPdfPath('/tmp/report.PDF')).toBe(true)
    expect(isPdfPath('/tmp/pdf')).toBe(false)
    expect(isPdfPath('/tmp/report.png')).toBe(false)
  })

  test('fits portrait and landscape pages into half-block cells', () => {
    expect(pdfRenderSize(20, 20, 10, 5, 100)).toEqual({ width: 10, height: 10 })
    expect(pdfRenderSize(40, 20, 10, 5, 100)).toEqual({ width: 10, height: 5 })
    expect(pdfRenderSize(20, 20, 10, 5, 400)).toEqual({ width: 40, height: 40 })
    expect(pdfRenderSize(20, 20, 0, 0, 100)).toEqual({ width: 1, height: 1 })
  })

  test('rejects non-finite and unsafe render geometry', () => {
    for (const pageSize of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(() => pdfRenderSize(pageSize, 20, 10, 5, 100)).toThrow('PDF page has no size')
      expect(() => pdfRenderSize(20, pageSize, 10, 5, 100)).toThrow('PDF page has no size')
    }
    for (const viewport of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pdfRenderSize(20, 20, viewport, 5, 100)).toThrow('PDF render size is invalid')
      expect(() => pdfRenderSize(20, 20, 10, viewport, 100)).toThrow('PDF render size is invalid')
    }
    for (const zoom of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pdfRenderSize(20, 20, 10, 5, zoom)).toThrow('PDF render size is invalid')
    }
    expect(() => pdfRenderSize(20, 20, Number.MAX_VALUE, Number.MAX_VALUE, 400)).toThrow(
      'PDF render size is invalid',
    )
  })

  test('steps zoom within the approved bounds', () => {
    expect(stepPdfZoom(100, 1)).toBe(125)
    expect(stepPdfZoom(100, -1)).toBe(75)
    expect(stepPdfZoom(400, 1)).toBe(400)
    expect(stepPdfZoom(25, -1)).toBe(25)
  })

  test('centres and clamps a cell viewport', () => {
    expect(centerPdfPan(40, 20, 10, 5)).toEqual({ x: 15, y: 7 })
    expect(centerPdfPan(5, 4, 10, 5)).toEqual({ x: 0, y: 0 })
    expect(clampPdfPan({ x: 99, y: -5 }, 40, 20, 10, 5)).toEqual({ x: 30, y: 0 })
  })
})

describe('PDFium document', () => {
  test('opens two pages and renders RGBA in the requested fit', async () => {
    const path = join(dir, 'colors.pdf')
    const bytes = pdfFixture()
    writeFileSync(path, bytes)
    const pdf = await openPdf(path)

    expect(pdf.pageCount).toBe(2)
    expect(pdf.bytes).toBe(bytes.byteLength)

    const red = await pdf.renderPage(0, 10, 5, 100)
    expect({ width: red.width, height: red.height }).toEqual({ width: 10, height: 10 })
    const redAt = (5 * red.width + 5) * 4
    expect(Array.from(red.pixels.slice(redAt, redAt + 4))).toEqual([255, 0, 0, 255])

    const blue = await pdf.renderPage(1, 10, 5, 100)
    const blueAt = (5 * blue.width + 5) * 4
    expect(Array.from(blue.pixels.slice(blueAt, blueAt + 4))).toEqual([0, 0, 255, 255])

    await pdf.close()
    await expect(pdf.renderPage(0, 10, 5, 100)).rejects.toThrow('PDF is closed')
  })

  test('reports corrupt and password-protected documents', async () => {
    const corrupt = join(dir, 'corrupt.pdf')
    writeFileSync(corrupt, '%PDF-broken')
    await expect(openPdf(corrupt)).rejects.toThrow('File not in PDF format or corrupted')

    await expect(openPdf(join(import.meta.dir, 'fixtures/pdf-password.pdf'))).rejects.toThrow(
      'Password required or incorrect password',
    )
  })
})
