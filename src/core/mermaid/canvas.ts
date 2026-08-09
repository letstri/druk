/**
 * A grid of terminal cells the diagram renderers draw into, plus the role of
 * each cell so the view can colour borders, labels and edges apart.
 *
 * Lines are not written as characters but as the directions they leave a cell
 * in, and the glyph is chosen once everything has been drawn. Writing '─' over
 * '│' cannot know whether that cell is a crossing, a corner or a tee — the
 * accumulated directions can.
 */

export type Role = 'border' | 'label' | 'edge' | 'edgeLabel' | 'title' | 'muted'

export type Stroke = 'solid' | 'dotted' | 'thick'

export interface Segment {
  text: string
  role: Role
}

/** One rendered row: runs of equal role, trailing blanks dropped. */
export type Line = Segment[]

const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8

/** Indexed by the direction bits leaving the cell. */
const GLYPHS: Record<Stroke, string[]> = {
  solid: [' ', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'],
  dotted: [' ', '┆', '┄', '└', '┆', '┆', '┌', '├', '┄', '┘', '┄', '┴', '┐', '┤', '┬', '┼'],
  thick: [' ', '┃', '━', '┗', '┃', '┃', '┏', '┣', '━', '┛', '━', '┻', '┓', '┫', '┳', '╋'],
}

export class Canvas {
  private readonly chars: (string | undefined)[][] = []
  private readonly roles: Role[][] = []
  private readonly bits: number[][] = []
  private readonly strokes: Stroke[][] = []

  private reserve(x: number, y: number): void {
    while (this.chars.length <= y) {
      this.chars.push([])
      this.roles.push([])
      this.bits.push([])
      this.strokes.push([])
    }
    const row = this.chars[y]!
    while (row.length <= x) {
      row.push(undefined)
      this.roles[y]!.push('muted')
      this.bits[y]!.push(0)
      this.strokes[y]!.push('solid')
    }
  }

  /** An explicit glyph — a box border, an arrowhead, a letter. It wins over any
   * line that runs through the same cell. */
  set(x: number, y: number, char: string, role: Role): void {
    if (x < 0 || y < 0) return
    this.reserve(x, y)
    this.chars[y]![x] = char
    this.roles[y]![x] = role
  }

  text(x: number, y: number, text: string, role: Role): void {
    // Code points, not UTF-16 units: a label may hold anything, and half of an
    // astral pair in a cell is a broken glyph rather than a narrow one.
    let at = x
    for (const char of text) {
      this.set(at, y, char, role)
      at++
    }
  }

  charLine(x0: number, x1: number, y: number, char: string, role: Role): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, char, role)
  }

  charColumn(y0: number, y1: number, x: number, char: string, role: Role): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, char, role)
  }

  private connect(x: number, y: number, dirs: number, stroke: Stroke, role: Role): void {
    if (x < 0 || y < 0) return
    this.reserve(x, y)
    this.bits[y]![x] = (this.bits[y]![x] ?? 0) | dirs
    this.strokes[y]![x] = stroke
    if (this.chars[y]![x] === undefined) this.roles[y]![x] = role
  }

  hline(x0: number, x1: number, y: number, stroke: Stroke, role: Role): void {
    const from = Math.min(x0, x1)
    const to = Math.max(x0, x1)
    for (let x = from; x <= to; x++) {
      this.connect(x, y, (x > from ? WEST : 0) | (x < to ? EAST : 0), stroke, role)
    }
  }

  vline(y0: number, y1: number, x: number, stroke: Stroke, role: Role): void {
    const from = Math.min(y0, y1)
    const to = Math.max(y0, y1)
    for (let y = from; y <= to; y++) {
      this.connect(x, y, (y > from ? NORTH : 0) | (y < to ? SOUTH : 0), stroke, role)
    }
  }

  get height(): number {
    return this.chars.length
  }

  toLines(): Line[] {
    return this.chars.map((chars, y) => {
      const roles = this.roles[y]!
      const bits = this.bits[y]!
      const strokes = this.strokes[y]!
      const resolved = chars.map(
        (char, x) => char ?? GLYPHS[strokes[x] ?? 'solid']![bits[x] ?? 0] ?? ' ',
      )
      let end = resolved.length
      while (end > 0 && (resolved[end - 1] ?? ' ') === ' ') end--
      const line: Line = []
      for (let x = 0; x < end; x++) {
        const role = roles[x] ?? 'muted'
        const last = line.at(-1)
        if (last && last.role === role) last.text += resolved[x] ?? ' '
        else line.push({ text: resolved[x] ?? ' ', role })
      }
      return line
    })
  }
}

/** Columns a line of segments occupies. */
