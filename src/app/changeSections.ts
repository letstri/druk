import type { Change } from '../core/changeTree'
import { unifiedDiff } from '../core/diff'
import type { ChangeArea } from '../core/git'
import type { ChangeSection } from '../ui/ChangesView'
import { DIFF_MAX_LINES } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'

export const slotKey = (path: string, area: ChangeArea) => `${area}:${path}`

const sectionFor = (
  change: Change,
  file: DiffFile | null,
  last: ChangeSection | undefined,
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
    const patch = unifiedDiff(file.rel, file.oldText, file.newText, DIFF_MAX_LINES)
    patchLines = patch.lines
    patchAdds = patch.adds
    patchDels = patch.dels
    truncated = patch.truncated
  }
  return {
    key: slotKey(change.path, change.area),
    rel: change.rel,
    area: change.area,
    status: change.status,
    file,
    lines: patchLines,
    adds: patchAdds,
    dels: patchDels,
    truncated,
  }
}

/** Visual rows a section costs the stacked page. A binary stub and an empty
 * patch still take a row, or a folder of them would never trip the cap. */
const sectionCost = (section: ChangeSection) => Math.max(1, section.lines)

/**
 * Walk panel-order changes into stacked sections, stopping once the patches
 * would exceed `maxLines`. The file under the panel cursor (`pin`) is kept
 * even past that cap: arrows that land on an omitted row would otherwise
 * scroll nowhere. Previous section objects are reused when the texts have
 * not moved, so the list does not remount every git revision.
 */
export function takeChangeSections(
  ordered: Change[],
  fileFor: (change: Change) => DiffFile | null,
  prev: Map<string, ChangeSection>,
  pin: string | null,
  maxLines = DIFF_MAX_LINES,
): { sections: ChangeSection[]; adds: number; dels: number; keep: Set<string> } {
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
    if (lines >= maxLines) full = true
  }

  for (const change of ordered) {
    const key = slotKey(change.path, change.area)
    if (full && key !== pin) continue
    const section = sectionFor(change, fileFor(change), prev.get(key))
    if (!full && lines + sectionCost(section) > maxLines && sections.length > 0 && key !== pin) {
      full = true
      continue
    }
    push(section)
  }

  return { sections, adds, dels, keep }
}
