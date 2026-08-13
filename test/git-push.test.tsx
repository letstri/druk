import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { launch, press, pressEscape, runCommand, until } from './helpers'
import { tempDir } from './temp'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/**
 * A clone whose branch has diverged from origin: one commit of theirs on the
 * remote, one of mine on top of the old tip. That is the only shape a push is
 * rejected in, so it is the shape the offer has to be tested against.
 */
function diverged() {
  const base = tempDir('druk-push-')
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

  const clone = (name: string) => {
    const dir = join(base, name)
    execFileSync('git', ['clone', '-q', origin, dir])
    git(dir, 'config', 'user.email', `${name}@example.com`)
    git(dir, 'config', 'user.name', name)
    git(dir, 'config', 'commit.gpgsign', 'false')
    return dir
  }

  const mine = clone('mine')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'first')
  git(mine, 'push', '-q', '-u', 'origin', 'main')

  const theirs = clone('theirs')
  writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
  git(theirs, 'add', '.')
  git(theirs, 'commit', '-qm', 'from elsewhere')
  git(theirs, 'push', '-q')

  writeFileSync(join(mine, 'local.ts'), 'const l = 1\n')
  git(mine, 'add', '.')
  git(mine, 'commit', '-qm', 'mine alone')
  return { mine, origin }
}

/** Every subject on origin's main, newest first. */
const remoteLog = (origin: string) =>
  execFileSync('git', ['log', '--format=%s', 'main'], { cwd: origin }).toString()

test('a rejected push offers to merge origin in and push again', async () => {
  const { mine, origin } = diverged()
  const t = await launch(mine)

  await runCommand(t, 'Push')
  await until(t, () => t.captureCharFrame().includes('Push rejected'))
  expect(t.captureCharFrame()).toContain("origin/main has commits you don't")

  await press(t, i => i.pressEnter())
  await until(t, () => remoteLog(origin).includes('mine alone'))
  expect(remoteLog(origin)).toContain('from elsewhere')
})

test('declining the offer leaves the rejection on the status bar', async () => {
  const { mine, origin } = diverged()
  const t = await launch(mine)

  await runCommand(t, 'Push')
  await until(t, () => t.captureCharFrame().includes('Push rejected'))

  await pressEscape(t)
  await until(t, () => t.captureCharFrame().includes('pull first, then push'))
  expect(remoteLog(origin)).not.toContain('mine alone')
})
