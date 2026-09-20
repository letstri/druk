import { Canvas } from './canvas'
import type { Line, Role, Stroke } from './canvas'
import type { ArrowHead, EdgeStyle, GraphDiagram, GraphEdge, GraphNode } from './model'

const CROSS_GAP_X = 3
const CROSS_GAP_Y = 1
const BAND = 3
const MAX_LABEL_WIDTH = 28

const STROKE: Record<EdgeStyle, Stroke> = {
  solid: 'solid',
  dotted: 'dotted',
  thick: 'thick',
}

const HEADS: Record<ArrowHead, { down: string; up: string; right: string; left: string }> = {
  none: { down: '', up: '', right: '', left: '' },
  arrow: { down: '▼', up: '▲', right: '▶', left: '◀' },
  hollow: { down: '▽', up: '△', right: '▷', left: '◁' },
  filled: { down: '◆', up: '◆', right: '◆', left: '◆' },
  open: { down: '◇', up: '◇', right: '◇', left: '◇' },
  cross: { down: '✕', up: '✕', right: '✕', left: '✕' },
  circle: { down: '○', up: '○', right: '○', left: '○' },
}

const BORDERS: Record<string, string[]> = {
  // Corners clockwise from top-left, then horizontal and vertical.
  rect: ['┌', '┐', '┘', '└', '─', '│'],
  round: ['╭', '╮', '╯', '╰', '─', '│'],
  decision: ['╔', '╗', '╝', '╚', '═', '║'],
}

interface Placed {
  id: string
  node: GraphNode | null
  layer: number
  width: number
  height: number
  x: number
  y: number
}

interface Segment {
  from: string
  to: string
  style: EdgeStyle
  head: ArrowHead
  tail: ArrowHead
  label?: string
}

export function wrapLabel(text: string, max = MAX_LABEL_WIDTH): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line.length === 0) line = word
    else if (line.length + 1 + word.length <= max) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  return lines.flatMap(one =>
    one.length <= max ? [one] : (one.match(new RegExp(`.{1,${max}}`, 'g')) ?? [one]),
  )
}

const width = (text: string) => [...text].length

function assignLayers(
  ids: string[],
  edges: GraphEdge[],
): { layer: Map<string, number>; back: Set<number> } {
  const out = new Map<string, { to: string; index: number }[]>()
  for (const id of ids) out.set(id, [])
  edges.forEach((edge, index) => out.get(edge.from)?.push({ to: edge.to, index }))

  const back = new Set<number>()
  const state = new Map<string, 'open' | 'done'>()
  const walk = (id: string) => {
    state.set(id, 'open')
    for (const { to, index } of out.get(id) ?? []) {
      if (state.get(to) === 'open') back.add(index)
      else if (!state.has(to)) walk(to)
    }
    state.set(id, 'done')
  }
  for (const id of ids) if (!state.has(id)) walk(id)

  const incoming = new Map<string, string[]>()
  for (const id of ids) incoming.set(id, [])
  edges.forEach((edge, index) => {
    const [from, to] = back.has(index) ? [edge.to, edge.from] : [edge.from, edge.to]
    if (from !== to) incoming.get(to)?.push(from)
  })

  const layer = new Map<string, number>()
  const resolve = (id: string, seen: Set<string>): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    if (seen.has(id)) return 0
    seen.add(id)
    const depth = Math.max(0, ...(incoming.get(id) ?? []).map(from => resolve(from, seen) + 1))
    layer.set(id, depth)
    return depth
  }
  for (const id of ids) resolve(id, new Set())
  return { layer, back }
}

function orderLayers(layers: string[][], segments: Segment[]): void {
  const neighbours = (down: boolean) => {
    const map = new Map<string, string[]>()
    for (const segment of segments) {
      const [key, value] = down ? [segment.to, segment.from] : [segment.from, segment.to]
      const list = map.get(key)
      if (list) list.push(value)
      else map.set(key, [value])
    }
    return map
  }

  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0
    const map = neighbours(down)
    const range = down ? [...layers.keys()].slice(1) : [...layers.keys()].slice(0, -1).toReversed()
    for (const index of range) {
      const reference = new Map(layers[down ? index - 1 : index + 1]!.map((id, at) => [id, at]))
      const current = layers[index]!
      const key = new Map(
        current.map((id, at) => {
          const positions = (map.get(id) ?? [])
            .map(other => reference.get(other))
            .filter((value): value is number => value !== undefined)
          return [
            id,
            positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : at,
          ]
        }),
      )
      layers[index] = current
        .map((id, at) => ({ id, at }))
        .toSorted((a, b) => key.get(a.id)! - key.get(b.id)! || a.at - b.at)
        .map(entry => entry.id)
    }
  }
}

interface Layout {
  placed: Map<string, Placed>
  layers: string[][]
  segments: Segment[]
  vertical: boolean
  width: number
  height: number
}

function layout(diagram: GraphDiagram): Layout {
  const vertical = diagram.direction === 'TD' || diagram.direction === 'BT'
  const flip = diagram.direction === 'BT' || diagram.direction === 'RL'

  const nodes = new Map(diagram.nodes.map(node => [node.id, node]))
  const ids = [...nodes.keys()]
  const { layer, back } = assignLayers(ids, diagram.edges)
  const depth = Math.max(0, ...layer.values())

  const layerOf = (id: string) => {
    const at = layer.get(id) ?? 0
    return flip ? depth - at : at
  }

  // An edge running against the layer axis is turned around here, keeping its head where it was.
  const segments: Segment[] = []
  const dummies: Placed[] = []
  diagram.edges.forEach((edge, index) => {
    const reversed = back.has(index) !== flip
    const from = reversed ? edge.to : edge.from
    const to = reversed ? edge.from : edge.to
    const head = reversed ? edge.tail : edge.head
    const tail = reversed ? edge.head : edge.tail
    if (from === to) return
    const start = layerOf(from)
    const end = layerOf(to)
    const span = end - start
    if (span <= 1) {
      segments.push({ from, to, style: edge.style, head, tail, label: edge.label })
      return
    }
    let previous = from
    for (let step = 1; step < span; step++) {
      const id = `\0dummy:${index}:${step}`
      dummies.push({ id, node: null, layer: start + step, width: 1, height: 1, x: 0, y: 0 })
      segments.push({
        from: previous,
        to: id,
        style: edge.style,
        head: 'none',
        tail: step === 1 ? tail : 'none',
        label: step === 1 ? edge.label : undefined,
      })
      previous = id
    }
    segments.push({ from: previous, to, style: edge.style, head, tail: 'none' })
  })

  const placed = new Map<string, Placed>()
  for (const node of diagram.nodes) {
    const label = node.shape === 'point' ? ['●'] : node.label
    const box = node.shape === 'point'
    placed.set(node.id, {
      id: node.id,
      node,
      layer: layerOf(node.id),
      width: box ? 1 : Math.max(...label.map(width)) + 4,
      height: box ? 1 : label.length + 2,
      x: 0,
      y: 0,
    })
  }
  for (const dummy of dummies) placed.set(dummy.id, dummy)

  const layers: string[][] = Array.from({ length: depth + 1 }, () => [])
  for (const item of placed.values()) layers[item.layer]!.push(item.id)
  orderLayers(layers, segments)

  const labelRoom = (index: number) =>
    vertical
      ? 0
      : Math.max(
          0,
          ...segments
            .filter(
              segment => placed.get(segment.from)!.layer === index && segment.label !== undefined,
            )
            .map(segment => width(segment.label!) + 3),
        )

  const mainOf = (item: Placed) => (vertical ? item.height : item.width)
  const crossOf = (item: Placed) => (vertical ? item.width : item.height)

  let main = 0
  const mainStart: number[] = []
  layers.forEach((layerIds, index) => {
    mainStart.push(main)
    const extent = Math.max(1, ...layerIds.map(id => mainOf(placed.get(id)!)))
    main += extent + BAND + labelRoom(index)
  })
  const mainTotal = main - BAND

  const gap = vertical ? CROSS_GAP_X : CROSS_GAP_Y
  const crossStart = new Map<string, number>()
  const centre = (id: string) => crossStart.get(id)! + crossOf(placed.get(id)!) / 2
  for (let pass = 0; pass < 3; pass++) {
    for (const [index, layerIds] of layers.entries()) {
      let cursor = 0
      for (const id of layerIds) {
        const extent = crossOf(placed.get(id)!)
        const anchors = segments
          .filter(segment => segment.to === id && placed.get(segment.from)!.layer < index)
          .map(segment => (crossStart.has(segment.from) ? centre(segment.from) : null))
          .filter((value): value is number => value !== null)
        const desired =
          anchors.length > 0
            ? anchors.reduce((a, b) => a + b, 0) / anchors.length - extent / 2
            : (crossStart.get(id) ?? cursor)
        const at = Math.max(cursor, Math.round(desired))
        crossStart.set(id, at)
        cursor = at + extent + gap
      }
    }
  }
  const minCross = Math.min(0, ...crossStart.values())
  let crossTotal = 0
  for (const [id, at] of crossStart) {
    crossStart.set(id, at - minCross)
    crossTotal = Math.max(crossTotal, at - minCross + crossOf(placed.get(id)!))
  }

  for (const [index, layerIds] of layers.entries()) {
    for (const id of layerIds) {
      const item = placed.get(id)!
      const start = mainStart[index]!
      if (vertical) {
        item.y = start
        item.x = crossStart.get(id)!
      } else {
        item.x = start
        item.y = crossStart.get(id)!
      }
      if (!item.node) {
        const extent = Math.max(1, ...layerIds.map(other => mainOf(placed.get(other)!)))
        if (vertical) item.height = extent
        else item.width = extent
      }
    }
  }

  return {
    placed,
    layers,
    segments,
    vertical,
    width: vertical ? crossTotal : mainTotal,
    height: vertical ? mainTotal : crossTotal,
  }
}

function drawBox(canvas: Canvas, item: Placed): void {
  const node = item.node!
  if (node.shape === 'point') {
    canvas.set(item.x, item.y, '●', 'border')
    return
  }
  const [tl, tr, br, bl, h, v] =
    BORDERS[node.shape === 'round' ? 'round' : node.shape === 'decision' ? 'decision' : 'rect']!
  const right = item.x + item.width - 1
  const bottom = item.y + item.height - 1
  canvas.charLine(item.x, right, item.y, h!, 'border')
  canvas.charLine(item.x, right, bottom, h!, 'border')
  canvas.charColumn(item.y, bottom, item.x, v!, 'border')
  canvas.charColumn(item.y, bottom, right, v!, 'border')
  canvas.set(item.x, item.y, tl!, 'border')
  canvas.set(right, item.y, tr!, 'border')
  canvas.set(right, bottom, br!, 'border')
  canvas.set(item.x, bottom, bl!, 'border')
  node.label.forEach((text, index) => {
    const pad = index > 0 ? 1 : Math.floor((item.width - 2 - width(text)) / 2)
    canvas.text(item.x + 1 + pad, item.y + 1 + index, text, 'label')
  })
}

function drawSegment(canvas: Canvas, layout: Layout, segment: Segment): void {
  const from = layout.placed.get(segment.from)!
  const to = layout.placed.get(segment.to)!
  const stroke = STROKE[segment.style]!
  const role: Role = 'edge'

  if (layout.vertical) {
    const sx = from.node ? from.x + Math.floor(from.width / 2) : from.x
    const tx = to.node ? to.x + Math.floor(to.width / 2) : to.x
    const top = from.y + from.height
    const entry = to.y - 1
    const run = entry - 1
    canvas.vline(top, run, sx, stroke, role)
    canvas.hline(sx, tx, run, stroke, role)
    canvas.vline(run, entry, tx, stroke, role)
    const head = HEADS[segment.head]!.down
    if (head) canvas.set(tx, entry, head, role)
    const tail = HEADS[segment.tail]!.up
    if (tail) canvas.set(sx, top, tail, role)
    // At the end the edge points at, not the run's middle: sibling edges share run rows.
    if (segment.label) {
      if (head) canvas.text(tx + 2, entry, segment.label, 'edgeLabel')
      else canvas.text(sx + 2, top, segment.label, 'edgeLabel')
    }
    return
  }

  const sy = from.node ? from.y + Math.floor(from.height / 2) : from.y
  const ty = to.node ? to.y + Math.floor(to.height / 2) : to.y
  const left = from.x + from.width
  const entry = to.x - 1
  const run = left + 1
  canvas.hline(left, run, sy, stroke, role)
  canvas.vline(sy, ty, run, stroke, role)
  canvas.hline(run, entry, ty, stroke, role)
  const head = HEADS[segment.head]!.right
  if (head) canvas.set(entry, ty, head, role)
  const tail = HEADS[segment.tail]!.left
  if (tail) canvas.set(left, sy, tail, role)
  if (segment.label) canvas.text(run + 1, ty, ` ${segment.label} `, 'edgeLabel')
}

export function renderGraph(diagram: GraphDiagram): Line[] {
  const model = layout(diagram)
  const canvas = new Canvas()
  for (const item of model.placed.values()) {
    if (item.node) drawBox(canvas, item)
  }
  for (const segment of model.segments) drawSegment(canvas, model, segment)
  // Last, so a line crossing a layer stays unbroken over whatever sits beside it.
  for (const item of model.placed.values()) {
    if (item.node) continue
    if (model.vertical) canvas.vline(item.y, item.y + item.height - 1, item.x, 'solid', 'edge')
    else canvas.hline(item.x, item.x + item.width - 1, item.y, 'solid', 'edge')
  }
  const lines = canvas.toLines()
  if (!diagram.title) return lines
  return [[{ text: diagram.title, role: 'title' }], [], ...lines]
}

export function graphNode(
  id: string,
  label: string,
  shape: GraphNode['shape'] = 'rect',
): GraphNode {
  return { id, label: wrapLabel(label), shape }
}
