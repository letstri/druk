import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  currentBranch,
  diffLines,
  explain,
  failureLine,
  ignoredAmongAsync,
  KNOWN,
  statusEntries,
  statusMap,
  unstagePaths,
} from '../src/core/git'
import { THEMES } from '../src/themes'
import { launch, press, settle, until } from './helpers'
import type { Harness } from './helpers'
import { initRepo } from './repo'
import { tempDir } from './temp'

function repo(committed: string) {
  const dir = tempDir('druk-git-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  initRepo(dir)
  writeFileSync(join(dir, 'a.ts'), committed)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('marks modified and added lines', async () => {
  const dir = repo('one\ntwo\nthree\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\nfour\n')

  const marks = await diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified')
  expect(marks.get(3)).toBe('added')
  expect(marks.get(0)).toBeUndefined()
})

test('a hunk that grows marks rewrites and additions separately', async () => {
  const dir = repo('one\ntwo\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nEXTRA\n')

  const marks = await diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified')
  expect(marks.get(2)).toBe('added')
})

test('is empty outside a repository', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'a.ts'), 'x\n')
  const diff = await diffLines(join(dir, 'a.ts'))
  expect(diff.size).toBe(0)
  expect(currentBranch(dir)).toBeNull()
})

test('a branch with no upstream shows without ahead/behind arrows', async () => {
  const t = await launch(repo('one\n'))
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())

  const footer = t.captureCharFrame().split('\n').at(-2)!
  expect(footer).toContain('⎇ main')
  expect(footer).not.toMatch(/↑\d/u)
  expect(footer).not.toMatch(/↓\d/u)
})

test('status marks reach the file tree', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'changed\n')
  writeFileSync(join(dir, 'fresh.ts'), 'new\n')

  const t = await launch(dir)
  const row = (name: string) =>
    t
      .captureCharFrame()
      .split('\n')
      .find((line) => line.includes(name)) ?? ''

  await until(t, () => row('a.ts').includes('M'))
  expect(row('fresh.ts')).toContain('U')
})

test('a folder inherits the status of its contents', async () => {
  const dir = repo('one\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub/deep.ts'), 'new\n')

  const t = await launch(dir)
  const row = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find((line) => line.includes('sub')) ?? ''
  await until(t, () => row().includes('U'))
})

test('a path git has to quote still gets its mark', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'ümlaut.ts'), 'new\n')
  writeFileSync(join(dir, 'two words.ts'), 'new\n')

  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'ümlaut.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'two words.ts'))).toBe('untracked')
})

test('a rename is keyed by the path that exists on disk', () => {
  const dir = repo('one\n')
  execFileSync('git', ['mv', 'a.ts', 'renamed.ts'], { cwd: dir })

  // `-z` emits `R  new\0old\0`: the second field must be skipped, not read as an entry.
  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'renamed.ts'))).toBe('modified')
  expect(statuses.has(join(dir, 'a.ts'))).toBe(false)
})

test('every file inside a brand-new directory is marked, not just the directory', async () => {
  const dir = repo('one\n')
  mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
  writeFileSync(join(dir, 'newdir', 'a.ts'), 'const a = 1\n')
  writeFileSync(join(dir, 'newdir', 'sub', 'b.ts'), 'const b = 2\n')

  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'newdir', 'a.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'newdir', 'sub', 'b.ts'))).toBe('untracked')

  const t = await launch(dir)
  await press(t, (i) => i.pressArrow('down'))
  await press(t, (i) => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).toContain('newdir')
  expect(frame).toContain('a.ts')
  expect(frame.split('\n').find((row) => row.includes('a.ts'))).toContain('U')
})

test('a failed git command reports its cause, not its advice', () => {
  const diverged = [
    "hint: Diverging branches can't be fast-forwarded, you need to either:",
    'hint:',
    'hint: \tgit merge --no-ff',
    'hint:',
    'hint: or:',
    'hint:',
    'hint: \tgit rebase',
    'hint:',
    'hint: Disable this message with "git config set advice.diverging false"',
    'fatal: Not possible to fast-forward, aborting.',
  ].join('\n')
  expect(failureLine(diverged)).toBe('Not possible to fast-forward, aborting.')

  const rejected = [
    'To https://github.com/user/repo',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/user/repo'",
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n')
  expect(failureLine(rejected)).toBe(
    '! [rejected]        main -> main (non-fast-forward)'
  )

  expect(failureLine('hint: only advice here\n')).toBe('hint: only advice here')
  expect(failureLine('')).toBe('')

  expect(failureLine("error: pathspec 'nope' did not match")).toBe(
    "pathspec 'nope' did not match"
  )
})

// Every string below is verbatim git output: a paraphrase passes while the real message does not.
test('known git failures are named in terms of what to do next', () => {
  const cases: [string, string][] = [
    [
      'fatal: Not possible to fast-forward, aborting.',
      'Branch and origin have both moved on — merge or rebase in a terminal',
    ],
    [
      'fatal: Need to specify how to reconcile divergent branches.',
      'Branch and origin have both moved on — merge or rebase in a terminal',
    ],
    [
      'To https://github.com/user/repo\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs',
      "origin has commits you don't — pull first, then push",
    ],
    [
      'error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\nPlease commit your changes or stash them before you merge.\nAborting',
      'Commit or stash your changes first — this would overwrite them',
    ],
    [
      'Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\nThe stash entry is kept in case you need it again.',
      'Conflicts in the working tree — the stash was kept, resolve them first',
    ],
    [
      'error: Pulling is not possible because you have unmerged files.\nfatal: Exiting because of an unresolved conflict.',
      'Resolve the merge conflicts in your working tree first',
    ],
    [
      'On branch master\nnothing to commit, working tree clean',
      'Nothing to commit',
    ],
    [
      "fatal: ambiguous argument 'HEAD~1': unknown revision or path not in the working tree.",
      'Nothing to undo — this is the only commit',
    ],
    ['No stash entries found.', 'No stash to pop'],
    [
      'fatal: No configured push destination.',
      "No remote — add an 'origin' in a terminal",
    ],
    [
      "fatal: unable to access 'https://x.invalid/y.git/': Could not resolve host: x.invalid",
      "Can't reach the remote — check your network",
    ],
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "No stored credentials for the remote — druk can't prompt for them",
    ],
    [
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      'The remote rejected your SSH key',
    ],
    [
      "remote: HTTP Basic: Access denied.\nfatal: Authentication failed for 'https://gitlab.com/x/y.git/'",
      'Authentication failed — check your credentials for the remote',
    ],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found",
      "Remote repository not found — check the 'origin' URL",
    ],
    [
      "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository",
      'Another git process is running in this repository — let it finish',
    ],
  ]
  for (const [output, message] of cases) {
    expect([output, explain(output)]).toEqual([output, message])
  }

  expect(explain("error: pathspec 'nope' did not match any file(s)")).toBe(
    "pathspec 'nope' did not match any file(s)"
  )
})

test('a message never outgrows the status bar', () => {
  for (const [, message] of KNOWN) {
    expect(message.length).toBeLessThanOrEqual(70)
  }
})

test('a failure split across both streams is still recognised', () => {
  const stderr = 'error: could not write index'
  const stdout =
    'f.txt: needs merge\nThe stash entry is kept in case you need it again.'
  expect(explain(stderr, stdout)).toBe(
    'Resolve the merge conflicts in your working tree first'
  )
  expect(explain(stderr)).toBe('could not write index')
})

test('ignoredAmong reports only the gitignored paths asked about', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'dist\n*.log\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'out.js'), 'bundle\n')
  writeFileSync(join(dir, 'noise.log'), 'log\n')
  writeFileSync(join(dir, 'keep.ts'), 'ok\n')

  const paths = [
    join(dir, 'dist'),
    join(dir, 'dist', 'out.js'),
    join(dir, 'noise.log'),
    join(dir, 'keep.ts'),
    join(dir, 'a.ts'),
  ]
  const ignored = await ignoredAmongAsync(dir, paths)
  expect(ignored.has(join(dir, 'dist'))).toBe(true)
  expect(ignored.has(join(dir, 'dist', 'out.js'))).toBe(true)
  expect(ignored.has(join(dir, 'noise.log'))).toBe(true)
  expect(ignored.has(join(dir, 'keep.ts'))).toBe(false)
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

test('one path beyond a symlink does not blank the whole answer', async () => {
  // `check-ignore` aborts the whole batch with 128 at a path through a symlinked directory.
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  mkdirSync(join(dir, 'node_modules', '@scope'), { recursive: true })
  mkdirSync(join(dir, 'pkg'))
  writeFileSync(join(dir, 'pkg', 'index.js'), 'x\n')
  symlinkSync(join(dir, 'pkg'), join(dir, 'node_modules', '@scope', 'pkg'))

  const ignored = await ignoredAmongAsync(dir, [
    join(dir, 'node_modules'),
    join(dir, 'node_modules', '@scope'),
    join(dir, 'node_modules', '@scope', 'pkg'),
    join(dir, 'node_modules', '@scope', 'pkg', 'index.js'),
    join(dir, 'a.ts'),
  ])
  expect(ignored.has(join(dir, 'node_modules'))).toBe(true)
  expect(ignored.has(join(dir, 'node_modules', '@scope'))).toBe(true)
  expect(
    ignored.has(join(dir, 'node_modules', '@scope', 'pkg', 'index.js'))
  ).toBe(true)
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

test('ignoredAmong is empty outside a repository', async () => {
  // `check-ignore` exits 128 outside a repository, which has to read as "nothing is ignored".
  const dir = tempDir()
  writeFileSync(join(dir, 'a.ts'), 'x\n')
  const ignored = await ignoredAmongAsync(dir, [join(dir, 'a.ts')])
  expect(ignored.size).toBe(0)
})

test('a tracked file is never ignored, whatever .gitignore says about it', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), '*.ts\n')
  const ignored = await ignoredAmongAsync(dir, [
    join(dir, 'a.ts'),
    join(dir, '.gitignore'),
  ])
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

function nameColor(t: Harness, name: string) {
  const capture = t.captureSpans() as unknown as {
    lines: {
      spans: { text: string; fg?: { buffer: Record<string, number> } }[]
    }[]
  }
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (!span.fg || !span.text.endsWith(name)) {
        continue
      }
      return `${span.fg.buffer['0']},${span.fg.buffer['1']},${span.fg.buffer['2']}`
    }
  }
  return null
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(',')
}

test('a gitignored entry is dimmed, and a tracked one beside it is not', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'dist\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'out.js'), 'bundle\n')

  const t = await launch(dir)
  await settle(t)
  const { ui } = THEMES.dark
  expect(nameColor(t, 'dist')).toBe(hexToRgb(ui.dim))
  expect(nameColor(t, 'a.ts')).toBe(hexToRgb(ui.text))
})

test('a status mark outranks dimming, and ignoring never invents one', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'dist\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'out.js'), 'bundle\n')
  writeFileSync(join(dir, 'a.ts'), 'changed\n')

  const t = await launch(dir)
  await settle(t)
  const frame = t.captureCharFrame()
  expect(frame).toContain('dist')
  expect(frame.split('\n').find((row) => /\bdist\b/u.test(row))!).not.toMatch(
    /[UMAD]/u
  )
  expect(frame.split('\n').find((row) => row.includes('a.ts'))).toContain('M')
  expect(nameColor(t, 'a.ts')).toBe(hexToRgb(THEMES.dark.ui.gitModified))
})

test('with respectGitignore on there is nothing left to dim', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'dist\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'out.js'), 'bundle\n')

  const t = await launch(dir, { respectGitignore: true })
  await settle(t)
  expect(t.captureCharFrame()).not.toContain('dist')
  expect(nameColor(t, 'a.ts')).toBe(hexToRgb(THEMES.dark.ui.text))
})

test('a typechange is a modification, not an invisible file', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'link-me'), 'target\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'add link-me'], { cwd: dir })
  execFileSync('git', ['rm', '-q', 'link-me'], { cwd: dir })
  symlinkSync('a.ts', join(dir, 'link-me'))
  execFileSync('git', ['add', '.'], { cwd: dir })

  expect(statusMap(dir).get(join(dir, 'link-me'))).toBe('modified')
})

test('unstaging a staged rename takes its old name out of the index too', async () => {
  const dir = repo('one\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('mv', 'a.ts', 'b.ts')
  git('add', '-A')

  const result = await unstagePaths(dir, ['b.ts'])
  expect(result.ok).toBe(true)
  expect(statusEntries(dir).get(join(dir, 'a.ts'))?.staged ?? null).toBeNull()
  expect(statusEntries(dir).get(join(dir, 'b.ts'))?.staged ?? null).toBeNull()
})
