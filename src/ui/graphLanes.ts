export interface LaneSpan {
  text: string
  color: string
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface RefChip {
  label: string
  kind: RefKind
}

// git draws its graph with ASCII; box drawing joins up where those characters leave gaps.
const GLYPH: Record<string, string> = {
  '*': '●',
  '-': '─',
  '/': '╱',
  '\\': '╲',
  _: '─',
  '|': '│',
}

// git lays the graph out two columns per lane.
const LANE = 2

const DIAGONAL = new Set(['/', '\\'])

// A diagonal sits between two lanes: it belongs to the one it is reaching for.
const laneAt = (column: number, char: string) =>
  DIAGONAL.has(char) ? Math.ceil(column / LANE) : Math.floor(column / LANE)

export function laneSpans(
  graph: string,
  palette: readonly string[]
): LaneSpan[] {
  const spans: LaneSpan[] = []
  for (const [column, char] of [...graph].entries()) {
    const color = palette[laneAt(column, char) % palette.length]!
    const text = GLYPH[char] ?? char
    const last = spans.at(-1)
    // A space carries the run it sits in: splitting on it would double the renderables.
    if (last && (char === ' ' || last.color === color)) {
      last.text += text
    } else {
      spans.push({ color, text })
    }
  }
  return spans
}

// `--decorate=full`: a local branch named `feat/x` is only told from `origin/x` by its ref prefix.
const PREFIXES: [string, RefKind][] = [
  ['refs/heads/', 'local'],
  ['refs/remotes/', 'remote'],
  ['refs/tags/', 'tag'],
]

function chipFor(ref: string, kind?: RefKind): RefChip {
  for (const [prefix, named] of PREFIXES) {
    if (ref.startsWith(prefix)) {
      return { kind: kind ?? named, label: ref.slice(prefix.length) }
    }
  }
  return { kind: kind ?? (ref.includes('/') ? 'remote' : 'local'), label: ref }
}

export function refChips(refs: readonly string[]): RefChip[] {
  const chips: RefChip[] = []
  for (const ref of refs) {
    // `origin/HEAD` names whatever the remote's default is — a second label for a branch already listed.
    if (ref.endsWith('/HEAD')) {
      continue
    }
    if (ref.startsWith('tag: ')) {
      chips.push(chipFor(ref.slice(5), 'tag'))
    } else if (ref.startsWith('HEAD -> ')) {
      chips.push(chipFor(ref.slice(8), 'head'))
    } else if (ref === 'HEAD') {
      chips.push({ kind: 'head', label: ref })
    } else {
      chips.push(chipFor(ref))
    }
  }
  return chips
}
