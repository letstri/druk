/**
 * How big the completion popup is and what its detail panel holds — pure
 * computation, so `test/completion.test.ts` can exercise it without rendering.
 * EditorPane needs the box to place and flip it; `CompletionMenu` needs the rows
 * to draw, and the two must agree or the border lands over the wrong line.
 */
import { hasInfo } from '../lsp/completion'
import type { ItemInfo, Match } from '../lsp/completion'
import { cut, wrapText } from './text'

/** Content rows the list shows at most; more of them scroll behind the counter. */
export const MENU_ROWS = 12
/** Rows the detail panel under the list may take, signature included. */
const DOC_ROWS = 9
/** Rows a wrapped signature is always granted, however long the docs are. */
const SIG_ROWS = 3
/** Space each column may take before it is cut. */
const LABEL_MAX = 44
export const SIG_MAX = 34
export const DESC_MAX = 26
const MIN_WIDTH = 28
/** A panel narrower than this wraps a signature into confetti. */
const DOC_WIDTH = 56
/** Bar, glyph pair and scrollbar: the columns a row spends on no text. */
export const ROW_CHROME = 4
/** Border pair, the list, and the counter row under it. */
const CHROME_ROWS = 3

/**
 * One row of a wrapped signature. `start` is where the row begins in the
 * flattened signature, which is what lets the panel paint it: the highlighter
 * parses that one string and the spans are sliced back onto these rows.
 */
export interface SignatureLine {
  text: string
  start: number
}

export interface MenuLayout {
  width: number
  height: number
  /** List rows drawn — fewer than `MENU_ROWS` when the pane is short. */
  rows: number
  /** Rows reserved for the detail panel, filled or not; 0 when there is none. */
  panelRows: number
  /** The selected item's signature, wrapped to the panel. */
  signature: SignatureLine[]
  /** Its documentation, wrapped, blank rows kept where paragraphs break. */
  documentation: string[]
  /** Where the symbol comes from, drawn only into a row that would be blank. */
  origin: string
}

/** What a row draws beside the label: the server's own pairing, else its detail. */
export function signatureOf(item: Match['item']): string {
  return item.labelDetails?.detail ?? (item.detail ?? '').replaceAll(/\s+/g, ' ').trim()
}

/**
 * Width the menu wants for these matches: glyph, label, signature, origin —
 * capped per column so one verbose signature cannot push the box across the
 * pane, and widened to `DOC_WIDTH` when there is a detail panel to fill.
 */
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

/**
 * `wrapText` over a single-spaced string, with each row's offset into it. The
 * offsets are only meaningful because `itemInfo` collapsed the signature's
 * whitespace: a row break costs exactly the one space it replaces, so a row's
 * characters sit contiguously in the source the panel colours from.
 */
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

/** Wrap `text` to `width`, keeping the blank rows that separate paragraphs. */
function wrapBlock(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      if (lines.length > 0) lines.push('')
    } else lines.push(...wrapText(paragraph, width))
  }
  return lines
}

/** First `rows` of `lines`, the cut marked so the panel does not read as whole. */
function capped(lines: string[], rows: number): string[] {
  if (rows <= 0) return []
  if (lines.length <= rows) return lines
  const kept = lines.slice(0, rows)
  kept[rows - 1] = `${kept[rows - 1]!.slice(0, Math.max(0, kept[rows - 1]!.length - 1))}…`
  return kept
}

/**
 * `max` is the room the pane actually has, and `panel` says whether a detail
 * panel is worth reserving room for at all — a server that cannot resolve one
 * gets the list alone.
 *
 * The panel's height is reserved rather than measured, and the width is the same
 * whether it holds anything or not: walking the list changes what is *in* it
 * every keystroke, and a box that resized itself around each item's docs would
 * jump under the cursor faster than it could be read.
 */
export function layoutMenu(
  matches: Match[],
  info: ItemInfo | null,
  max: { width: number; height: number },
  panel: boolean,
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
  // What is left for the panel once the list and the panel's own divider are
  // paid for; under two rows it is not worth the divider.
  const room = Math.min(DOC_ROWS, max.height - CHROME_ROWS - shown - 1)
  const panelRows = panel && room >= 2 ? room : 0

  let signature: SignatureLine[] = []
  let documentation: string[] = []
  let origin = ''
  if (panelRows > 0 && hasInfo(info)) {
    const wrapped = info.detail ? wrapSignature(info.detail, inner - 2) : []
    const docs = wrapBlock(info.documentation, inner - 2)
    // The signature takes whatever the documentation leaves. Capping it at
    // SIG_ROWS regardless spends the rest of a reserved panel on blank filler
    // while the signature it had room for ends in an ellipsis — which is most
    // items, a TypeScript generic being several rows and its doc comment one.
    const rows = capped(
      wrapped.map(line => line.text),
      Math.min(Math.max(SIG_ROWS, panelRows - docs.length), panelRows),
    )
    signature = rows.map((text, at) => ({ text, start: wrapped[at]!.start }))
    documentation = capped(docs, panelRows - signature.length)
    // Only ever into a row that was going to be drawn blank: the origin is the
    // least of what the panel has to say, and moving the rest down for it would
    // cost documentation the user was reading.
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
