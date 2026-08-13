import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, until } from './helpers'
import type { Harness } from './helpers'
import { tempDir } from './temp'

/**
 * druk runs no git commands of its own any more, so everything here is set up with
 * real git and only the reporting is asserted.
 */
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/** A bare "remote" plus clones of it, so ahead/behind are real. */
function remoteSetup() {
  const base = tempDir('druk-footer-')
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

  const clone = (name: string) => {
    const dir = join(base, name)
    execFileSync('git', ['clone', '-q', origin, dir])
    git(dir, 'config', 'user.email', `${name}@example.com`)
    git(dir, 'config', 'user.name', name)
    return dir
  }

  const mine = clone('mine')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'first')
  git(mine, 'push', '-q', '-u', 'origin', 'main')
  return { mine, clone }
}

const footer = (t: Harness) => t.captureCharFrame().split('\n').at(-2)!

describe('the footer', () => {
  test('counts unpushed commits, missing ones, and changed files', async () => {
    const { mine, clone } = remoteSetup()

    // one commit of mine that origin has not seen
    writeFileSync(join(mine, 'local.ts'), 'const l = 1\n')
    git(mine, 'add', '.')
    git(mine, 'commit', '-qm', 'unpushed')
    // one of theirs that I have not merged
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
    git(theirs, 'add', '.')
    git(theirs, 'commit', '-qm', 'from elsewhere')
    git(theirs, 'push', '-q')
    git(mine, 'fetch', '-q', '--all')
    // and an edit sitting in my working tree
    writeFileSync(join(mine, 'a.ts'), 'const a = 999\n')

    const t = await launch(mine)
    expect(footer(t)).toContain('main')
    expect(footer(t)).toContain('↑1')
    expect(footer(t)).toContain('↓1')
    expect(footer(t)).toContain('~1')
  })

  test('a clean branch in sync shows the branch alone', async () => {
    const { mine } = remoteSetup()
    const t = await launch(mine)

    expect(footer(t)).toContain('main')
    expect(footer(t)).not.toMatch(/↑\d/)
    expect(footer(t)).not.toMatch(/↓\d/)
    expect(footer(t)).not.toMatch(/~\d/)
  })

  test('the counts follow a commit made outside the editor', async () => {
    const { mine } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'const a = 2\n')

    const t = await launch(mine)
    await until(t, () => footer(t).includes('~1'))

    git(mine, 'commit', '-aqm', 'done')
    await until(t, () => footer(t).includes('↑1'))
    expect(footer(t)).not.toMatch(/~\d/)
  })
})
