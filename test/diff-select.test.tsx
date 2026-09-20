import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Harness } from './helpers'
import { launch, openDiff, openFile, settle, untilFrame } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

function repo(files: Record<string, string>) {
  const dir = tempDir('druk-diffsel-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

/** The renderer's own selection — what a drag over any pane but the editor produces. */
function selected(t: Harness): string {
  const renderer = t.renderer as unknown as {
    getSelection: () => { getSelectedText: () => string } | null
  }
  return renderer.getSelection()?.getSelectedText() ?? ''
}

async function openChangedDiff() {
  const dir = repo({ 'a.ts': 'alpha\nbravo\ncharlie\n' })
  writeFileSync(join(dir, 'a.ts'), 'alpha\nDELTA\ncharlie\n')
  const t = await launch(dir, {}, { width: 100, height: 30 })
  await openDiff(t)
  await untilFrame(t, 'DELTA')
  return t
}

test('text in a diff can be selected with the mouse', async () => {
  const t = await openChangedDiff()
  const rows = t.captureCharFrame().split('\n')
  const row = rows.findIndex(line => line.includes('DELTA'))
  const from = rows[row]!.indexOf('DELTA')

  await t.mockMouse.drag(from, row, from + 5, row)
  await settle(t)
  expect(selected(t)).toContain('DELTA')
})

test('a drag over the file tree still selects nothing', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  const t = await launch(dir, {}, { width: 100, height: 30 })
  // Through the picker, so the tree stays on screen and the editor mounts behind it.
  await openFile(t, 'a.ts')
  await untilFrame(t, 'alpha')
  const rows = t.captureCharFrame().split('\n')
  // The tree's own row, under the header; the tab strip carries the name too.
  const row = rows.findIndex((line, at) => at > 1 && line.trimStart().startsWith('a.ts'))
  const from = rows[row]!.indexOf('a.ts')

  await t.mockMouse.drag(from, row, from + 3, row)
  await settle(t)
  expect(selected(t)).toBe('')
})
