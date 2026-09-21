import { TextAttributes } from '@opentui/core'
import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

import {
  computeHighlights,
  filetypeForPath,
  segmentsIn,
  STALE,
  styleForId,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { paintedTheme } from '../themes'

export interface Span {
  text: string
  fg?: string
  attributes?: number
}

export interface CodeSource {
  path: string
  text: string
}

const MAX_HIGHLIGHT_BYTES = 512 * 1024

export function sliceSpans(
  spans: readonly Span[],
  from: number,
  to: number
): Span[] {
  const out: Span[] = []
  let col = 0
  for (const span of spans) {
    const start = Math.max(from, col)
    const end = Math.min(to, col + span.text.length)
    if (end > start) {
      out.push({ ...span, text: span.text.slice(start - col, end - col) })
    }
    col += span.text.length
  }
  return out
}

/** Parses whatever `source` names, off the frame, and forgets it when the source changes. */
export function createHighlighted(
  source: Accessor<CodeSource | null>
): Accessor<Highlighted | null> {
  const [parsed, setParsed] = createSignal<Highlighted | null>(null)
  createEffect(
    on(source, (file) => {
      setParsed(null)
      if (!file || file.text.length > MAX_HIGHLIGHT_BYTES) {
        return
      }
      let dropped = false
      onCleanup(() => {
        dropped = true
      })
      void (async () => {
        const doc = await computeHighlights(
          file.text,
          filetypeForPath(file.path),
          2,
          () => dropped
        )
        if (!dropped && doc !== STALE) {
          setParsed(doc)
        }
      })()
    })
  )
  return parsed
}

// A segment carrying only a background (indent guides) is skipped, or the preview comes out striped.
export function paintLine(
  doc: Highlighted | null,
  line: string,
  at: number,
  plain: string
): Span[] {
  // Read for the dependency: style ids are per theme table.
  paintedTheme()
  const out: Span[] = []
  let col = 0
  for (const segment of doc ? segmentsIn(doc, at, at) : []) {
    const style = styleForId(segment.styleId)
    const fg = typeof style?.fg === 'string' ? style.fg : undefined
    if (!style || !fg || segment.start < col) {
      continue
    }
    if (segment.start > col) {
      out.push({ fg: plain, text: line.slice(col, segment.start) })
    }
    out.push({
      attributes:
        (style.bold ? TextAttributes.BOLD : 0) +
        (style.italic ? TextAttributes.ITALIC : 0),
      fg,
      text: line.slice(segment.start, segment.end),
    })
    col = segment.end
  }
  if (col < line.length) {
    out.push({ fg: plain, text: line.slice(col) })
  }
  return out
}
