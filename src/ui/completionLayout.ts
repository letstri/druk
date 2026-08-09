/**
 * How big the completion popup is and what its detail panel holds — pure
 * computation, so `test/completion.test.ts` can exercise it without rendering.
 * EditorPane needs the box to place and flip it; `CompletionMenu` needs the rows
 * to draw, and the two must agree or the border lands over the wrong line.
 */
import { hasInfo } from '../lsp/completion'
import type { ItemInfo, Match } from '../lsp/completion'
import { wrapText } from './text'

/** Content rows the list shows at most; more of them scroll behind the counter. */
export const MENU_ROWS = 12
/** Rows the detail panel under the list may take, signature included. */
const DOC_ROWS = 9
/** Of those, how many a wrapped signature may take before the docs start. */
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

export interface MenuLayout {
  width: number
  height: number
  /** List rows drawn — fewer than `MENU_ROWS` when the pane is short. */
  rows: number
  /** Rows reserved for the detail panel, filled or not; 0 when there is none. */
  panelRows: number
  /** The selected item's signature, wrapped to the panel. */
  signature: string[]
  /** Its documentation, wrapped, blank rows kept where paragraphs break. */
  documentation: string[]
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
    return { width, height: 3, rows: 0, panelRows: 0, signature: [], documentation: [] }
  }
  const inner = width - 2
  const shown = Math.min(matches.length, MENU_ROWS)
  // What is left for the panel once the list and the panel's own divider are
  // paid for; under two rows it is not worth the divider.
  const room = Math.min(DOC_ROWS, max.height - CHROME_ROWS - shown - 1)
  const panelRows = panel && room >= 2 ? room : 0

  let signature: string[] = []
  let documentation: string[] = []
  if (panelRows > 0 && hasInfo(info)) {
    signature = capped(
      info.detail ? wrapBlock(info.detail, inner - 2) : [],
      Math.min(SIG_ROWS, panelRows),
    )
    documentation = capped(wrapBlock(info.documentation, inner - 2), panelRows - signature.length)
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
  }
}
