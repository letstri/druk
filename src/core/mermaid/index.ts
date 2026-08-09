import type { Line } from './canvas'
import { renderGraph } from './graph'
import type { Diagram } from './model'
import { parseMermaid } from './parse'
import { renderPie } from './pie'
import { renderSequence } from './sequence'

export type { Line, Role, Segment } from './canvas'
export type { Diagram } from './model'
export { parseMermaid } from './parse'

/**
 * A ```mermaid fence drawn into terminal cells, or null when the diagram is one
 * nothing here draws — the caller falls back to the source, which is still the
 * whole of what mermaid was given.
 */
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

/** Plain text for a rendered diagram — what the tests and any log assert on. */
export function diagramToText(lines: Line[]): string {
  return lines.map(line => line.map(segment => segment.text).join('')).join('\n')
}
