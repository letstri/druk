import type { Change, ChangeRow } from '../core/changeTree'
import { unifiedDiff } from '../core/diff'
import type { ChangeArea } from '../core/git'
import type { ChangeSection } from '../ui/ChangesView'
import { DIFF_MAX_LINES } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'

export const slotKey = (path: string, area: ChangeArea) => `${area}:${path}`

export const rowSlotKey = (row: ChangeRow | undefined): string | null =>
  row?.kind === 'file' ? slotKey(row.change.path, row.change.area) : null

const sectionFor = (
  change: Change,
  file: DiffFile | null,
  last: ChangeSection | undefined
): ChangeSection => {
  if (
    last &&
    ((file === null && last.file === null) ||
      (file !== null &&
        last.file !== null &&
        last.file.oldText === file.oldText &&
        last.file.newText === file.newText))
  ) {
    return last
  }
  let patchLines = 0
  let patchAdds = 0
  let patchDels = 0
  let truncated = false
  if (file) {
    const patch = unifiedDiff(
      file.rel,
      file.oldText,
      file.newText,
      DIFF_MAX_LINES
    )
    patchLines = patch.lines
    patchAdds = patch.adds
    patchDels = patch.dels
    ;({ truncated } = patch)
  }
  return {
    adds: patchAdds,
    area: change.area,
    dels: patchDels,
    file,
    key: slotKey(change.path, change.area),
    lines: patchLines,
    rel: change.rel,
    status: change.status,
    truncated,
  }
}

// An empty patch still costs a row, or a folder of them would never trip the cap.
const sectionCost = (section: ChangeSection) => Math.max(1, section.lines)

export function takeChangeSections(
  ordered: Change[],
  fileFor: (change: Change) => DiffFile | null,
  prev: Map<string, ChangeSection>,
  pin: string | null,
  maxLines = DIFF_MAX_LINES
): {
  sections: ChangeSection[]
  adds: number
  dels: number
  keep: Set<string>
} {
  const walk = (from: number) => {
    const sections: ChangeSection[] = []
    const keep = new Set<string>()
    let lines = 0
    let adds = 0
    let dels = 0
    let full = false

    const push = (section: ChangeSection) => {
      sections.push(section)
      keep.add(section.key)
      lines += sectionCost(section)
      adds += section.adds
      dels += section.dels
      if (lines >= maxLines) {
        full = true
      }
    }

    for (const change of ordered.slice(from)) {
      const key = slotKey(change.path, change.area)
      if (full && key !== pin) {
        continue
      }
      const section = sectionFor(change, fileFor(change), prev.get(key))
      if (
        !full &&
        lines + sectionCost(section) > maxLines &&
        sections.length > 0 &&
        key !== pin
      ) {
        full = true
        continue
      }
      push(section)
    }

    return { adds, dels, keep, sections }
  }

  const first = walk(0)
  if (!pin) {
    return first
  }
  const at = ordered.findIndex(
    (change) => slotKey(change.path, change.area) === pin
  )
  const cutAfterPin =
    at > 0 && at < ordered.length - 1 && first.sections.at(-1)?.key === pin
  return cutAfterPin ? walk(at) : first
}
