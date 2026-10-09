import {
  createMarkdownCodeBlockRenderer,
  fg,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from '@opentui/core'
import type { MarkdownOptions, RenderContext, TextChunk } from '@opentui/core'
import { createSignal } from 'solid-js'

import type { Line, Role } from '../core/mermaid'
import { renderMermaid } from '../core/mermaid'
import type { UiColors } from '../themes/types'
import { scrollbarOptions } from './list'

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
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      chunks.push(fg(ui.dim)('\n'))
    }
    for (const segment of line) {
      chunks.push(fg(colorFor(segment.role, ui))(segment.text))
    }
  }
  return new StyledText(chunks)
}

export function mermaidRenderer(ctx: RenderContext, ui: UiColors) {
  const diagrams = new Set<ScrollBoxRenderable>()
  let active: ScrollBoxRenderable | undefined
  const wide = new Set<ScrollBoxRenderable>()
  const [overflowing, setOverflowing] = createSignal(false)
  const markWide = (box: ScrollBoxRenderable, overflows: boolean) => {
    if (overflows) {
      wide.add(box)
    } else {
      wide.delete(box)
    }
    setOverflowing(wide.size > 0)
  }

  const renderNode: MarkdownOptions['renderNode'] =
    createMarkdownCodeBlockRenderer({
      mermaid: (token) => {
        const lines = renderMermaid(token.text)
        // undefined is what makes the markdown renderable fall back to the fence's source.
        if (!lines) {
          return
        }
        const text = new TextRenderable(ctx, {
          content: diagramText(lines, ui),
          flexShrink: 0,
          height: lines.length,
          wrapMode: 'none',
        })
        const width = text.scrollWidth
        text.width = width
        const box = new ScrollBoxRenderable(ctx, {
          contentOptions: { width },
          flexShrink: 0,
          height: lines.length + 1,
          onMouseDown: () => {
            active = box
          },
          onSizeChange() {
            const overflows = width > this.width
            this.height = lines.length + (overflows ? 1 : 0)
            markWide(box, overflows)
          },
          scrollX: true,
          scrollY: false,
          scrollbarOptions: scrollbarOptions(ui.solidBg),
          verticalScrollbarOptions: { visible: false },
          width: '100%',
        })
        box.add(text)
        diagrams.add(box)
        box.on('destroyed', () => {
          diagrams.delete(box)
          markWide(box, false)
          if (active === box) {
            active = undefined
          }
        })
        return box
      },
    })

  return {
    overflowing,
    renderNode,
    scrollBy(delta: number, viewport: { y: number; height: number }) {
      const visible = [...diagrams]
        .filter(
          (box) =>
            box.y < viewport.y + viewport.height &&
            box.y + box.height > viewport.y &&
            box.scrollWidth > box.viewport.width
        )
        .toSorted((a, b) => a.y - b.y)
      const target = active && visible.includes(active) ? active : visible[0]
      target?.scrollBy({ x: delta, y: 0 })
    },
  }
}
