import { Canvas } from './canvas'
import type { Line, Stroke } from './canvas'
import type { EdgeStyle, SequenceDiagram, SequenceEvent } from './model'

const MIN_GAP = 6
const MAX_GAP = 44
const LOOP = 4

const STROKE: Record<EdgeStyle, Stroke> = { solid: 'solid', dotted: 'dotted', thick: 'thick' }

const width = (text: string) => [...text].length

function boxWidth(label: string): number {
  return width(label) + 4
}

function rowsFor(event: SequenceEvent): number {
  if (event.type === 'message') return 3
  if (event.type === 'note') return 4
  return 2
}

export function renderSequence(diagram: SequenceDiagram): Line[] {
  const canvas = new Canvas()
  const participants = diagram.participants
  if (participants.length === 0) return [[{ text: 'sequenceDiagram', role: 'muted' }]]

  const index = new Map(participants.map((participant, at) => [participant.id, at]))
  const boxes = participants.map(participant => boxWidth(participant.label))

  const gaps = participants.slice(1).map((_, at) => {
    let needed = MIN_GAP
    for (const event of diagram.events) {
      if (event.type !== 'message') continue
      const from = index.get(event.from)
      const to = index.get(event.to)
      if (from === undefined || to === undefined) continue
      const low = Math.min(from, to)
      const high = Math.max(from, to)
      if (at + 1 <= low || at + 1 > high) continue
      const span = Math.max(1, high - low)
      needed = Math.max(needed, Math.ceil((width(event.text) + 4) / span))
    }
    return Math.min(MAX_GAP, needed)
  })

  const centres: number[] = []
  let x = 0
  boxes.forEach((box, at) => {
    if (at > 0) x += gaps[at - 1]! + Math.ceil(boxes[at - 1]! / 2) + Math.ceil(box / 2)
    centres.push(x + Math.floor(box / 2))
  })
  // Everything is measured from the leftmost box's left edge, which sits at 0.
  const shift = Math.max(0, ...centres.map((centre, at) => Math.floor(boxes[at]! / 2) - centre))
  const centre = (at: number) => centres[at]! + shift

  let top = 0
  if (diagram.title) {
    canvas.text(0, 0, diagram.title, 'title')
    top = 2
  }

  participants.forEach((participant, at) => {
    const left = centre(at) - Math.floor(boxes[at]! / 2)
    const right = left + boxes[at]! - 1
    canvas.charLine(left, right, top, '─', 'border')
    canvas.charLine(left, right, top + 2, '─', 'border')
    canvas.set(left, top, '╭', 'border')
    canvas.set(right, top, '╮', 'border')
    canvas.set(left, top + 2, '╰', 'border')
    canvas.set(right, top + 2, '╯', 'border')
    canvas.set(left, top + 1, '│', 'border')
    canvas.set(right, top + 1, '│', 'border')
    canvas.text(left + 2, top + 1, participant.label, 'label')
  })

  const bodyTop = top + 3
  const rows = diagram.events.reduce((total, event) => total + rowsFor(event), 0)
  const bottom = bodyTop + Math.max(1, rows)
  const rightEdge = Math.max(
    ...participants.map((_, at) => centre(at) + Math.floor(boxes[at]! / 2)),
  )

  for (const [at] of participants.entries()) {
    canvas.vline(bodyTop, bottom, centre(at), 'solid', 'muted')
  }

  let row = bodyTop + 1
  let depth = 0
  for (const event of diagram.events) {
    if (event.type === 'block') {
      if (event.closing) depth = Math.max(0, depth - 1)
      const label = event.closing ? 'end' : `${event.keyword} ${event.text}`.trim()
      canvas.hline(0, rightEdge, row, 'dotted', 'muted')
      canvas.text(2, row, ` ${label} `, 'edgeLabel')
      if (!event.closing) depth++
      row += 2
      continue
    }

    if (event.type === 'note') {
      const columns = event.targets
        .map(id => index.get(id))
        .filter((at): at is number => at !== undefined)
      const from = columns.length > 0 ? Math.min(...columns) : 0
      const to = columns.length > 0 ? Math.max(...columns) : 0
      const left = centre(from) - 2
      const right = Math.max(centre(to) + 2, left + width(event.text) + 3)
      canvas.charLine(left, right, row, '─', 'border')
      canvas.charLine(left, right, row + 2, '─', 'border')
      canvas.set(left, row, '╭', 'border')
      canvas.set(right, row, '╮', 'border')
      canvas.set(left, row + 2, '╰', 'border')
      canvas.set(right, row + 2, '╯', 'border')
      canvas.set(left, row + 1, '│', 'border')
      canvas.set(right, row + 1, '│', 'border')
      // The lifelines run straight through: blanking puts the note over them.
      canvas.charLine(left + 1, right - 1, row + 1, ' ', 'label')
      canvas.text(left + 2, row + 1, event.text, 'label')
      row += 4
      continue
    }

    const from = index.get(event.from)
    const to = index.get(event.to)
    if (from === undefined || to === undefined) {
      row += 3
      continue
    }
    const stroke = STROKE[event.style]!
    const head = event.head === 'cross' ? '✕' : event.head === 'circle' ? '○' : null

    if (from === to) {
      const at = centre(from)
      canvas.hline(at, at + LOOP, row, stroke, 'edge')
      canvas.vline(row, row + 1, at + LOOP, stroke, 'edge')
      canvas.hline(at + 1, at + LOOP, row + 1, stroke, 'edge')
      canvas.set(at + 1, row + 1, head ?? '◀', 'edge')
      canvas.text(at + LOOP + 2, row, event.text, 'edgeLabel')
      row += 3
      continue
    }

    const start = centre(from)
    const end = centre(to)
    const forward = end > start
    canvas.hline(start, end, row + 1, stroke, 'edge')
    canvas.set(end, row + 1, head ?? (forward ? '▶' : '◀'), 'edge')
    const text = event.text
    if (text) {
      const span = Math.abs(end - start)
      const at = Math.min(start, end) + Math.max(0, Math.floor((span - width(text)) / 2))
      canvas.text(at, row, text, 'edgeLabel')
    }
    row += 3
  }

  return canvas.toLines()
}
