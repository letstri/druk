import type { Line } from './canvas'
import type { PieDiagram } from './model'

const BAR = 24

export function renderPie(diagram: PieDiagram): Line[] {
  const total = diagram.slices.reduce((sum, slice) => sum + slice.value, 0)
  if (diagram.slices.length === 0 || total <= 0) {
    return [[{ text: diagram.title ?? 'pie', role: 'title' }]]
  }

  const labelWidth = Math.max(...diagram.slices.map(slice => [...slice.label].length))
  const lines: Line[] = []
  if (diagram.title) {
    lines.push([{ text: diagram.title, role: 'title' }], [])
  }
  for (const slice of diagram.slices) {
    const share = slice.value / total
    const filled = Math.max(1, Math.round(share * BAR))
    const percent = `${(share * 100).toFixed(1)}%`
    lines.push([
      { text: slice.label.padEnd(labelWidth), role: 'label' },
      { text: ' ', role: 'muted' },
      { text: '█'.repeat(filled), role: 'edge' },
      { text: '░'.repeat(BAR - filled), role: 'muted' },
      { text: ` ${percent.padStart(6)}`, role: 'edgeLabel' },
      { text: diagram.showData ? `  (${slice.value})` : '', role: 'muted' },
    ])
  }
  return lines
}
