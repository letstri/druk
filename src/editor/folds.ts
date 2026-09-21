export type FoldOp = 'fold' | 'unfold' | 'foldAll' | 'unfoldAll'

// `start` stays on screen, `start+1`…`end` are hidden.
export interface FoldRegion {
  start: number
  end: number
}

export interface FoldView {
  source: string
  text: string
  folds: FoldRegion[]
  // Real line per display line.
  real: number[]
  // Display line per real line; -1 while hidden.
  display: number[]
  // Offset of each real line into `source`.
  starts: number[]
  // Lines hidden under each visible anchor.
  hidden: Map<number, number>
  // Display rows standing for no line of the file: not in `source`, never read back.
  spacers: ReadonlySet<number>
}

export function plainView(source: string): FoldView {
  return foldView(source, [])
}

// `real` repeats the anchor's line on the gap rows; `source` and `starts` stay untouched.
export function spacedView(
  view: FoldView,
  line: number,
  count: number
): FoldView {
  const anchor = view.display[line]
  if (count <= 0 || anchor === undefined || anchor < 0) {
    return view
  }
  const after = anchor + 1
  const gap = Array.from({ length: count }, () => '')
  const rows = view.text.split('\n')
  const spacers = new Set<number>()
  for (let n = 0; n < count; n += 1) {
    spacers.add(after + n)
  }
  return {
    ...view,
    // Only the rows below the gap move; the anchor itself sits above it.
    display: view.display.map((row) => (row >= after ? row + count : row)),
    real: [
      ...view.real.slice(0, after),
      ...gap.map(() => line),
      ...view.real.slice(after),
    ],
    spacers,
    text: [...rows.slice(0, after), ...gap, ...rows.slice(after)].join('\n'),
  }
}

const isBlank = (line: string): boolean => line.trim() === ''

const indentOf = (line: string, tabSize: number): number => {
  let width = 0
  for (const char of line) {
    if (char === ' ') {
      width += 1
    } else if (char === '\t') {
      width += tabSize - (width % tabSize)
    } else {
      break
    }
  }
  return width
}

// A line owns the more-indented run below it up to the last non-blank line.
export function foldableRegions(text: string, tabSize: number): FoldRegion[] {
  const lines = text.split('\n')
  const regions: FoldRegion[] = []
  const open: { indent: number; start: number }[] = []
  let lastFilled = -1
  const close = (indent: number) => {
    while (open.length > 0 && open.at(-1)!.indent >= indent) {
      const block = open.pop()!
      if (lastFilled > block.start) {
        regions.push({ end: lastFilled, start: block.start })
      }
    }
  }
  for (let line = 0; line < lines.length; line += 1) {
    if (isBlank(lines[line]!)) {
      continue
    }
    close(indentOf(lines[line]!, tabSize))
    open.push({ indent: indentOf(lines[line]!, tabSize), start: line })
    lastFilled = line
  }
  close(-1)
  return regions.toSorted((a, b) => a.start - b.start || b.end - a.end)
}

// Read in place, not from a split: the marker column asks this per screen line per keystroke.
function indentAt(text: string, from: number, tabSize: number): number | null {
  let width = 0
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]
    if (char === ' ') {
      width += 1
    } else if (char === '\t') {
      width += tabSize - (width % tabSize)
    } else if (char === '\n') {
      return null
    } else {
      return width
    }
  }
  return null
}

export function foldsFrom(
  text: string,
  starts: readonly number[],
  line: number,
  tabSize: number
): boolean {
  const start = starts[line]
  if (start === undefined) {
    return false
  }
  const own = indentAt(text, start, tabSize)
  if (own === null) {
    return false
  }
  for (let next = line + 1; next < starts.length; next += 1) {
    const indent = indentAt(text, starts[next]!, tabSize)
    if (indent === null) {
      continue
    }
    return indent > own
  }
  return false
}

export function innermostRegion(
  regions: FoldRegion[],
  line: number
): FoldRegion | null {
  let best: FoldRegion | null = null
  for (const region of regions) {
    if (line < region.start || line > region.end) {
      continue
    }
    if (
      !best ||
      region.start > best.start ||
      (region.start === best.start && region.end < best.end)
    ) {
      best = region
    }
  }
  return best
}

function normalize(folds: FoldRegion[], lines: number): FoldRegion[] {
  const seen = new Set<number>()
  const kept: FoldRegion[] = []
  for (const fold of folds.toSorted(
    (a, b) => a.start - b.start || b.end - a.end
  )) {
    const end = Math.min(fold.end, lines - 1)
    if (fold.start < 0 || fold.start >= lines - 1 || end <= fold.start) {
      continue
    }
    if (seen.has(fold.start)) {
      continue
    }
    seen.add(fold.start)
    kept.push({ end, start: fold.start })
  }
  return kept
}

const EMPTY: ReadonlySet<number> = new Set()

export function foldView(source: string, folds: FoldRegion[]): FoldView {
  const lines = source.split('\n')
  const kept = normalize(folds, lines.length)
  const isHidden = new Uint8Array(lines.length)
  for (const fold of kept) {
    for (let line = fold.start + 1; line <= fold.end; line += 1) {
      isHidden[line] = 1
    }
  }

  const real: number[] = []
  const display: number[] = Array.from({ length: lines.length }, () => -1)
  const starts: number[] = Array.from({ length: lines.length }, () => 0)
  const shown: string[] = []
  let offset = 0
  for (let line = 0; line < lines.length; line += 1) {
    starts[line] = offset
    offset += lines[line]!.length + 1
    if (isHidden[line]) {
      continue
    }
    display[line] = real.length
    real.push(line)
    shown.push(lines[line]!)
  }

  const hidden = new Map<number, number>()
  for (const fold of kept) {
    // A region nested in a collapsed one has no anchor; it opens with the outer one.
    if (display[fold.start]! < 0) {
      continue
    }
    hidden.set(fold.start, fold.end - fold.start)
  }

  return {
    display,
    folds: kept,
    hidden,
    real,
    source,
    spacers: EMPTY,
    starts,
    text: shown.join('\n'),
  }
}

// Lines hidden under an anchor inside the edited span move after the replacement, not with it.
export function reconcileFolds(
  view: FoldView,
  nextDisplay: string
): { source: string; folds: FoldRegion[] } {
  if (nextDisplay === view.text) {
    return { folds: view.folds, source: view.source }
  }
  const before = view.text.split('\n')
  const after = nextDisplay.split('\n')

  let head = 0
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1
  }
  let tailBefore = before.length
  let tailAfter = after.length
  while (
    tailBefore > head &&
    tailAfter > head &&
    before[tailBefore - 1] === after[tailAfter - 1]
  ) {
    tailBefore -= 1
    tailAfter -= 1
  }

  const lines = view.source.split('\n')
  const realStart = head < view.real.length ? view.real[head]! : lines.length
  const realEnd =
    tailBefore < view.real.length ? view.real[tailBefore]! : lines.length

  const rescued: string[] = []
  const kept: FoldRegion[] = []
  for (const fold of view.folds) {
    if (fold.start >= realStart && fold.start < realEnd) {
      rescued.push(
        ...lines.slice(fold.start + 1, Math.min(fold.end, lines.length - 1) + 1)
      )
      continue
    }
    kept.push(fold)
  }

  const replacement = after.slice(head, tailAfter)
  const source = [
    ...lines.slice(0, realStart),
    ...replacement,
    ...rescued,
    ...lines.slice(realEnd),
  ].join('\n')

  const delta = replacement.length + rescued.length - (realEnd - realStart)
  const moved = kept.map((fold) =>
    fold.start >= realEnd
      ? { end: fold.end + delta, start: fold.start + delta }
      : fold
  )
  return { folds: normalize(moved, source.split('\n').length), source }
}
