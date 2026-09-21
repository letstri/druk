import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, until } from './helpers'
import type { Harness } from './helpers'
import { originWithClones } from './repo'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd })

function remoteSetup() {
  const { clone } = originWithClones('druk-footer-')

  const mine = clone('mine')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'first')
  git(mine, 'push', '-q', '-u', 'origin', 'main')
  return { clone, mine }
}

const footer = (t: Harness) => t.captureCharFrame().split('\n').at(-2)!

describe('the footer', () => {
  test('counts unpushed commits, missing ones, and changed files', async () => {
    const { mine, clone } = remoteSetup()

    writeFileSync(join(mine, 'local.ts'), 'const l = 1\n')
    git(mine, 'add', '.')
    git(mine, 'commit', '-qm', 'unpushed')
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
    git(theirs, 'add', '.')
    git(theirs, 'commit', '-qm', 'from elsewhere')
    git(theirs, 'push', '-q')
    git(mine, 'fetch', '-q', '--all')
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
    expect(footer(t)).not.toMatch(/↑\d/u)
    expect(footer(t)).not.toMatch(/↓\d/u)
    expect(footer(t)).not.toMatch(/~\d/u)
  })

  test('the counts follow a commit made outside the editor', async () => {
    const { mine } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'const a = 2\n')

    const t = await launch(mine)
    await until(t, () => footer(t).includes('~1'))

    git(mine, 'commit', '-aqm', 'done')
    await until(t, () => footer(t).includes('↑1'))
    expect(footer(t)).not.toMatch(/~\d/u)
  })
})
