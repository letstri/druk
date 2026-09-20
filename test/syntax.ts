import { computeHighlights, segmentsIn, STALE } from '../src/languages/highlight'
import type { Highlighted, Segment } from '../src/languages/highlight'

export const WHOLE = Number.POSITIVE_INFINITY

export async function parseHighlights(
  content: string,
  filetype: string,
  tabSize = 2,
): Promise<Highlighted> {
  const parsed = await computeHighlights(content, filetype, tabSize)
  if (parsed === STALE) throw new Error('unexpected STALE')
  return parsed
}

export async function allSegments(
  content: string,
  filetype: string,
  tabSize = 2,
): Promise<Segment[]> {
  return segmentsIn(await parseHighlights(content, filetype, tabSize), 0, WHOLE)
}
