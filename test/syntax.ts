import {
  computeHighlights,
  getSyntaxStyle,
  segmentsIn,
  STALE,
} from '../src/languages/highlight'
import type { Highlighted, Segment } from '../src/languages/highlight'

export const WHOLE = Number.POSITIVE_INFINITY

export async function parseHighlights(
  content: string,
  filetype: string,
  tabSize = 2
): Promise<Highlighted> {
  const parsed = await computeHighlights(content, filetype, tabSize)
  if (parsed === STALE) {
    throw new Error('unexpected STALE')
  }
  return parsed
}

export async function allSegments(
  content: string,
  filetype: string,
  tabSize = 2
): Promise<Segment[]> {
  return segmentsIn(await parseHighlights(content, filetype, tabSize), 0, WHOLE)
}

/** The text of every painted span, by syntax group. Whitespace-only spans are dropped. */
export async function painted(
  source: string,
  filetype: string
): Promise<(group: string) => string[]> {
  const lines = source.split('\n')
  const style = getSyntaxStyle()
  const byGroup = new Map<number, string[]>()
  for (const segment of await allSegments(source, filetype)) {
    const text =
      lines[segment.line]?.slice(segment.start, segment.end).trim() ?? ''
    if (!text) {
      continue
    }
    byGroup.set(segment.styleId, [
      ...(byGroup.get(segment.styleId) ?? []),
      text,
    ])
  }
  return (group) => byGroup.get(style.getStyleId(group)!) ?? []
}
