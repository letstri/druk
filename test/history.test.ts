import { describe, expect, test } from 'bun:test'

import { BURST_MS, History } from '../src/editor/history'

const at = (content: string, cursor = 0) => ({ content, cursor })

describe('undo history', () => {
  test('collapses a typing burst into one step', () => {
    const history = new History(at(''))
    history.record(at('h'), 1000)
    history.record(at('he'), 1040)
    history.record(at('hel'), 1080)

    expect(history.undo()?.content).toBe('')
    expect(history.undo()).toBeNull()
  })

  test('a pause starts a new step', () => {
    const history = new History(at(''))
    history.record(at('one'), 1000)
    history.record(at('one two'), 1000 + BURST_MS + 1)

    expect(history.undo()?.content).toBe('one')
    expect(history.undo()?.content).toBe('')
    expect(history.undo()).toBeNull()
  })

  test('redo replays what undo took back, until a new edit', () => {
    const history = new History(at(''))
    history.record(at('typed'), 1000)

    expect(history.undo()?.content).toBe('')
    expect(history.redo()?.content).toBe('typed')
    expect(history.redo()).toBeNull()

    history.undo()
    history.record(at('other'), 5000)
    expect(history.redo()).toBeNull()
  })

  test('restores the cursor from before the edit', () => {
    const history = new History(at('abc', 3))
    history.record({ content: 'abcdef', cursor: 3 }, 1000)
    expect(history.undo()).toEqual({ content: 'abc', cursor: 3 })
  })

  test('the first undo lands where the burst started, not where the file opened', () => {
    // The buffer opened with the caret at 0; the typing happened at offset 40.
    const history = new History(at('a'.repeat(80), 0))
    history.record({ content: `${'a'.repeat(40)}x${'a'.repeat(40)}`, cursor: 40 }, 1000)

    expect(history.undo()?.cursor).toBe(40)
  })

  test('a reload from disk is not an undo step', () => {
    const history = new History(at(''))
    history.record(at('mine'), 1000)
    history.reset(at('theirs'))

    expect(history.undo()).toBeNull()
  })

  test('ignores a change that leaves the text identical', () => {
    const history = new History(at('same'))
    history.record(at('same'), 1000)
    expect(history.undo()).toBeNull()
  })
})
