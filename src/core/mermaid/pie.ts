import type { Line } from './canvas'
import type { PieDiagram } from './model'

const BAR = 24

export function renderPie(diagram: PieDiagram): Line[] {
  const total = diagram.slices.reduce((sum, slice) => sum + slice.value, 0)
  if (diagram.slices.length === 0 || total <= 0) {
    return [[{ role: 'title', text: diagram.title ?? 'pie' }]]
  }

  const labelWidth = Math.max(
    ...diagram.slices.map((slice) => [...slice.label].length)
  )
  const lines: Line[] = []
  if (diagram.title) {
    lines.push([{ role: 'title', text: diagram.title }], [])
  }
  for (const slice of diagram.slices) {
    const share = slice.value / total
    const filled = Math.max(1, Math.round(share * BAR))
    const percent = `${(share * 100).toFixed(1)}%`
    lines.push([
      { role: 'label', text: slice.label.padEnd(labelWidth) },
      { role: 'muted', text: ' ' },
      { role: 'edge', text: '█'.repeat(filled) },
      { role: 'muted', text: '░'.repeat(BAR - filled) },
      { role: 'edgeLabel', text: ` ${percent.padStart(6)}` },
      { role: 'muted', text: diagram.showData ? `  (${slice.value})` : '' },
    ])
  }
  return lines
}
