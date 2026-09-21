import { relative } from 'node:path'

import type { LocationHit, Target } from './locations'
import { targetOf } from './locations'
import type { Location, Range } from './protocol'

// SymbolKind, 1–26.
const KIND_NAMES: Record<number, string> = {
  1: 'file',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  2: 'module',
  20: 'key',
  21: 'null',
  22: 'enum member',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'type parameter',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
}

interface RawSymbol {
  name?: unknown
  kind?: unknown
  containerName?: unknown
  range?: Range
  selectionRange?: Range
  location?: Partial<Location>
  children?: unknown
}

function collect(
  result: unknown,
  path: string,
  rootDir: string,
  container: string,
  out: LocationHit[]
) {
  if (!Array.isArray(result)) {
    return
  }
  for (const raw of result as RawSymbol[]) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof raw.name !== 'string'
    ) {
      continue
    }
    // DocumentSymbol names the whole span in `range` and the name alone in `selectionRange`;
    // SymbolInformation carries neither and a 3.17 workspace symbol may carry no range at all.
    const range = raw.selectionRange ?? raw.location?.range ?? raw.range
    const target = raw.location?.uri
      ? targetOf(raw.location.uri, range)
      : {
          col: range?.start.character ?? 0,
          line: range?.start.line ?? 0,
          path,
        }
    const where =
      typeof raw.containerName === 'string' && raw.containerName
        ? raw.containerName
        : container
    if (target) {
      out.push({
        ...target,
        label: where ? `${where}.${raw.name}` : raw.name,
        note: noteFor(raw.kind, target, path, rootDir),
      })
    }
    collect(
      raw.children,
      path,
      rootDir,
      where ? `${where}.${raw.name}` : raw.name,
      out
    )
  }
}

function noteFor(
  kind: unknown,
  target: Target,
  path: string,
  rootDir: string
): string {
  const name = typeof kind === 'number' ? (KIND_NAMES[kind] ?? '') : ''
  const where =
    target.path === path
      ? String(target.line + 1)
      : `${relative(rootDir, target.path)}:${target.line + 1}`
  return name ? `${name} · ${where}` : where
}

export function symbolHits(
  result: unknown,
  path: string,
  rootDir: string
): LocationHit[] {
  const out: LocationHit[] = []
  collect(result, path, rootDir, '', out)
  return out
}
