import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { forgeCommitUrl } from '../src/core/git'
import { laneSpans, refChips } from '../src/ui/graphLanes'
import { fixture, launch, press, pressTimes, runCommand, untilFrame } from './helpers'
import { git, initRepo } from './repo'

// A merge commit, so the graph has lanes to draw rather than one straight column.
function repo(extra = 0) {
  const dir = fixture({ 'a.ts': 'alpha\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  git(dir, 'tag', 'v1.0')
  git(dir, 'checkout', '-qb', 'side')
  writeFileSync(join(dir, 'b.ts'), 'beta\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'add beta')
  git(dir, 'checkout', '-q', 'main')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  git(dir, 'commit', '-qam', 'change alpha')
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
  for (let n = 0; n < extra; n++) {
    writeFileSync(join(dir, 'a.ts'), `line ${n}\n`)
    git(dir, 'commit', '-qam', `work ${n}`)
  }
  return dir
}

test('lanes come out as box drawing, one colour per lane', () => {
  const palette = ['red', 'green', 'blue']
  const flat = (graph: string) =>
    laneSpans(graph, palette)
      .map(span => span.text)
      .join('')

  expect(flat('* | |')).toBe('● │ │')
  expect(flat('|\\')).toBe('│╲')
  expect(flat('|/')).toBe('│╱')
  // A diagonal belongs to the lane it reaches for, not the one it leaves.
  expect(laneSpans('|\\', palette).map(span => span.color)).toEqual(['red', 'green'])
  expect(laneSpans('* | |', palette).map(span => span.color)).toEqual(['red', 'green', 'blue'])
})

test('refs are read as the kind of thing they name', () => {
  expect(refChips(['HEAD -> main', 'origin/main', 'origin/HEAD', 'tag: v1.0', 'side'])).toEqual([
    { label: 'main', kind: 'head' },
    { label: 'origin/main', kind: 'remote' },
    { label: 'v1.0', kind: 'tag' },
    { label: 'side', kind: 'local' },
  ])
})

test('a remote becomes the forge URL for a commit', () => {
  const at = (remote: string) => forgeCommitUrl(remote, 'abc123')
  expect(at('git@github.com:letstri/druk.git')).toBe(
    'https://github.com/letstri/druk/commit/abc123',
  )
  expect(at('https://github.com/letstri/druk.git')).toBe(
    'https://github.com/letstri/druk/commit/abc123',
  )
  expect(at('ssh://git@gitlab.com:2222/group/sub/repo.git')).toBe(
    'https://gitlab.com/group/sub/repo/-/commit/abc123',
  )
  expect(at('https://bitbucket.org/team/repo')).toBe(
    'https://bitbucket.org/team/repo/commits/abc123',
  )
  // A self-hosted forge keeps the port its web UI answers on.
  expect(at('https://git.example.com:8443/team/repo.git')).toBe(
    'https://git.example.com:8443/team/repo/commit/abc123',
  )
  expect(at('/srv/repos/bare.git')).toBeNull()
})

test('the graph lists the history with its lanes and branch labels', async () => {
  const t = await launch(repo(), {}, { width: 120 })
  await runCommand(t, 'Commit graph')
  await untilFrame(t, 'merge side')

  const shown = t.captureCharFrame()
  expect(shown).toContain('Commit graph')
  expect(shown).toContain('add beta')
  expect(shown).toContain('change alpha')
  expect(shown).toContain('main')
  expect(shown).toContain('side')
  expect(shown).toContain('v1.0')
  // git's own connector row under the merge, redrawn as box drawing.
  expect(shown).toContain('│╲')
})

test('Enter opens the selected commit, and the cursor skips the connector rows', async () => {
  const t = await launch(repo(), {}, { width: 120 })
  await runCommand(t, 'Commit graph')
  await untilFrame(t, 'merge side')

  // Down twice from the merge: past the connector row onto the second real commit.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'parent')

  const shown = t.captureCharFrame()
  expect(shown).toMatch(/1 files? ·/)
  expect(shown).toContain('beta')
})

test('reading a commit and closing it leaves the graph where it was', async () => {
  const t = await launch(repo(20), {}, { width: 120, height: 24 })
  await runCommand(t, 'Commit graph')
  await untilFrame(t, 'work 19')
  await pressTimes(t, 18, i => i.pressArrow('down'))
  const scrolled = t.captureCharFrame()

  await press(t, i => i.pressEnter())
  await untilFrame(t, 'parent')
  // Ctrl+W closes the commit tab, which puts the graph back on the slot.
  await press(t, i => void i.pressKeys([String.fromCharCode(23)]))
  await untilFrame(t, 'Commit graph ·')

  expect(t.captureCharFrame()).toBe(scrolled)
})

test('o names the forge for the commit under the cursor', async () => {
  const dir = repo()
  git(dir, 'remote', 'add', 'origin', 'git@github.com:letstri/druk.git')
  const t = await launch(dir, {}, { width: 120 })
  await runCommand(t, 'Commit graph')
  await untilFrame(t, 'merge side')

  // The page's own hints are at the top of the slot; the footer carries them too.
  expect(t.captureCharFrame()).toContain('o remote')
  await press(t, i => void i.typeText('o'))

  // `DRUK_BROWSER=off` (test/setup.ts) keeps the desktop out of it; the link is copied instead.
  await untilFrame(t, 'on github.com')
  expect(t.captureCharFrame()).toContain('Copied the link to')
})

test('outside a repository the command says so', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n' }))
  await runCommand(t, 'Commit graph')
  expect(t.captureCharFrame()).toContain('Not a git repository')
})
