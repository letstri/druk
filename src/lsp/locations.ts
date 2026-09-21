import { fileURLToPath } from 'node:url'

import type { Location, LocationLink, Range } from './protocol'

// 0-based.
export interface Target {
  path: string
  line: number
  col: number
}

export interface LocationHit extends Target {
  label: string
  note: string
}

export type LocationMethod =
  | 'definition'
  | 'implementation'
  | 'typeDefinition'
  | 'references'

export function targetOf(
  uri: unknown,
  range: Range | undefined
): Target | null {
  if (typeof uri !== 'string') {
    return null
  }
  try {
    return {
      col: range?.start.character ?? 0,
      line: range?.start.line ?? 0,
      path: fileURLToPath(uri),
    }
  } catch {
    return null
  }
}

export function normalizeLocations(result: unknown): Target[] {
  const list = Array.isArray(result) ? result : [result]
  const targets: Target[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const entry = raw as Partial<Location> & Partial<LocationLink>
    // The selection range is the name; the target range starts at the doc comment.
    const range = entry.targetSelectionRange ?? entry.targetRange ?? entry.range
    if (!range) {
      continue
    }
    const target = targetOf(entry.targetUri ?? entry.uri, range)
    if (target) {
      targets.push(target)
    }
  }
  return targets
}
