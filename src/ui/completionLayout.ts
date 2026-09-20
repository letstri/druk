import { hasInfo } from '../lsp/completion'
import type { ItemInfo, Match } from '../lsp/completion'
import { cut, wrapText } from './text'

const MENU_ROWS = 12
const DOC_ROWS = 9
const SIG_ROWS = 3
const LABEL_MAX = 44
export const SIG_MAX = 34
export const DESC_MAX = 26
const MIN_WIDTH = 28
const DOC_WIDTH = 56
export const ROW_CHROME = 4
const CHROME_ROWS = 3

// `start` is the row's offset into the flattened signature: spans are sliced back onto rows.
export interface SignatureLine {
  text: string
  start: number
}

export interface MenuLayout {
  width: number
  height: number
  rows: number
  panelRows: number
  signature: SignatureLine[]
  documentation: string[]
  origin: string
}

export function signatureOf(item: Match['item']): string {
  return item.labelDetails?.detail ?? (item.detail ?? '').replaceAll(/\s+/g, ' ').trim()
}

function widthFor(matches: Match[], panel: boolean, max: number): number {
  let content = 0
  for (const match of matches.slice(0, MENU_ROWS)) {
    const label = Math.min(match.item.label.length, LABEL_MAX)
    const signature = Math.min(signatureOf(match.item).length, SIG_MAX)
    const description = Math.min(match.item.labelDetails?.description?.length ?? 0, DESC_MAX)
    content = Math.max(
      content,
      label + (signature > 0 ? 1 + signature : 0) + (description > 0 ? 2 + description : 0),
    )
  }
  const want = Math.max(MIN_WIDTH, content + ROW_CHROME + 2)
  return Math.min(Math.max(want, panel ? DOC_WIDTH : 0), max)
}

// The offsets hold only because `itemInfo` collapsed the whitespace: a break costs one space.
function wrapSignature(text: string, width: number): SignatureLine[] {
  const lines: SignatureLine[] = []
  let line = ''
  let start = 0
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0]
    const at = match.index
    if (line && line.length + 1 + word.length > width) {
      lines.push({ text: line, start })
      line = ''
    }
    if (word.length > width) {
      if (line) lines.push({ text: line, start })
      for (let from = 0; from < word.length; from += width) {
        lines.push({ text: word.slice(from, from + width), start: at + from })
      }
      line = ''
      continue
    }
    if (!line) start = at
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push({ text: line, start })
  return lines
}

function wrapBlock(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      if (lines.length > 0) lines.push('')
    } else lines.push(...wrapText(paragraph, width))
  }
  return lines
}

function capped(lines: string[], rows: number): string[] {
  if (rows <= 0) return []
  if (lines.length <= rows) return lines
  const kept = lines.slice(0, rows)
  kept[rows - 1] = `${kept[rows - 1]!.slice(0, Math.max(0, kept[rows - 1]!.length - 1))}…`
  return kept
}

// `floor` is the panel's high-water mark, carried by the caller: a box that shrank would jump.
export function layoutMenu(
  matches: Match[],
  info: ItemInfo | null,
  max: { width: number; height: number },
  panel: boolean,
  floor = 0,
): MenuLayout {
  const width = widthFor(matches, panel, Math.max(MIN_WIDTH, max.width))
  if (matches.length === 0) {
    return {
      width,
      height: 3,
      rows: 0,
      panelRows: 0,
      signature: [],
      documentation: [],
      origin: '',
    }
  }
  const inner = width - 2
  const shown = Math.min(matches.length, MENU_ROWS)
  const room = Math.min(DOC_ROWS, max.height - CHROME_ROWS - shown - 1)
  let panelRows = panel && room >= 2 ? Math.min(floor, room) : 0

  let signature: SignatureLine[] = []
  let documentation: string[] = []
  let origin = ''
  if (panel && room >= 2 && hasInfo(info)) {
    const wrapped = info.detail ? wrapSignature(info.detail, inner - 2) : []
    const docs = wrapBlock(info.documentation, inner - 2)
    const need = wrapped.length + docs.length + (info.source ? 1 : 0)
    panelRows = Math.max(panelRows, Math.min(room, need))
    const rows = capped(
      wrapped.map(line => line.text),
      Math.min(Math.max(SIG_ROWS, panelRows - docs.length), panelRows),
    )
    signature = rows.map((text, at) => ({ text, start: wrapped[at]!.start }))
    documentation = capped(docs, panelRows - signature.length)
    if (panelRows > signature.length + documentation.length && info.source) {
      origin = cut(info.source, inner - 2)
    }
  }
  const reserved = panelRows > 0 ? panelRows + 1 : 0
  const rows = Math.max(1, Math.min(shown, max.height - CHROME_ROWS - reserved))
  return {
    width,
    height: CHROME_ROWS + rows + reserved,
    rows,
    panelRows,
    signature,
    documentation,
    origin,
  }
}
