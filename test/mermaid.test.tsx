import { expect, test } from 'bun:test'

import { diagramToText, parseMermaid, renderMermaid } from '../src/core/mermaid'
import { fixture, launch, openFile, runCommand, until } from './helpers'
import type { Harness } from './helpers'

const draw = (source: string) => {
  const lines = renderMermaid(source)
  return lines ? diagramToText(lines) : null
}

test('a flowchart draws its nodes as boxes joined by arrows', () => {
  const text = draw(`flowchart TD
  A[Start] --> B{Ok?}
  B -->|yes| C[Ship]
  B -->|no| D[Fix]
`)!
  expect(text).toContain('Start')
  expect(text).toContain('║ Ok? ║')
  expect(text).toContain('Ship')
  expect(text).toContain('yes')
  expect(text).toContain('no')
  expect(text).toContain('▼')
  expect(text).not.toContain('┼─┼')
})

test('a cycle is layered rather than hanging, and its edge is turned round', () => {
  const text = draw(`graph TD
  A --> B
  B --> C
  C --> A
`)!
  expect(text).toContain('▲')
  expect(text.split('\n').length).toBeLessThan(30)
})

test('a left-to-right flowchart puts its layers in columns', () => {
  const text = draw(`graph LR
  A[One] -->|next| B[Two]
`)!
  const row = text.split('\n').find((line) => line.includes('One'))!
  expect(row).toContain('Two')
  expect(row).toContain('next')
  expect(row).toContain('▶')
})

test('a sequence diagram draws lifelines and messages in order', () => {
  const text = draw(`sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: hello
  B-->>A: hi back
  Note over A,B: a note
  loop twice
    A->>A: think
  end
`)!
  expect(text).toContain('Alice')
  expect(text).toContain('Bob')
  expect(text.indexOf('hello')).toBeLessThan(text.indexOf('hi back'))
  expect(text).toContain('◀')
  expect(text).toContain('a note')
  expect(text).toContain('loop twice')
})

test('a class diagram keeps its members and points inheritance at the parent', () => {
  const text = draw(`classDiagram
  Animal <|-- Duck
  Animal : +int age
  class Duck {
    +swim()
  }
`)!
  const lines = text.split('\n')
  expect(text).toContain('+int age')
  expect(text).toContain('+swim()')
  expect(text).toContain('▽')
  expect(lines.findIndex((line) => line.includes('Duck'))).toBeLessThan(
    lines.findIndex((line) => line.includes('Animal'))
  )
})

test('a state diagram marks its start and end', () => {
  const text = draw(`stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> [*]
`)!
  expect(text).toContain('●')
  expect(text).toContain('start')
  expect(text).toContain('Running')
})

test('an ER diagram carries the cardinality on the relation', () => {
  const text = draw(`erDiagram
  CUSTOMER ||--o{ ORDER : places
`)!
  expect(text).toContain('CUSTOMER')
  expect(text).toContain('places')
  expect(text).toContain('1')
  expect(text).toContain('0..N')
})

test('a pie chart becomes bars with the share of each slice', () => {
  const text = draw(`pie title Share
  "One" : 75
  "Two" : 25
`)!
  expect(text).toContain('Share')
  expect(text).toContain('75.0%')
  expect(text).toContain('25.0%')
  expect(text).toContain('█')
})

test('a diagram type with no drawing falls back to nothing, and says which', () => {
  expect(draw('gantt\n  title A\n')).toBeNull()
  const diagram = parseMermaid('gantt\n  title A\n')
  expect(diagram.kind).toBe('unsupported')
})

test('front matter and directives are dropped rather than read as nodes', () => {
  const text = draw(`---
title: ignored
---
%%{init: {'theme':'dark'}}%%
graph TD
  A[Only] --> B[Two]
`)!
  expect(text).toContain('Only')
  expect(text).not.toContain('init')
  expect(text).not.toContain('ignored')
})

const DOC = `# Diagram

\`\`\`mermaid
graph TD
  Editor[Editor] --> Server[Language server]
\`\`\`
`

test('a mermaid fence is drawn in the markdown preview, not printed as source', async () => {
  const t: Harness = await launch(
    fixture({ 'doc.md': DOC }),
    {},
    { height: 30, width: 100 }
  )
  await openFile(t, 'doc.md')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => t.captureCharFrame().includes('Language server'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('┌')
  expect(frame).toContain('▼')
  expect(frame).not.toContain('graph TD')
})
