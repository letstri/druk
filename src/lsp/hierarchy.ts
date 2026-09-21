import { relative } from 'node:path'

import type { Target } from './locations'
import { targetOf } from './locations'
import type { CallHierarchyCall, CallHierarchyItem } from './protocol'

export type CallDirection = 'incoming' | 'outgoing'

export interface CallNode {
  // Handed back to the server verbatim: `data` is its own state, not ours to rebuild.
  item: CallHierarchyItem
  label: string
  note: string
  target: Target
  // How this node was reached, so expanding it asks the same question again. null is the root.
  direction: CallDirection | null
}

function itemOf(raw: unknown): CallHierarchyItem | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const item = raw as Partial<CallHierarchyItem>
  if (typeof item.name !== 'string' || typeof item.uri !== 'string') {
    return null
  }
  return item as CallHierarchyItem
}

export function nodeOf(
  item: CallHierarchyItem,
  rootDir: string,
  direction: CallDirection | null = null,
  at = item.selectionRange ?? item.range
): CallNode | null {
  const target = targetOf(item.uri, at)
  if (!target) {
    return null
  }
  return {
    direction,
    item,
    label: item.name,
    // A sidebar has no room for the symbol's kind, and the editor beside it shows the code.
    note: `${relative(rootDir, target.path)}:${target.line + 1}`,
    target,
  }
}

export function hierarchyItems(result: unknown): CallHierarchyItem[] {
  if (!Array.isArray(result)) {
    return []
  }
  return result.map(itemOf).filter((item) => item !== null)
}

export function callNodes(
  direction: CallDirection,
  result: unknown,
  rootDir: string
): CallNode[] {
  if (!Array.isArray(result)) {
    return []
  }
  const nodes: CallNode[] = []
  for (const raw of result as CallHierarchyCall[]) {
    const item = itemOf(direction === 'incoming' ? raw?.from : raw?.to)
    if (!item) {
      continue
    }
    // An incoming call is read at the call site; an outgoing one at what it calls.
    const at =
      direction === 'incoming'
        ? (raw.fromRanges?.[0] ?? item.selectionRange ?? item.range)
        : (item.selectionRange ?? item.range)
    const node = nodeOf(item, rootDir, direction, at)
    if (node) {
      nodes.push(node)
    }
  }
  return nodes
}
