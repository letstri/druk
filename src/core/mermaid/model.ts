type NodeShape = 'rect' | 'round' | 'decision' | 'point'

export type EdgeStyle = 'solid' | 'dotted' | 'thick'

export type ArrowHead =
  | 'none'
  | 'arrow'
  | 'hollow'
  | 'filled'
  | 'open'
  | 'cross'
  | 'circle'

export interface GraphNode {
  id: string
  /** Already wrapped: one entry per row inside the box. */
  label: string[]
  shape: NodeShape
}

export interface GraphEdge {
  from: string
  to: string
  label?: string
  style: EdgeStyle
  head: ArrowHead
  tail: ArrowHead
}

export type Direction = 'TD' | 'BT' | 'LR' | 'RL'

export interface GraphDiagram {
  kind: 'graph'
  direction: Direction
  nodes: GraphNode[]
  edges: GraphEdge[]
  title?: string
}

interface SequenceParticipant {
  id: string
  label: string
}

export type SequenceEvent =
  | {
      type: 'message'
      from: string
      to: string
      text: string
      style: EdgeStyle
      head: ArrowHead
    }
  | { type: 'note'; targets: string[]; text: string }
  | { type: 'block'; keyword: string; text: string; closing: boolean }

export interface SequenceDiagram {
  kind: 'sequence'
  participants: SequenceParticipant[]
  events: SequenceEvent[]
  title?: string
}

interface PieSlice {
  label: string
  value: number
}

export interface PieDiagram {
  kind: 'pie'
  slices: PieSlice[]
  title?: string
  showData: boolean
}

interface UnsupportedDiagram {
  kind: 'unsupported'
  type: string
  reason: string
}

export type Diagram =
  | GraphDiagram
  | SequenceDiagram
  | PieDiagram
  | UnsupportedDiagram
