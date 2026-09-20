import { describe, expect, test } from 'bun:test'

import { getSyntaxStyle } from '../src/languages/highlight'
import { allSegments } from './syntax'

const SOURCE = `import { useState } from 'react'

export function Panel({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="panel" onClick={() => setOpen(!open)}>
      <Header.Title id={1}>{title}</Header.Title>
      <hr />
    </section>
  )
}
`

async function painted(filetype: string) {
  const segments = await allSegments(SOURCE, filetype)
  const lines = SOURCE.split('\n')
  const style = getSyntaxStyle()
  const byGroup = new Map<number, string[]>()
  for (const segment of segments) {
    const text = lines[segment.line]?.slice(segment.start, segment.end) ?? ''
    if (!text.trim()) continue
    byGroup.set(segment.styleId, [...(byGroup.get(segment.styleId) ?? []), text])
  }
  return (group: string) => byGroup.get(style.getStyleId(group)!) ?? []
}

describe('jsx', () => {
  test('tag names are tags, not plain text', async () => {
    const group = await painted('typescriptreact')

    expect(group('tag')).toContain('<section')
    expect(group('tag')).toContain('<hr')
    expect(group('tag')).toContain('</section>')
  })

  test('attributes read as attributes', async () => {
    const group = await painted('typescriptreact')

    expect(group('attribute')).toContain('className')
    expect(group('attribute')).toContain('onClick')
    expect(group('attribute')).toContain('id')
  })

  test('calls are lit too', async () => {
    const group = await painted('typescriptreact')

    expect(group('function')).toContain('useState')
    expect(group('function')).toContain('setOpen')
  })

  test('the rest of the TypeScript keeps its own colours', async () => {
    const group = await painted('typescriptreact')

    expect(group('keyword')).toContain('import')
    expect(group('keyword')).toContain('return')
    expect(group('string')).toContain("'react'")
    expect(group('type')).toContain('string')
  })

  test('jsx applies to .jsx as well as .tsx', async () => {
    const group = await painted('javascriptreact')

    expect(group('tag')).toContain('<section')
    expect(group('attribute')).toContain('className')
  })
})
