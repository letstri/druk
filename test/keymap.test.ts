import { describe, expect, test } from 'bun:test'

import {
  BINDABLE,
  customHolder,
  defaultDisplay,
  keyOverrides,
  matchKeymap,
  resolveKeymap,
} from '../src/app/keymap'
import {
  bindingProblem,
  formatChord,
  matchesChord,
  parseChord,
} from '../src/core/keybindings'
import type { Chord } from '../src/core/keybindings'
import { ALT, KEYS } from '../src/ui/keys'

const event = (
  name: string,
  mods: { ctrl?: boolean; option?: boolean; shift?: boolean } = {}
) =>
  ({
    ctrl: false,
    meta: false,
    name,
    option: false,
    shift: false,
    ...mods,
  }) as Parameters<typeof matchesChord>[1]

const chord = (spelling: string): Chord => parseChord(spelling)!

describe('chord spellings', () => {
  test('parses modifiers, aliases and function keys', () => {
    expect(parseChord('Ctrl+S')).toEqual({ alt: false, ctrl: true, key: 's' })
    expect(parseChord('ctrl+opt+k')).toEqual({
      alt: true,
      ctrl: true,
      key: 'k',
    })
    expect(parseChord('F5')).toEqual({ alt: false, ctrl: false, key: 'f5' })
    expect(parseChord('Ctrl+PgUp')).toEqual({
      alt: false,
      ctrl: true,
      key: 'pageup',
    })
    expect(parseChord('Ctrl+←')).toEqual({
      alt: false,
      ctrl: true,
      key: 'left',
    })
    for (const alt of ['alt', 'option', 'meta', 'cmd', 'shift']) {
      expect(parseChord(`ctrl+${alt}+g`)?.alt).toBe(true)
    }
  })

  test('refuses what is not a chord', () => {
    for (const junk of [
      '',
      'Ctrl',
      'Ctrl+Shift',
      'Ctrl+F13',
      'Ctrl+banana',
      'S+Ctrl',
    ]) {
      expect(parseChord(junk)).toBeNull()
    }
  })

  test('spells a chord back the way the help table writes it', () => {
    expect(formatChord(chord('ctrl+opt+k'), ALT)).toBe(`Ctrl+${ALT}+K`)
    expect(formatChord(chord('f1'), ALT)).toBe('F1')
    expect(formatChord(chord('ctrl+left'), ALT)).toBe('Ctrl+←')
  })
})

describe('what may be bound', () => {
  test('a chord without Ctrl is refused unless it is a function key', () => {
    expect(bindingProblem(chord('f5'))).toBeNull()
    expect(bindingProblem(chord('ctrl+opt+k'))).toBeNull()
    expect(bindingProblem(chord('k'))).toContain('needs Ctrl')
    expect(bindingProblem(chord('opt+k'))).toContain('needs Ctrl')
  })

  test('the chords whose byte belongs to another key are refused', () => {
    for (const spelling of [
      'ctrl+i',
      'ctrl+m',
      'ctrl+j',
      'ctrl+h',
      'ctrl+[',
      'ctrl+space',
    ]) {
      expect(bindingProblem(chord(spelling))).not.toBeNull()
    }
    expect(bindingProblem(chord('ctrl+c'))).toContain('copies')
    expect(bindingProblem(chord('ctrl+opt+i'))).toBeNull()
  })
})

describe('matching a key event', () => {
  test('the modifier slot has to agree', () => {
    expect(matchesChord(chord('ctrl+s'), event('s', { ctrl: true }))).toBe(true)
    expect(matchesChord(chord('ctrl+s'), event('s'))).toBe(false)
    expect(
      matchesChord(
        chord('ctrl+opt+p'),
        event('p', { ctrl: true, option: true })
      )
    ).toBe(true)
    expect(
      matchesChord(chord('ctrl+p'), event('p', { ctrl: true, option: true }))
    ).toBe(false)
  })

  test('Enter arrives under either name', () => {
    expect(
      matchesChord(chord('ctrl+enter'), event('return', { ctrl: true }))
    ).toBe(true)
    expect(
      matchesChord(chord('ctrl+enter'), event('enter', { ctrl: true }))
    ).toBe(true)
  })
})

describe('the default keymap', () => {
  test('every bindable command has a handler, and every handler a command', async () => {
    const source = await Bun.file(
      new URL('../src/app/keyboard.ts', import.meta.url)
    ).text()
    const handlers = source
      .slice(
        source.indexOf('const handlers'),
        source.indexOf('useKeyboard((key')
      )
      .matchAll(/^\s{4}'?([\w.]+)'?:/gmu)
    expect([...handlers].map((match) => match[1]).toSorted()).toEqual(
      BINDABLE.map((spec) => spec.id).toSorted()
    )
  })

  test('no two commands ship with the same chord', () => {
    const keymap = resolveKeymap({})
    expect(keymap.conflicts).toEqual([])
    expect(keymap.invalid).toEqual([])
    expect(keymap.custom.size).toBe(0)
  })

  test('the help table advertises the keys the keymap actually holds', () => {
    for (const info of KEYS) {
      if (info.ids?.length !== 1) {
        continue
      }
      const spec = BINDABLE.find((entry) => entry.id === info.ids![0])
      expect(
        spec,
        `${info.ids[0]} is advertised but not bindable`
      ).toBeDefined()
      expect(defaultDisplay(spec!)).toBe(info.key)
    }
  })

  test('every advertised id is bindable', () => {
    for (const id of KEYS.flatMap((info) => info.ids ?? [])) {
      expect(
        BINDABLE.some((spec) => spec.id === id),
        `${id} is not bindable`
      ).toBe(true)
    }
  })

  test('the built-in chords land on their commands', () => {
    const keymap = resolveKeymap({})
    expect(matchKeymap(keymap, event('s', { ctrl: true }))).toBe('save')
    expect(matchKeymap(keymap, event('f1'))).toBe('palette')
    expect(matchKeymap(keymap, event('p', { ctrl: true, option: true }))).toBe(
      'palette'
    )
    expect(matchKeymap(keymap, event('pageup', { ctrl: true }))).toBe(
      'tabs.prev'
    )
    expect(matchKeymap(keymap, event('pagedown', { ctrl: true }))).toBe(
      'tabs.next'
    )
    // The textarea's word motion, left to it.
    expect(matchKeymap(keymap, event('left', { ctrl: true }))).toBeNull()
    expect(matchKeymap(keymap, event('y', { ctrl: true }))).toBeNull()
  })
})

describe('custom bindings', () => {
  test('a custom chord replaces the default, aliases included', () => {
    const keymap = resolveKeymap({
      'tabs.prev': 'F7',
      'view.sidebar': 'Ctrl+Opt+B',
    })
    expect(matchKeymap(keymap, event('b', { ctrl: true, option: true }))).toBe(
      'view.sidebar'
    )
    expect(matchKeymap(keymap, event('b', { ctrl: true }))).toBeNull()
    expect(matchKeymap(keymap, event('f7'))).toBe('tabs.prev')
    expect(matchKeymap(keymap, event('pageup', { ctrl: true }))).toBeNull()
    expect(keymap.display.get('view.sidebar')).toBe(`Ctrl+${ALT}+B`)
    expect(keymap.custom).toEqual(new Set(['view.sidebar', 'tabs.prev']))
  })

  test('a command with no default can be given one', () => {
    const keymap = resolveKeymap({ 'git.commit': 'Ctrl+Opt+K' })
    expect(matchKeymap(keymap, event('k', { ctrl: true, option: true }))).toBe(
      'git.commit'
    )
    expect(keymap.conflicts).toEqual([])
  })

  test('"none" leaves a command unbound', () => {
    const keymap = resolveKeymap({ save: 'none' })
    expect(matchKeymap(keymap, event('s', { ctrl: true }))).toBeNull()
    expect(keymap.display.get('save')).toBe('')
  })

  test('a value that is not a chord is reported and the default kept', () => {
    const keymap = resolveKeymap({ quit: 'q', save: 'Ctrl+Banana' })
    expect(keymap.invalid.map((entry) => entry.id)).toEqual(['save', 'quit'])
    expect(keymap.invalid[1]!.reason).toContain('needs Ctrl')
    expect(matchKeymap(keymap, event('s', { ctrl: true }))).toBe('save')
    expect(matchKeymap(keymap, event('q', { ctrl: true }))).toBe('quit')
  })
})

describe('clashes', () => {
  test('a custom binding takes the chord from a default, and says so', () => {
    const keymap = resolveKeymap({ 'git.commit': 'Ctrl+B' })
    expect(matchKeymap(keymap, event('b', { ctrl: true }))).toBe('git.commit')
    expect(keymap.conflicts).toEqual([
      {
        key: 'Ctrl+B',
        loser: 'Show / hide sidebar',
        rejected: false,
        winner: 'Commit…',
      },
    ])
    expect(keymap.display.get('view.sidebar')).toBe('')
  })

  test('between two custom bindings the earlier command keeps the chord', () => {
    const keymap = resolveKeymap({
      'git.commit': 'Ctrl+Opt+K',
      'git.push': 'Ctrl+Opt+K',
    })
    expect(matchKeymap(keymap, event('k', { ctrl: true, option: true }))).toBe(
      'git.commit'
    )
    const clash = keymap.conflicts.find((entry) => entry.rejected)
    expect(clash).toEqual({
      key: `Ctrl+${ALT}+K`,
      loser: 'Push',
      rejected: true,
      winner: 'Commit…',
    })
    expect(keymap.display.get('git.push')).toBe('')
  })

  test('a chord another custom binding holds is refusable by name', () => {
    const keymap = resolveKeymap({ 'git.commit': 'Ctrl+Opt+K' })
    expect(customHolder(keymap, chord('ctrl+opt+k'), 'git.push')?.id).toBe(
      'git.commit'
    )
    expect(customHolder(keymap, chord('ctrl+opt+k'), 'git.commit')).toBeNull()
    expect(customHolder(keymap, chord('ctrl+b'), 'git.push')).toBeNull()
  })
})

describe('what the help table is told', () => {
  test('only rebound commands are marked as changed', () => {
    const overrides = keyOverrides(
      resolveKeymap({ 'view.sidebar': 'Ctrl+Opt+B' })
    )
    expect(overrides['view.sidebar']).toEqual({
      changed: true,
      key: `Ctrl+${ALT}+B`,
      label: 'Show / hide sidebar',
    })
    expect(overrides.save).toEqual({
      changed: false,
      key: 'Ctrl+S',
      label: 'Save file',
    })
  })

  test('a command that lost its key to someone else counts as changed', () => {
    const overrides = keyOverrides(resolveKeymap({ 'git.commit': 'Ctrl+B' }))
    expect(overrides['view.sidebar']).toEqual({
      changed: true,
      key: '',
      label: 'Show / hide sidebar',
    })
  })
})
