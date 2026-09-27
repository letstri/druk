import { expect, test } from 'bun:test'

import { ScrollBoxRenderable, TextRenderable } from '@opentui/core'
import type { Renderable } from '@opentui/core'

import {
  fixture,
  launch,
  openFile,
  press,
  pressTimes,
  runCommand,
  settle,
  until,
} from './helpers'
import type { Harness } from './helpers'

const CHART = `graph LR
  A[First node] --> B[Second node] --> C[Third node] --> D[Rightmost node]
`
const fence = (source = CHART) => `\`\`\`mermaid\n${source}\`\`\`\n`
const DOC = `# Diagram\n\nProse stays in place while the diagram scrolls sideways.\n\n${fence()}`

async function preview(content = DOC) {
  const t = await launch(
    fixture({ 'doc.md': content, 'other.md': DOC }),
    {},
    { height: 24, width: 80 }
  )
  await openFile(t, 'doc.md')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => t.captureCharFrame().includes('First node'))
  return t
}

function charts(t: Harness): ScrollBoxRenderable[] {
  const found: ScrollBoxRenderable[] = []
  function walk(node: Renderable) {
    if (
      node instanceof ScrollBoxRenderable &&
      node
        .getChildren()
        .some(
          (child) =>
            child instanceof TextRenderable &&
            child.plainText.includes('First node')
        )
    ) {
      found.push(node)
    }
    for (const child of node.getChildren()) {
      walk(child)
    }
  }
  walk(t.renderer.root)
  return found
}

test('arrows reveal the whole chart while prose keeps its position and wrapping', async () => {
  const t = await preview()
  const before = t
    .captureCharFrame()
    .split('\n')
    .filter((row) => row.includes('Prose') || row.includes('sideways'))
  expect(t.captureCharFrame()).not.toContain('Rightmost node')
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Rightmost node')
  expect(
    t
      .captureCharFrame()
      .split('\n')
      .filter((row) => row.includes('Prose') || row.includes('sideways'))
  ).toEqual(before)
  await pressTimes(t, 30, (input) => input.pressArrow('left'))
  expect(t.captureCharFrame()).toContain('First node')
  expect(charts(t)[0]!.scrollLeft).toBe(0)
})

test('Shift+wheel and horizontal wheel pan the chart, and its scrollbar can be dragged', async () => {
  const t = await preview()
  const box = charts(t)[0]!
  expect(box.horizontalScrollBar.visible).toBe(true)
  await t.mockMouse.scroll(box.x + 2, box.y + 1, 'down', {
    modifiers: { shift: true },
  })
  await settle(t)
  expect(box.scrollLeft).toBeGreaterThan(0)
  const shifted = box.scrollLeft
  await t.mockMouse.scroll(box.x + 2, box.y + 1, 'right')
  await settle(t)
  expect(box.scrollLeft).toBeGreaterThan(shifted)
  const bar = box.horizontalScrollBar
  await t.mockMouse.drag(bar.x + 3, bar.y, bar.x + bar.width - 1, bar.y)
  await settle(t)
  expect(t.captureCharFrame()).toContain('Rightmost node')
})

test('vertical wheel over a chart still scrolls the document', async () => {
  const t = await preview(
    `${DOC}\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i}\n`).join('\n')}`
  )
  const box = charts(t)[0]!
  const top = box.y
  await t.mockMouse.scroll(box.x + 2, box.y + 1, 'down')
  await settle(t)
  expect(box.y).toBeLessThan(top)
  expect(box.scrollLeft).toBe(0)
  expect(box.scrollTop).toBe(0)
})

test('clicking a second chart makes horizontal keys scroll only that chart', async () => {
  const t = await preview(`${DOC}\n${fence()}`)
  const [first, second] = charts(t)
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  await t.mockMouse.click(second!.x + 2, second!.y + 1)
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  expect(first!.scrollLeft).toBe(0)
  expect(second!.scrollLeft).toBeGreaterThan(0)
  expect(t.captureCharFrame()).toContain('First node')
  expect(t.captureCharFrame()).toContain('Rightmost node')
})

test('resizing hides an unnecessary scrollbar and clamps the offset', async () => {
  const t = await preview()
  const box = charts(t)[0]!
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  const narrowHeight = box.height
  t.resize(140, 24)
  await until(t, () => !box.horizontalScrollBar.visible)
  expect(box.scrollLeft).toBe(0)
  expect(box.height).toBe(narrowHeight - 1)
  expect(t.captureCharFrame()).toContain('First node')
  expect(t.captureCharFrame()).toContain('Rightmost node')
  t.resize(70, 24)
  await until(t, () => box.horizontalScrollBar.visible)
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Rightmost node')
})

test('horizontal keys leave charts alone while a modal has the keyboard', async () => {
  const t = await preview()
  const box = charts(t)[0]!
  await press(t, (input) => input.pressKey('o', { ctrl: true }))
  await press(t, (input) => input.pressArrow('right'))
  expect(box.scrollLeft).toBe(0)
})

test('a tall chart keeps every row reachable through document scrolling', async () => {
  const source = `graph TD\n A[First node] --> N0\n${Array.from({ length: 15 }, (_, i) => `N${i} --> N${i + 1}`).join('\n')}\nN15 --> Z[Bottom node]\n`
  const t = await preview(`# Tall\n\n${fence(source)}\nAfter the chart\n`)
  expect(t.captureCharFrame()).not.toContain('Bottom node')
  await press(t, (input) => input.pressKey('END'))
  expect(t.captureCharFrame()).toContain('Bottom node')
  expect(t.captureCharFrame()).toContain('After the chart')
})

test('horizontal keys choose a visible chart after the clicked chart scrolls away', async () => {
  const t = await preview(`${DOC}\n${'Paragraph\n\n'.repeat(30)}${fence()}`)
  const [first, second] = charts(t)
  await t.mockMouse.click(first!.x + 2, first!.y + 1)
  await press(t, (input) => input.pressKey('END'))
  await pressTimes(t, 30, (input) => input.pressKey('l'))
  expect(first!.scrollLeft).toBe(0)
  expect(second!.scrollLeft).toBeGreaterThan(0)
  expect(t.captureCharFrame()).toContain('Rightmost node')
  await pressTimes(t, 30, (input) => input.pressKey('h'))
  expect(second!.scrollLeft).toBe(0)
})

test('opening another markdown file releases the old chart and starts at the left', async () => {
  const t = await preview()
  const old = charts(t)[0]!
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  await openFile(t, 'other.md')
  await runCommand(t, 'Markdown: rendered')
  await until(t, () => t.captureCharFrame().includes('First node'))
  expect(old.isDestroyed).toBe(true)
  expect(charts(t)[0]!.scrollLeft).toBe(0)
  await pressTimes(t, 30, (input) => input.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Rightmost node')
})
