import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  currentBranch,
  diffLines,
  explain,
  failureLine,
  ignoredAmong,
  KNOWN,
  statusMap,
} from '../src/core/git'
import { THEMES } from '../src/themes'
import { launch, press, settle, until } from './helpers'
import type { Harness } from './helpers'

/** A real repository with one committed file. */
function repo(committed: string) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  // Local gpgsign=true would fail every fixture commit — no test key is available.
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.ts'), committed)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('marks modified and added lines', async () => {
  const dir = repo('one\ntwo\nthree\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\nfour\n')

  const marks = await diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified') // "two" -> "CHANGED"
  expect(marks.get(3)).toBe('added') // new final line
  expect(marks.get(0)).toBeUndefined() // untouched
})

test('a hunk that grows marks rewrites and additions separately', async () => {
  const dir = repo('one\ntwo\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nEXTRA\n')

  const marks = await diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified')
  expect(marks.get(2)).toBe('added')
})

test('is empty outside a repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  writeFileSync(join(dir, 'a.ts'), 'x\n')
  expect((await diffLines(join(dir, 'a.ts'))).size).toBe(0)
  expect(currentBranch(dir)).toBeNull()
})

// A repo with no remote at all, which the gitremote footer tests cannot cover.
test('a branch with no upstream shows without ahead/behind arrows', async () => {
  const t = await launch(repo('one\n'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  const footer = t.captureCharFrame().split('\n').at(-2)!
  expect(footer).toContain('⎇ main')
  expect(footer).not.toMatch(/↑\d/)
  expect(footer).not.toMatch(/↓\d/)
})

test('status marks reach the file tree', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'changed\n') // modified
  writeFileSync(join(dir, 'fresh.ts'), 'new\n') // untracked

  const t = await launch(dir)
  const row = (name: string) =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes(name)) ?? ''

  // Polled: the status queries are subprocesses off the render thread, so the
  // first frame is drawn before any of them has answered.
  await until(t, () => row('a.ts').includes('M'))
  expect(row('fresh.ts')).toContain('U')
})

test('a folder inherits the status of its contents', async () => {
  const dir = repo('one\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub/deep.ts'), 'new\n')

  // Rendered, not just statusMap()'d: the inheritance lives in FileTree.statusOf,
  // and git reports `?? sub/` on its own, so the map alone proves nothing.
  const t = await launch(dir)
  const row = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('sub')) ?? ''
  await until(t, () => row().includes('U'))
})

test('a path git has to quote still gets its mark', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'ümlaut.ts'), 'new\n')
  writeFileSync(join(dir, 'two words.ts'), 'new\n')

  // `git status --porcelain` C-quotes and octal-escapes both of these names; the
  // keys have to come back as real paths or the tree shows no mark for them.
  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'ümlaut.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'two words.ts'))).toBe('untracked')
})

test('a rename is keyed by the path that exists on disk', () => {
  const dir = repo('one\n')
  execFileSync('git', ['mv', 'a.ts', 'renamed.ts'], { cwd: dir })

  // `-z` emits `R  new\0old\0`, so the second field must be skipped rather than
  // read as its own entry — otherwise the mark lands on the path that is gone.
  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'renamed.ts'))).toBe('modified')
  expect(statuses.has(join(dir, 'a.ts'))).toBe(false)
})

test('every file inside a brand-new directory is marked, not just the directory', async () => {
  // `git status --porcelain` collapses an untracked directory to one `?? dir/`
  // entry, which left every file inside it with no mark at all.
  const dir = repo('one\n')
  mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
  writeFileSync(join(dir, 'newdir', 'a.ts'), 'const a = 1\n')
  writeFileSync(join(dir, 'newdir', 'sub', 'b.ts'), 'const b = 2\n')

  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'newdir', 'a.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'newdir', 'sub', 'b.ts'))).toBe('untracked')

  // And the tree shows the mark on the files, with the folders inheriting it.
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).toContain('newdir')
  expect(frame).toContain('a.ts')
  expect(frame.split('\n').find(row => row.includes('a.ts'))).toContain('U')
})

test('a failed git command reports its cause, not its advice', () => {
  // Verbatim from `git pull` on diverged branches: git prints its advice first
  // and the reason last, so taking the first line showed a truncated hint.
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

  // A rejected push has no `fatal:` at all: the destination header and the
  // trailing hints are noise, and the rejection itself is what to show.
  const rejected = [
    'To https://github.com/user/repo',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/user/repo'",
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n')
  expect(failureLine(rejected)).toBe('! [rejected]        main -> main (non-fast-forward)')

  // Nothing but advice still has to say something rather than go blank.
  expect(failureLine('hint: only advice here\n')).toBe('hint: only advice here')
  expect(failureLine('')).toBe('')

  // An `error:` with no rejection line loses its prefix — the bar colours it.
  expect(failureLine("error: pathspec 'nope' did not match")).toBe("pathspec 'nope' did not match")
})

/**
 * Every string below is verbatim git output, captured by provoking the failure
 * against real repositories — the wording is the whole contract here, and a
 * paraphrase would pass while the real message sailed past unrecognised.
 */
test('known git failures are named in terms of what to do next', () => {
  const cases: Array<[string, string]> = [
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
    ['On branch master\nnothing to commit, working tree clean', 'Nothing to commit'],
    [
      "fatal: ambiguous argument 'HEAD~1': unknown revision or path not in the working tree.",
      'Nothing to undo — this is the only commit',
    ],
    ['No stash entries found.', 'No stash to pop'],
    ['fatal: No configured push destination.', "No remote — add an 'origin' in a terminal"],
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
  for (const [output, message] of cases)
    expect([output, explain(output)]).toEqual([output, message])

  // Anything unrecognised still falls through to git's own most useful line.
  expect(explain("error: pathspec 'nope' did not match any file(s)")).toBe(
    "pathspec 'nope' did not match any file(s)",
  )
})

test('a message never outgrows the status bar', () => {
  // The bar clips with an ellipsis, and these messages exist to be read whole.
  for (const [, message] of KNOWN) expect(message.length).toBeLessThanOrEqual(70)
})

test('a failure split across both streams is still recognised', () => {
  // Verbatim from a second `git stash pop` onto the conflicted tree the first
  // one left. Reading either stream alone reports "could not write index",
  // which names the symptom and not one thing the user can act on.
  const stderr = 'error: could not write index'
  const stdout = 'f.txt: needs merge\nThe stash entry is kept in case you need it again.'
  expect(explain(stderr, stdout)).toBe('Resolve the merge conflicts in your working tree first')
  expect(explain(stderr)).toBe('could not write index')
})

test('ignoredAmong reports only the gitignored paths asked about', () => {
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
  const ignored = ignoredAmong(dir, paths)
  expect(ignored.has(join(dir, 'dist'))).toBe(true)
  expect(ignored.has(join(dir, 'dist', 'out.js'))).toBe(true)
  expect(ignored.has(join(dir, 'noise.log'))).toBe(true)
  expect(ignored.has(join(dir, 'keep.ts'))).toBe(false)
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

test('one path beyond a symlink does not blank the whole answer', () => {
  // `check-ignore` aborts the entire batch with 128 at the first path that reaches
  // through a symlinked directory — pnpm's node_modules/@scope/pkg is one — which
  // used to leave every other row undimmed the moment such a folder was expanded.
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  mkdirSync(join(dir, 'node_modules', '@scope'), { recursive: true })
  mkdirSync(join(dir, 'pkg'))
  writeFileSync(join(dir, 'pkg', 'index.js'), 'x\n')
  symlinkSync(join(dir, 'pkg'), join(dir, 'node_modules', '@scope', 'pkg'))

  const ignored = ignoredAmong(dir, [
    join(dir, 'node_modules'),
    join(dir, 'node_modules', '@scope'),
    join(dir, 'node_modules', '@scope', 'pkg'),
    join(dir, 'node_modules', '@scope', 'pkg', 'index.js'),
    join(dir, 'a.ts'),
  ])
  expect(ignored.has(join(dir, 'node_modules'))).toBe(true)
  expect(ignored.has(join(dir, 'node_modules', '@scope'))).toBe(true)
  // Unanswerable by git, dimmed by its ignored ancestor instead.
  expect(ignored.has(join(dir, 'node_modules', '@scope', 'pkg', 'index.js'))).toBe(true)
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

test('ignoredAmong is empty outside a repository', () => {
  // `check-ignore` exits 128 here rather than reporting nothing, and that has to
  // read as "nothing is ignored" — the tree still draws these rows.
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  writeFileSync(join(dir, 'a.ts'), 'x\n')
  expect(ignoredAmong(dir, [join(dir, 'a.ts')]).size).toBe(0)
})

test('a tracked file is never ignored, whatever .gitignore says about it', () => {
  // `git add -f` on a matching path is common enough (a committed lockfile under
  // a broad rule) that dimming it as ignored would be a plain lie.
  const dir = repo('one\n')
  writeFileSync(join(dir, '.gitignore'), '*.ts\n')
  const ignored = ignoredAmong(dir, [join(dir, 'a.ts'), join(dir, '.gitignore')])
  expect(ignored.has(join(dir, 'a.ts'))).toBe(false)
})

/**
 * The colour the tree draws `name` in, as "r,g,b" — dimming is only a colour, so
 * `captureCharFrame` cannot see it at all.
 *
 * Matched on the end of the span, not the whole of it: neighbouring runs that
 * share a colour are captured as one span, and a dimmed folder is exactly the
 * case where the arrow ahead of the name already uses `ui.dim`.
 */
function nameColor(t: Harness, name: string) {
  const capture = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Record<string, number> } }[] }[]
  }
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (!span.fg || !span.text.endsWith(name)) continue
      return `${span.fg.buffer['0']},${span.fg.buffer['1']},${span.fg.buffer['2']}`
    }
  }
  return null
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16)).join(',')
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
  // Not the folder colour it would have had, and not the faint of a cut row.
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
  // Ignored is drawn, not hidden: hiding is `respectGitignore`, a separate setting.
  expect(frame).toContain('dist')
  expect(frame.split('\n').find(row => /\bdist\b/.test(row))!).not.toMatch(/[UMAD]/)
  expect(frame.split('\n').find(row => row.includes('a.ts'))).toContain('M')
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
