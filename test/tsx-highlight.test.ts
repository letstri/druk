import { describe, expect, test } from 'bun:test'

import { highlightClient, segmentsIn, styleIdForGroup } from '../src/languages/highlight'
import { registerTheme, setTheme, themeFor } from '../src/themes'
import { parseHighlights, WHOLE } from './syntax'

const SOURCE = `import * as React from 'react'
import { cn } from '@/lib/utils'

const TableRow = ({ className, ...props }: React.ComponentProps<'tr'>) => (
  <tr
    data-slot="table-row"
    className={cn(\`
      border-b transition-colors
    \`, className)}
    {...props}
  />
)

function total(rows: Row[]) {
  return rows.length > 0 ? 1 : 2
}
`

async function captured(source: string) {
  const client = await highlightClient()
  if (!client) throw new Error('tree-sitter client unavailable')
  const result = await client.highlightOnce(source, 'typescriptreact')
  const byGroup = new Map<string, string[]>()
  for (const [start, end, group] of result.highlights ?? []) {
    byGroup.set(group, [...(byGroup.get(group) ?? []), source.slice(start, end)])
  }
  return (group: string) => byGroup.get(group) ?? []
}

/** Whether some occurrence of `text` is painted with `group`'s style. */
function paintedAs(source: string, parsed: Awaited<ReturnType<typeof parseHighlights>>) {
  const lines = source.split('\n')
  return (text: string, group: string) => {
    const wanted = styleIdForGroup(group)
    if (wanted == null) throw new Error(`no style for ${group}`)
    return segmentsIn(parsed, 0, WHOLE).some(
      segment =>
        lines[segment.line]?.slice(segment.start, segment.end) === text &&
        segment.styleId === wanted,
    )
  }
}

describe('tsx highlighting', () => {
  test('paints the tokens a component file is mostly made of', async () => {
    const group = await captured(SOURCE)

    // A template literal is a string like any other — without it the tailwind
    // class lists that fill a component render as unpainted text.
    expect(group('string').some(text => text.includes('border-b transition-colors'))).toBe(true)
    expect(group('variable')).toContain('props')
    expect(group('variable.member')).toContain('className')
    expect(group('namespace')).toContain('React')
    expect(group('function')).toContain('cn')
    expect(group('function')).toContain('total')
    expect(group('function')).toContain('TableRow')
    expect(group('attribute')).toContain('data-slot')
    expect(group('attribute')).toContain('className')
    expect(group('tag')).toContain('tr')
    expect(group('tag.delimiter')).toContain('/>')
    expect(group('operator')).toContain('=>')
    expect(group('operator')).toContain('...')
  })

  test('the specific captures win over the generic identifier one', async () => {
    const parsed = await parseHighlights(SOURCE, 'typescriptreact')
    const painted = paintedAs(SOURCE, parsed)

    expect(painted('total', 'function')).toBe(true)
    expect(painted('React', 'namespace')).toBe(true)
    expect(painted('<tr', 'tag')).toBe(true)
    expect(painted('data-slot', 'attribute')).toBe(true)
  })

  // `.ts` and `.js` go through the same vendored grammar as `.tsx` now, on
  // purpose: OpenTUI's bundled typescript query gates its identifier captures
  // behind `#lua-match?` predicates the parser worker never evaluates, so every
  // lowercase identifier also matched `@type` and `@constant` — and the last of
  // those painted every identifier in the file as a constant.
  test('a plain .ts identifier paints as a variable, not a constant', async () => {
    const source = 'const title = other\n'
    const parsed = await parseHighlights(source, 'typescript')
    const painted = paintedAs(source, parsed)
    expect(painted('title', 'variable')).toBe(true)
    expect(painted('other', 'variable')).toBe(true)
  })

  test('a theme listing none of the newer root scopes still paints them', () => {
    registerTheme('spartan', {
      name: 'Spartan',
      ui: themeFor('dark').ui,
      syntax: { property: { fg: '#ff0000' }, function: { fg: '#00ff00' }, type: { fg: '#0000ff' } },
    })
    setTheme('spartan')
    try {
      expect(styleIdForGroup('attribute')).toBe(styleIdForGroup('property'))
      expect(styleIdForGroup('constructor')).toBe(styleIdForGroup('function'))
      expect(styleIdForGroup('namespace')).toBe(styleIdForGroup('type'))
    } finally {
      setTheme('dark')
    }
  })
})
