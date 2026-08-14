import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, openFile, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/** A repo with one committed file, one edit and one untracked file. */
function repo() {
  const dir = tempDir('druk-bar-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@e.com')
  git('config', 'user.name', 'T')
  writeFileSync(join(dir, 'a.ts'), 'const alpha = 1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'const alpha = 2\n')
  writeFileSync(join(dir, 'b.ts'), 'const b = 1\n')
  return dir
}

const bar = (t: Harness) => t.captureCharFrame().split('\n').at(-2) ?? ''

async function openFirst(t: Harness, name: string) {
  await openFile(t, name)
}

describe('the status bar', () => {
  test('puts git on the left and the file on the right', async () => {
    const t = await launch(repo())
    await openFirst(t, 'a.ts')
    const row = bar(t)

    const branch = row.indexOf('⎇')
    const changed = row.indexOf('~')
    const cursor = row.indexOf('Ln ')
    const filetype = row.indexOf('ts')

    expect(branch).toBeGreaterThanOrEqual(0)
    expect(cursor).toBeGreaterThanOrEqual(0)
    // Everything git sits left of everything about the file.
    expect(changed).toBeGreaterThan(branch)
    expect(cursor).toBeGreaterThan(changed)
    expect(filetype).toBeGreaterThan(cursor)
  })

  test('the git group keeps its counts together', async () => {
    const t = await launch(repo())
    await openFirst(t, 'a.ts')
    // Branch, then its counts, with nothing else wedged between them.
    expect(bar(t)).toMatch(/⎇ main( ↑\d+)?( ↓\d+)? ~\d+/)
  })

  test('the unsaved marker belongs to the right-hand group', async () => {
    const t = await launch(repo())
    await openFirst(t, 'a.ts')
    await press(t, input => void input.typeText('X'))
    await settle(t)

    const row = bar(t)
    expect(row.indexOf('● unsaved')).toBeGreaterThan(row.indexOf('⎇'))
    expect(row.indexOf('● unsaved')).toBeLessThan(row.indexOf('Ln '))
  })

  test('the vim badge stays leftmost, ahead of git', async () => {
    const t = await launch(repo(), { vim: true })
    await openFirst(t, 'a.ts')
    const row = bar(t)
    expect(row.indexOf('NORMAL')).toBeLessThan(row.indexOf('⎇'))
  })

  test('outside a repository the left side is just the message', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
    await openFirst(t, 'a.ts')
    const row = bar(t)

    expect(row).not.toContain('⎇')
    expect(row).toContain('ts')
    expect(row.trimStart().startsWith('F1')).toBe(true)
  })
})

describe('the footer hints', () => {
  test('the tree advertises the global pair first, then its own keys', async () => {
    const row = bar(await launch(fixture({ 'a.ts': 'x\n' })))
    expect(row).toContain('F1 commands')
    expect(row).toContain('Ctrl+K keys')
    expect(row).toContain('Space preview')
  })

  test('the editor swaps the tree keys for its own', async () => {
    const t = await launch(fixture({ 'a.ts': 'x\n' }))
    await openFirst(t, 'a.ts')
    const row = bar(t)

    expect(row).toContain('F1 commands')
    expect(row).toContain('Ctrl+K keys')
    expect(row).toContain('Ctrl+F find')
    expect(row).not.toContain('Space preview')
  })
})

describe('the hints are what gives way when space runs out', () => {
  const countHints = (row: string) => (row.match(/Ctrl\+|Enter |↑↓|F1 /g) ?? []).length

  test('a message takes precedence over them', async () => {
    // Narrow on purpose: at a full-width terminal every hint fits beside the
    // message and nothing has to give way.
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, { width: 56 })
    await openFirst(t, 'a.ts')
    const idle = countHints(bar(t))

    await press(t, input => void input.typeText('X'))
    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)

    const row = bar(t)
    expect(row).toContain('Saved a.ts')
    expect(countHints(row)).toBeLessThan(idle)
    expect(row.length).toBeLessThanOrEqual(80)
  })

  test('a narrower terminal shows fewer of them', async () => {
    const wide = bar(await launch(fixture({ 'a.ts': 'x\n' })))
    const narrow = bar(await launch(fixture({ 'a.ts': 'x\n' }), {}, { width: 24 }))

    expect(countHints(narrow)).toBeLessThan(countHints(wide))
    expect(narrow.length).toBeLessThanOrEqual(24)
  })

  test('a very narrow one drops them all and keeps the file facts', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, { width: 32 })
    await openFirst(t, 'a.ts')
    const row = bar(t)

    expect(row.length).toBeLessThanOrEqual(32)
    expect(row).not.toContain('commands')
    // The caret position is the thing a user cannot work out for themselves.
    expect(row).toContain('Ln 1')
  })
})

describe('a message far too long for the bar', () => {
  /**
   * A rename onto a name that is taken reports `already exists: <name>`, so a long
   * enough filename gives a long enough message. Nothing in the editor produces a
   * message this long by design — the bar has to survive one anyway.
   */
  const TAKEN = `${'occupied-'.repeat(12)}.ts`

  async function longMessage(width: number) {
    const dir = fixture({ 'a.ts': 'const a = 1\n', [TAKEN]: 'x\n' })
    const t = await launch(dir, {}, { width })
    await openFirst(t, 'a.ts')
    await pressEscape(t)
    await settle(t, 80)

    // Selection is on a.ts after opening it; rename it onto the name already there.
    await press(t, input => void input.typeText('r'))
    await press(t, input => void input.typeText(TAKEN))
    await press(t, input => input.pressEnter())
    await settle(t)
    return t
  }

  test('is clipped, and does not push the file facts off the edge', async () => {
    const t = await longMessage(80)
    const row = bar(t)

    expect(row).toContain('…') // clipped rather than overflowing
    expect(row.length).toBeLessThanOrEqual(80)
    // Everything to the right of the message must survive it.
    expect(row).toContain('Ln 1')
    expect(row).toContain('ts')
  })

  test('is dropped entirely when there is no room for it at all', async () => {
    const t = await longMessage(30)
    const row = bar(t)
    expect(row.length).toBeLessThanOrEqual(30)
    expect(row).toContain('Ln 1')
  })
})
