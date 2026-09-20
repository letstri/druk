import { createMarkdownCodeBlockRenderer, fg, StyledText, TextRenderable } from '@opentui/core'
import type { MarkdownOptions, RenderContext, TextChunk } from '@opentui/core'

import type { Line, Role } from '../core/mermaid'
import { renderMermaid } from '../core/mermaid'
import type { UiColors } from '../themes/types'

function colorFor(role: Role, ui: UiColors): string {
  switch (role) {
    case 'label':
    case 'title': {
      return ui.text
    }
    case 'edgeLabel': {
      return ui.accent
    }
    case 'muted': {
      return ui.faint
    }
    default: {
      return ui.dim
    }
  }
}

function diagramText(lines: Line[], ui: UiColors): StyledText {
  const chunks: TextChunk[] = []
  lines.forEach((line, index) => {
    if (index > 0) chunks.push(fg(ui.dim)('\n'))
    for (const segment of line) chunks.push(fg(colorFor(segment.role, ui))(segment.text))
  })
  return new StyledText(chunks)
}

export function mermaidRenderer(ctx: RenderContext, ui: UiColors): MarkdownOptions['renderNode'] {
  return createMarkdownCodeBlockRenderer({
    mermaid: token => {
      const lines = renderMermaid(token.text)
      // undefined is what makes the markdown renderable fall back to the fence's source.
      if (!lines) return undefined
      return new TextRenderable(ctx, {
        content: diagramText(lines, ui),
        wrapMode: 'none',
      })
    },
  })
}
