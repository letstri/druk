import type { Line } from './canvas'
import { renderGraph } from './graph'
import type { Diagram } from './model'
import { parseMermaid } from './parse'
import { renderPie } from './pie'
import { renderSequence } from './sequence'

export type { Line, Role } from './canvas'
export { parseMermaid } from './parse'

export function renderMermaid(source: string): Line[] | null {
  return renderDiagram(parseMermaid(source))
}

function renderDiagram(diagram: Diagram): Line[] | null {
  switch (diagram.kind) {
    case 'graph': {
      // A header with nothing under it is a fence being typed, not a diagram.
      return diagram.nodes.length > 0 ? renderGraph(diagram) : null
    }
    case 'sequence': {
      return diagram.participants.length > 0 ? renderSequence(diagram) : null
    }
    case 'pie': {
      return diagram.slices.length > 0 ? renderPie(diagram) : null
    }
    default: {
      return null
    }
  }
}

export function diagramToText(lines: Line[]): string {
  return lines
    .map((line) => line.map((segment) => segment.text).join(''))
    .join('\n')
}
