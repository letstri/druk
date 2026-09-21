import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

export const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir })

// `commit.gpgsign` off: signing globally, the first commit would wait on a passphrase.
export function initRepo(dir: string, branch = 'main'): string {
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

/** A bare origin plus a `clone(name)` that gives each checkout its own identity. */
export function originWithClones(prefix: string) {
  const base = tempDir(prefix)
  const origin = join(base, 'origin.git')
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  const clone = (name: string) => {
    git(base, 'clone', '-q', origin, name)
    const dir = join(base, name)
    git(dir, 'config', 'user.email', `${name}@example.com`)
    git(dir, 'config', 'user.name', name)
    git(dir, 'config', 'commit.gpgsign', 'false')
    return dir
  }
  return { base, clone, origin }
}

/** `a.ts` and `b.ts` committed lowercase, then uppercased in the working tree. */
export function changedRepo(prefix: string): string {
  const dir = initRepo(tempDir(prefix))
  writeFileSync(join(dir, 'a.ts'), 'alpha\n')
  writeFileSync(join(dir, 'b.ts'), 'beta\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')
  return dir
}
