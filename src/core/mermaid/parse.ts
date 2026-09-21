import { graphNode, wrapLabel } from './graph'
import type {
  ArrowHead,
  Diagram,
  Direction,
  EdgeStyle,
  GraphDiagram,
  GraphEdge,
  GraphNode,
  PieDiagram,
  SequenceDiagram,
  SequenceEvent,
} from './model'

/** Mermaid's link operators, longest first: `-->` must not be read as `--`. */
const LINK =
  '(<-->|<-\\.->|<==>|-{2,}>|-{2,}x|-{2,}o|-\\.+->|-\\.+-|={2,}>|-{3,}|={3,})'

const DIRECTIONS: Record<string, Direction> = {
  BT: 'BT',
  LR: 'LR',
  RL: 'RL',
  TB: 'TD',
  TD: 'TD',
}

const SHAPES: [RegExp, GraphNode['shape']][] = [
  [/^\(\((.*)\)\)$/u, 'round'],
  [/^\(\[(.*)\]\)$/u, 'round'],
  [/^\((.*)\)$/u, 'round'],
  [/^\{\{(.*)\}\}$/u, 'decision'],
  [/^\{(.*)\}$/u, 'decision'],
  [/^\[\[(.*)\]\]$/u, 'rect'],
  [/^\[\((.*)\)\]$/u, 'rect'],
  [/^\[\/(.*)\/\]$/u, 'rect'],
  [/^\[\\(.*)\\\]$/u, 'rect'],
  [/^\[(.*)\]$/u, 'rect'],
  [/^>(.*)\]$/u, 'rect'],
]

const unquote = (text: string) =>
  text
    .trim()
    .replace(/^["'`](.*)["'`]$/su, '$1')
    .replaceAll(/<br\s*\/?>/giu, ' ')

function statements(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.replace(/%%.*$/u, '').trim())
    .filter(Boolean)
}

function styleOf(link: string): EdgeStyle {
  if (link.includes('.')) {
    return 'dotted'
  }
  if (link.includes('=')) {
    return 'thick'
  }
  return 'solid'
}

function headOf(link: string): ArrowHead {
  if (link.endsWith('x')) {
    return 'cross'
  }
  if (link.endsWith('o')) {
    return 'circle'
  }
  if (link.endsWith('>')) {
    return 'arrow'
  }
  return 'none'
}

function parseFlowStatement(
  statement: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  // `A -- text --> B` is rewritten to `A -->|text| B`, so there is one parse path.
  const text = statement
    .replaceAll(/--\s+([^->|]+?)\s+(-{2,}[>xo]|-{3,})/gu, '$2|$1|')
    .replaceAll(/-\.\s+([^.|]+?)\s+\.(-{0,2}[>xo]?)/gu, '-.-$2|$1|')
    .replaceAll(/[=]=\s+([^=|]+?)\s+(={2,}>|={3,})/gu, '$2|$1|')

  const pattern = new RegExp(`\\s*${LINK}\\s*(?:\\|([^|]*)\\|\\s*)?`, 'gu')
  const parts: string[] = []
  const links: { link: string; label?: string }[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(at, match.index).trim())
    links.push({
      label: match[2] ? unquote(match[2]) : undefined,
      link: match[1]!,
    })
    at = match.index + match[0].length
  }
  if (links.length === 0) {
    const only = parseNode(text, nodes)
    if (only) {
      nodes.set(only, nodes.get(only)!)
    }
    return
  }
  parts.push(text.slice(at).trim())

  const ids = parts.map((part) => parseNode(part, nodes))
  for (const [index, entry] of links.entries()) {
    const from = ids[index]
    const to = ids[index + 1]
    if (!from || !to) {
      continue
    }
    edges.push({
      from,
      head: headOf(entry.link),
      label: entry.label,
      style: styleOf(entry.link),
      tail: entry.link.startsWith('<') ? 'arrow' : 'none',
      to,
    })
  }
}

function parseNode(
  token: string,
  nodes: Map<string, GraphNode>
): string | null {
  const text = token.trim()
  if (!text) {
    return null
  }
  const match = /^([^\s[\](){}>]+)\s*(.*)$/su.exec(text)
  if (!match) {
    return null
  }
  const id = match[1]!
  const body = match[2]!.trim()
  if (body) {
    for (const [pattern, shape] of SHAPES) {
      const shaped = pattern.exec(body)
      if (shaped) {
        nodes.set(id, { id, label: wrapLabel(unquote(shaped[1]!)), shape })
        return id
      }
    }
  }
  if (!nodes.has(id)) {
    nodes.set(id, graphNode(id, id))
  }
  return id
}

function parseFlowchart(lines: string[], direction: Direction): GraphDiagram {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  let resolved = direction
  for (const line of lines) {
    const inner = /^direction\s+(\w+)$/iu.exec(line)
    if (inner) {
      resolved = DIRECTIONS[inner[1]!.toUpperCase()] ?? resolved
      continue
    }
    if (
      /^(subgraph|end|style|classDef|class|click|linkStyle|accTitle|accDescr)\b/iu.test(
        line
      )
    ) {
      continue
    }
    parseFlowStatement(line, nodes, edges)
  }
  return {
    direction: resolved,
    edges,
    kind: 'graph',
    nodes: [...nodes.values()],
  }
}

function parseState(lines: string[], direction: Direction): GraphDiagram {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  let resolved = direction

  const point = (which: 'start' | 'end') => {
    const id = `__${which}`
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: ['●'], shape: 'point' })
    }
    return id
  }
  const named = (raw: string, asSource: boolean) => {
    const text = raw.trim()
    if (text === '[*]') {
      return point(asSource ? 'start' : 'end')
    }
    const id = text.split(/\s+/u)[0]!
    if (!nodes.has(id)) {
      nodes.set(id, graphNode(id, id, 'round'))
    }
    return id
  }

  for (const line of lines) {
    const inner = /^direction\s+(\w+)$/iu.exec(line)
    if (inner) {
      resolved = DIRECTIONS[inner[1]!.toUpperCase()] ?? resolved
      continue
    }
    if (/^(note|end|state\s+.*\{|\})/iu.test(line)) {
      continue
    }

    const alias = /^state\s+"(.+)"\s+as\s+(\S+)$/iu.exec(line)
    if (alias) {
      nodes.set(alias[2]!, graphNode(alias[2]!, alias[1]!, 'round'))
      continue
    }
    const transition = new RegExp(
      `^(.+?)\\s*${LINK}\\s*([^:]+?)(?::\\s*(.+))?$`,
      'u'
    ).exec(line)
    if (transition) {
      const from = named(transition[1]!, true)
      const to = named(transition[3]!, false)
      edges.push({
        from,
        head: 'arrow',
        label: transition[4] ? unquote(transition[4]) : undefined,
        style: styleOf(transition[2]!),
        tail: 'none',
        to,
      })
      continue
    }
    const described = /^(\S+)\s*:\s*(.+)$/u.exec(line)
    if (described) {
      const id = described[1]!
      const label = [id, ...wrapLabel(unquote(described[2]!))]
      nodes.set(id, { id, label, shape: 'round' })
    }
  }
  return {
    direction: resolved,
    edges,
    kind: 'graph',
    nodes: [...nodes.values()],
  }
}

const CLASS_HEADS: Record<string, ArrowHead> = {
  '*': 'filled',
  '<': 'arrow',
  '<|': 'hollow',
  '>': 'arrow',
  o: 'open',
  '|>': 'hollow',
}

function parseClass(lines: string[]): GraphDiagram {
  const members = new Map<string, string[]>()
  const order: string[] = []
  const edges: GraphEdge[] = []
  let open: string | null = null

  const ensure = (id: string) => {
    if (!members.has(id)) {
      members.set(id, [])
      order.push(id)
    }
    return id
  }

  for (const line of lines) {
    if (open) {
      if (line === '}') {
        open = null
        continue
      }
      members.get(open)!.push(unquote(line))
      continue
    }
    const block = /^class\s+(\S+?)\s*\{$/u.exec(line)
    if (block) {
      open = ensure(block[1]!)
      continue
    }
    const relation =
      /^(\S+)\s+(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s+(\S+)(?:\s*:\s*(.+))?$/u.exec(
        line
      )
    if (relation) {
      const left = ensure(relation[1]!)
      const right = ensure(relation[5]!)
      const leftMark = relation[2] ?? ''
      const rightMark = relation[4] ?? ''
      const style: EdgeStyle = relation[3] === '..' ? 'dotted' : 'solid'
      const label = relation[6] ? unquote(relation[6]) : undefined
      // `A <|-- B` points at A: the marked end is the head, whichever side it is on.
      const [from, to, mark] = rightMark
        ? [left, right, rightMark]
        : [right, left, leftMark]
      edges.push({
        from,
        head: CLASS_HEADS[mark] ?? 'arrow',
        label,
        style,
        tail: 'none',
        to,
      })
      continue
    }
    const member = /^(\S+)\s*:\s*(.+)$/u.exec(line)
    if (member) {
      ensure(member[1]!)
      members.get(member[1]!)!.push(unquote(member[2]!))
      continue
    }
    const bare = /^class\s+(\S+)$/u.exec(line)
    if (bare) {
      ensure(bare[1]!)
    }
  }

  const nodes: GraphNode[] = order.map((id) => ({
    id,
    label: [id, ...(members.get(id) ?? []).flatMap((text) => wrapLabel(text))],
    shape: 'rect',
  }))
  return { direction: 'TD', edges, kind: 'graph', nodes }
}

const CARDINALITY: Record<string, string> = {
  'o{': '0..N',
  'o|': '0..1',
  '|o': '0..1',
  '|{': '1..N',
  '||': '1',
  '}o': '0..N',
  '}|': '1..N',
}

function parseEr(lines: string[]): GraphDiagram {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  let open: string | null = null

  for (const line of lines) {
    if (open) {
      if (line === '}') {
        open = null
      } else {
        nodes.get(open)!.label.push(unquote(line))
      }
      continue
    }
    const block = /^(\S+)\s*\{$/u.exec(line)
    if (block) {
      const id = block[1]!
      if (!nodes.has(id)) {
        nodes.set(id, { id, label: [id], shape: 'rect' })
      }
      open = id
      continue
    }
    const relation =
      /^(\S+)\s+(\|\||\|o|o\||\}o|o\{|\}\||\|\{)(--|\.\.)(\|\||\|o|o\||\}o|o\{|\}\||\|\{)\s+(\S+)\s*:\s*(.+)$/u.exec(
        line
      )
    if (!relation) {
      continue
    }
    for (const id of [relation[1]!, relation[5]!]) {
      if (!nodes.has(id)) {
        nodes.set(id, { id, label: [id], shape: 'rect' })
      }
    }
    const left = CARDINALITY[relation[2]!] ?? ''
    const right = CARDINALITY[relation[4]!] ?? ''
    edges.push({
      from: relation[1]!,
      head: 'none',
      label: `${left} ${unquote(relation[6]!)} ${right}`.trim(),
      style: relation[3] === '..' ? 'dotted' : 'solid',
      tail: 'none',
      to: relation[5]!,
    })
  }
  return { direction: 'LR', edges, kind: 'graph', nodes: [...nodes.values()] }
}

function parseSequence(lines: string[]): SequenceDiagram {
  const participants = new Map<string, string>()
  const events: SequenceEvent[] = []
  let title: string | undefined

  const use = (raw: string) => {
    const id = raw.trim()
    if (!participants.has(id)) {
      participants.set(id, id)
    }
    return id
  }

  for (const line of lines) {
    const declared = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/iu.exec(
      line
    )
    if (declared) {
      participants.set(declared[2]!, unquote(declared[3] ?? declared[2]!))
      continue
    }
    const heading = /^title\s+(.+)$/iu.exec(line)
    if (heading) {
      title = unquote(heading[1]!)
      continue
    }
    const note =
      /^note\s+(?:(over|left of|right of)\s+)?([^:]+):\s*(.+)$/iu.exec(line)
    if (note) {
      events.push({
        targets: note[2]!.split(',').map((one) => use(one)),
        text: unquote(note[3]!),
        type: 'note',
      })
      continue
    }
    const block =
      /^(loop|alt|else|opt|par|and|critical|rect|break)\b\s*(.*)$/iu.exec(line)
    if (block) {
      events.push({
        closing: false,
        keyword: block[1]!.toLowerCase(),
        text: unquote(block[2] ?? ''),
        type: 'block',
      })
      continue
    }
    if (/^end$/iu.test(line)) {
      events.push({ closing: true, keyword: 'end', text: '', type: 'block' })
      continue
    }
    if (/^(activate|deactivate|autonumber)\b/iu.test(line)) {
      continue
    }

    const message =
      /^([^-<>+:]+?)\s*(-{1,2}>{1,2}|-{1,2}\)|-{1,2}x)\s*([^:]+?)\s*:\s*(.*)$/u.exec(
        line
      )
    if (!message) {
      continue
    }
    const arrow = message[2]!
    events.push({
      from: use(message[1]!),
      head: arrow.endsWith('x')
        ? 'cross'
        : arrow.endsWith(')')
          ? 'circle'
          : 'arrow',
      style: arrow.startsWith('--') ? 'dotted' : 'solid',
      text: unquote(message[4]!),
      to: use(message[3]!.replace(/^[+-]/u, '')),
      type: 'message',
    })
  }

  return {
    events,
    kind: 'sequence',
    participants: [...participants].map(([id, label]) => ({ id, label })),
    title,
  }
}

function parsePie(header: string, lines: string[]): PieDiagram {
  const heading = /title\s+(.+)$/iu.exec(header)
  const slices: PieDiagram['slices'] = []
  let title = heading ? unquote(heading[1]!) : undefined
  for (const line of lines) {
    const own = /^title\s+(.+)$/iu.exec(line)
    if (own) {
      title = unquote(own[1]!)
      continue
    }
    const slice = /^"?(.+?)"?\s*:\s*([\d.]+)$/u.exec(line)
    // `10.5.5` and `.` both match the digits-and-dots pattern and both parse to NaN.
    if (slice && Number.isFinite(Number(slice[2]))) {
      slices.push({ label: unquote(slice[1]!), value: Number(slice[2]) })
    }
  }
  return { kind: 'pie', showData: /\bshowdata\b/iu.test(header), slices, title }
}

export function parseMermaid(source: string): Diagram {
  const withoutFrontMatter = source.replace(/^\s*---\n[\s\S]*?\n---\n/u, '')
  const lines = statements(withoutFrontMatter).filter(
    (line) => !line.startsWith('%%{')
  )
  const header = lines[0] ?? ''
  const rest = lines.slice(1)

  const flow = /^(graph|flowchart)\s*(\w+)?/iu.exec(header)
  if (flow) {
    return parseFlowchart(
      rest,
      DIRECTIONS[(flow[2] ?? 'TD').toUpperCase()] ?? 'TD'
    )
  }

  const state = /^stateDiagram(?:-v2)?\s*(\w+)?/iu.exec(header)
  if (state) {
    return parseState(
      rest,
      DIRECTIONS[(state[1] ?? 'TD').toUpperCase()] ?? 'TD'
    )
  }

  if (/^classDiagram/iu.test(header)) {
    return parseClass(rest)
  }
  if (/^erDiagram/iu.test(header)) {
    return parseEr(rest)
  }
  if (/^sequenceDiagram/iu.test(header)) {
    return parseSequence(rest)
  }
  if (/^pie\b/iu.test(header)) {
    return parsePie(header, rest)
  }

  const type = header.split(/\s+/u)[0] ?? 'diagram'
  return {
    kind: 'unsupported',
    reason: header
      ? `${type} diagrams are not drawn in the terminal yet`
      : 'empty diagram',
    type,
  }
}
