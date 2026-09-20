import { execFileSync } from 'node:child_process'

export const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir })

// `commit.gpgsign` off: signing globally, the first commit would wait on a passphrase.
export function initRepo(dir: string): string {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}
