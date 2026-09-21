import { fileURLToPath } from 'node:url'

import type { Location, LocationLink, Range } from './protocol'

// 0-based.
export interface Target {
  path: string
  line: number
  col: number
}

export function normalizeDefinition(result: unknown): Target | null {
  const first = Array.isArray(result) ? result[0] : result
  if (typeof first !== 'object' || first === null) {
    return null
  }
  const entry = first as Partial<Location> & Partial<LocationLink>
  const uri = entry.targetUri ?? entry.uri
  // The selection range is the name; the target range starts at the doc comment.
  const range: Range | undefined =
    entry.targetSelectionRange ?? entry.targetRange ?? entry.range
  if (typeof uri !== 'string' || !range) {
    return null
  }
  try {
    return {
      col: range.start.character,
      line: range.start.line,
      path: fileURLToPath(uri),
    }
  } catch {
    return null
  }
}
