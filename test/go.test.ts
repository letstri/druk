import { describe, expect, test } from 'bun:test'

import {
  filetypeForPath,
  highlightClient,
  segmentsIn,
  styleIdForGroup,
} from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { parseHighlights, WHOLE } from './syntax'

loadMarketExtensions()

async function captured(source: string) {
  const client = await highlightClient()
  if (!client) {
    throw new Error('tree-sitter client unavailable')
  }
  const result = await client.highlightOnce(source, 'go')
  const byGroup = new Map<string, string[]>()
  for (const [start, end, group] of result.highlights ?? []) {
    byGroup.set(group, [
      ...(byGroup.get(group) ?? []),
      source.slice(start, end),
    ])
  }
  return (group: string) => byGroup.get(group) ?? []
}

const SOURCE = `package main

import "fmt"

var ready chan map[string]bool

type server struct {
  port int
}

func newServer(port int) *server {
  return &server{port: port}
}

func (s *server) listen(addr string) error {
  fmt.Println("listening", addr)
  return nil
}

func main() {
  s := newServer(8080)
  _ = s.listen(':')
  println("ready")
}
`

describe('go highlighting', () => {
  test('recognises .go files', () => {
    expect(filetypeForPath('main.go')).toBe('go')
    expect(filetypeForPath('cmd/server/main.go')).toBe('go')
  })

  test('paints declarations, calls, builtins and operators', async () => {
    const group = await captured(SOURCE)

    expect(group('function')).toContain('newServer')
    expect(group('function.method')).toContain('listen')
    expect(group('function.method')).toContain('Println')
    expect(group('function.builtin')).toContain('println')
    expect(group('variable')).toContain('addr')
    expect(group('operator')).toContain(':=')
    expect(group('keyword')).toContain('chan')
    expect(group('keyword')).toContain('map')
    expect(group('string')).toContain("':'")
    expect(group('constant.builtin')).toContain('nil')
  })

  test('function captures win over generic identifiers when painted', async () => {
    const parsed = await parseHighlights(SOURCE, 'go')
    const lines = SOURCE.split('\n')
    const functionStyle = styleIdForGroup('function')
    if (functionStyle === null || functionStyle === undefined) {
      throw new Error('function style unavailable')
    }
    const names = segmentsIn(parsed, 0, WHOLE)
      .filter(
        (segment) =>
          lines[segment.line]?.slice(segment.start, segment.end) === 'newServer'
      )
      .map((segment) => segment.styleId)

    expect(names).toEqual([functionStyle, functionStyle])
  })
})
