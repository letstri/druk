import { expect, test } from 'bun:test'
import { renameSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, runCommand, untilFrame } from './helpers'
import { git, initRepo } from './repo'

test('a working-tree rename diffs against its old name', async () => {
  const dir = fixture({ 'a.ts': 'alpha\nbeta\n' })
  initRepo(dir)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  renameSync(join(dir, 'a.ts'), join(dir, 'b.ts'))
  git(dir, 'add', '-A')

  const t = await launch(dir, {}, { width: 120 })
  await runCommand(t, 'Show all changes')
  await untilFrame(t, 'b.ts')
  const shown = t.captureCharFrame()
  expect(shown).toContain('a.ts → b.ts')
  expect(shown).not.toContain('+alpha')
})
