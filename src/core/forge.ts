/**
 * Pull-request comments, from whichever forge the repository is actually on.
 *
 * The remote URL is the only thing druk has to go on, so it is what decides:
 * `git@gitlab.example.com:team/app.git` is a GitLab merge request and
 * `https://codeberg.org/user/app` a Forgejo pull request, and both answer the
 * same three questions a review needs — which change is open for this branch,
 * what people said on it, and where each remark sits in the diff.
 *
 * Four API dialects, one shape out (`ForgeComment`). A host nobody can place
 * from its name is not guessed at: `reviewForge` says which of the four it
 * speaks, because a self-hosted GitLab and a self-hosted Gitea look identical
 * from the outside and asking the wrong one produces nonsense rather than an
 * error.
 *
 * Everything here is read-only. druk posts no comment, approves nothing and
 * never writes to a forge — the export is a clipboard block, and that is
 * deliberately the only way anything leaves the editor.
 */

export type ForgeKind = 'github' | 'gitlab' | 'gitea' | 'bitbucket'

export const FORGE_KINDS: readonly ForgeKind[] = ['github', 'gitlab', 'gitea', 'bitbucket']

/** What `reviewForge` may say: one of the four, or "read it off the remote". */
export type ForgeSetting = 'auto' | ForgeKind

export interface ForgeTarget {
  kind: ForgeKind
  /** Host as the remote spells it, port included where the remote had one. */
  host: string
  /** Everything before the repository name — a GitLab subgroup path lives here. */
  owner: string
  repo: string
  /** Base of the REST API, without a trailing slash. */
  api: string
}

/** One change open for review, whatever the forge calls it. */
export interface PullRequest {
  /** The number a person would quote: GitHub's number, GitLab's iid. */
  number: number
  title: string
  author: string
  url: string
}

/**
 * One remark, as the panel and the export see it. `line` is 0-based like every
 * other line number in druk — the forges all count from 1 and are converted
 * here, so nothing downstream has to remember which.
 */
export interface ForgeComment {
  author: string
  body: string
  /** Repository-relative path, or null for a comment on the change as a whole. */
  path: string | null
  line: number | null
  url: string
  /** The diff it was written against has moved on; the line is a best guess. */
  outdated: boolean
}

export type ForgeResult<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): ForgeResult<never> => ({ ok: false, error })

/** Longer than the startup checks: someone asked for this and is waiting on it. */
const TIMEOUT_MS = 10_000

/** A busy pull request is tens of kilobytes of JSON; this is room for a pathological one. */
const MAX_BYTES = 8 * 1024 * 1024

/** One page is what druk asks for — what it left out is reported, never dropped quietly. */
export const PAGE_SIZE = 100

/** `fetch`, narrowed to what this module uses so a test can pass a stub. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/** Environment variables holding a token, most specific first. */
const TOKEN_ENV: Record<ForgeKind, string[]> = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
  gitlab: ['GITLAB_TOKEN', 'GL_TOKEN'],
  gitea: ['GITEA_TOKEN', 'FORGEJO_TOKEN'],
  bitbucket: ['BITBUCKET_TOKEN'],
}

/**
 * The token for `kind`, from the environment. `DRUK_FORGE_TOKEN` covers the
 * host whose own variable druk cannot guess; a public repository needs none of
 * them, which is why an absent token is not an error here.
 */
export function tokenFor(kind: ForgeKind, env: Record<string, string | undefined> = process.env) {
  for (const name of [...TOKEN_ENV[kind], 'DRUK_FORGE_TOKEN']) {
    const value = env[name]
    if (value) return value
  }
  return null
}

/** Each forge spells authentication its own way; none of them accepts another's. */
function headers(kind: ForgeKind, token: string | null): Record<string, string> {
  const head: Record<string, string> = { accept: 'application/json' }
  if (kind === 'github') head.accept = 'application/vnd.github+json'
  if (!token) return head
  if (kind === 'gitlab') head['PRIVATE-TOKEN'] = token
  else if (kind === 'gitea') head.authorization = `token ${token}`
  else head.authorization = `Bearer ${token}`
  return head
}

/** Host and path of a remote, whichever of git's four spellings it is written in. */
function parseRemote(url: string): { host: string; path: string; https: boolean } | null {
  const trimmed = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  if (!trimmed) return null

  // scp-like: `git@host:owner/repo`. Not a URL, and the colon before the path is
  // what tells it from `ssh://host:port/…`, where the colon precedes digits.
  const scp = /^[^/@]+@([^/:]+):(.+)$/.exec(trimmed)
  if (scp) return { host: scp[1]!, path: scp[2]!.replace(/^\/+/, ''), https: false }

  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/^\/+/, '')
    if (!path) return null
    const https = parsed.protocol === 'https:' || parsed.protocol === 'http:'
    // An ssh port is not the web port, so it is dropped along with the scheme.
    return { host: https ? parsed.host : parsed.hostname, path, https }
  } catch {
    return null
  }
}

/** Which forge a host is, by name alone. Null when the name says nothing. */
function kindForHost(host: string): ForgeKind | null {
  const name = host.toLowerCase()
  if (name === 'github.com' || name.startsWith('github.')) return 'github'
  if (name === 'bitbucket.org') return 'bitbucket'
  if (name === 'codeberg.org' || name.includes('forgejo') || name.includes('gitea')) return 'gitea'
  if (name === 'gitlab.com' || name.includes('gitlab')) return 'gitlab'
  return null
}

function apiBase(kind: ForgeKind, host: string): string | null {
  // https whatever the remote was: an ssh remote carries no web scheme, and no
  // forge worth asking serves its API over plaintext.
  const origin = `https://${host}`
  switch (kind) {
    case 'github':
      // Enterprise serves the same API under /api/v3; github.com does not.
      return host.toLowerCase() === 'github.com' ? 'https://api.github.com' : `${origin}/api/v3`
    case 'gitlab':
      return `${origin}/api/v4`
    case 'gitea':
      return `${origin}/api/v1`
    case 'bitbucket':
      // Bitbucket Server (self-hosted) speaks an entirely different API, so it is
      // refused rather than asked something it cannot answer.
      return host.toLowerCase() === 'bitbucket.org' ? 'https://api.bitbucket.org/2.0' : null
  }
}

/**
 * The forge a remote URL points at. `setting` is `reviewForge`: on `auto` the
 * host name decides, and a host it cannot place is an error naming the setting
 * — a self-hosted GitLab and a self-hosted Gitea are indistinguishable from
 * here, and guessing would mean asking one of them the other's questions.
 */
export function forgeFor(url: string, setting: ForgeSetting = 'auto'): ForgeResult<ForgeTarget> {
  const remote = parseRemote(url)
  if (!remote) return fail(`Cannot read the remote URL "${url}"`)
  const kind = setting === 'auto' ? kindForHost(remote.host) : setting
  if (!kind) {
    return fail(`${remote.host} is not a forge druk knows — set "reviewForge" to name it`)
  }
  const segments = remote.path.split('/').filter(Boolean)
  if (segments.length < 2) return fail(`The remote "${url}" names no repository`)
  const repo = segments.at(-1)!
  const owner = segments.slice(0, -1).join('/')
  const api = apiBase(kind, remote.host)
  if (!api) return fail(`${remote.host} is Bitbucket Server, whose API druk does not speak`)
  return { ok: true, value: { kind, host: remote.host, owner, repo, api } }
}

/** GitLab addresses a project by its URL-encoded path, subgroups and all. */
const projectId = (target: ForgeTarget) => encodeURIComponent(`${target.owner}/${target.repo}`)

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const str = (raw: unknown): string => (typeof raw === 'string' ? raw : '')
const num = (raw: unknown): number | null => (typeof raw === 'number' ? raw : null)

async function get(
  url: string,
  target: ForgeTarget,
  options: { fetcher?: Fetcher; token?: string | null },
): Promise<ForgeResult<unknown>> {
  const fetcher = options.fetcher ?? fetch
  const token = options.token === undefined ? tokenFor(target.kind) : options.token
  let res: Response
  try {
    res = await fetcher(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: headers(target.kind, token),
    })
  } catch {
    return fail(`Could not reach ${target.host}`)
  }
  if (res.status === 401 || res.status === 403) {
    return fail(
      token
        ? `${target.host} refused the token in ${TOKEN_ENV[target.kind][0]}`
        : `${target.host} wants a token — set ${TOKEN_ENV[target.kind][0]}`,
    )
  }
  if (res.status === 404) return fail(`${target.owner}/${target.repo} is not there, or is private`)
  if (!res.ok) return fail(`${target.host} answered ${res.status}`)
  let text: string
  try {
    text = await res.text()
  } catch {
    return fail(`${target.host} sent an unreadable answer`)
  }
  if (text.length > MAX_BYTES) return fail(`${target.host} sent more than druk will read`)
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return fail(`${target.host} sent something that is not JSON`)
  }
}

const list = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw) ? raw.filter(isRecord) : []

/** Bitbucket and GitLab both paginate as `{values: […]}` / a bare array. */
const values = (raw: unknown): Record<string, unknown>[] =>
  isRecord(raw) && Array.isArray(raw.values) ? raw.values.filter(isRecord) : list(raw)

interface Query {
  fetcher?: Fetcher
  token?: string | null
}

/** The open pull request whose source branch is `branch`, or null when none is. */
export async function findPullRequest(
  target: ForgeTarget,
  branch: string,
  query: Query = {},
): Promise<ForgeResult<PullRequest | null>> {
  const { api } = target
  const path = `${target.owner}/${target.repo}`
  const url =
    target.kind === 'gitlab'
      ? `${api}/projects/${projectId(target)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`
      : target.kind === 'bitbucket'
        ? `${api}/repositories/${path}/pullrequests?state=OPEN&pagelen=${PAGE_SIZE}&q=${encodeURIComponent(`source.branch.name="${branch}"`)}`
        : `${api}/repos/${path}/pulls?state=open&${target.kind === 'gitea' ? 'limit' : 'per_page'}=${PAGE_SIZE}`

  const answer = await get(url, target, query)
  if (!answer.ok) return answer

  for (const entry of values(answer.value)) {
    const found = asPullRequest(target.kind, entry, branch)
    if (found) return { ok: true, value: found }
  }
  return { ok: true, value: null }
}

/** One list entry as a pull request, or null when it is for another branch. */
function asPullRequest(
  kind: ForgeKind,
  raw: Record<string, unknown>,
  branch: string,
): PullRequest | null {
  if (kind === 'gitlab') {
    // Already filtered by source_branch, but a server that ignores the filter
    // would otherwise hand back somebody else's merge request.
    if (str(raw.source_branch) !== branch) return null
    const author = isRecord(raw.author) ? str(raw.author.username) : ''
    const iid = num(raw.iid)
    return iid === null
      ? null
      : { number: iid, title: str(raw.title), author, url: str(raw.web_url) }
  }
  if (kind === 'bitbucket') {
    const source = isRecord(raw.source) && isRecord(raw.source.branch) ? raw.source.branch : null
    if (!source || str(source.name) !== branch) return null
    const id = num(raw.id)
    const author = isRecord(raw.author)
      ? str(raw.author.display_name) || str(raw.author.nickname)
      : ''
    const href = isRecord(raw.links) && isRecord(raw.links.html) ? str(raw.links.html.href) : ''
    return id === null ? null : { number: id, title: str(raw.title), author, url: href }
  }
  // GitHub and Gitea agree on this shape, fork branches included: `head.ref` is
  // the branch name on whichever repository the change comes from.
  const head = isRecord(raw.head) ? raw.head : null
  if (!head || str(head.ref) !== branch) return null
  const number = num(raw.number)
  const user = isRecord(raw.user) ? str(raw.user.login) : ''
  return number === null
    ? null
    : { number, title: str(raw.title), author: user, url: str(raw.html_url) }
}

/**
 * Every remark on `pr`: the ones anchored to a line of the diff, and the ones
 * on the change as a whole. Both matter to a review — the second is where the
 * "please split this" comments live — so they come back in one list, told apart
 * by whether `path` is set.
 */
export async function fetchComments(
  target: ForgeTarget,
  pr: PullRequest,
  query: Query = {},
): Promise<ForgeResult<ForgeComment[]>> {
  switch (target.kind) {
    case 'github':
      return githubComments(target, pr, query)
    case 'gitlab':
      return gitlabComments(target, pr, query)
    case 'gitea':
      return giteaComments(target, pr, query)
    case 'bitbucket':
      return bitbucketComments(target, pr, query)
  }
}

/** 1-based as every forge reports it, 0-based as druk counts lines. */
const zeroBased = (line: number | null): number | null =>
  line === null || line < 1 ? null : line - 1

async function githubComments(
  target: ForgeTarget,
  pr: PullRequest,
  query: Query,
): Promise<ForgeResult<ForgeComment[]>> {
  const base = `${target.api}/repos/${target.owner}/${target.repo}`
  const page = `per_page=${PAGE_SIZE}`
  const [inline, issue, reviews] = await Promise.all([
    get(`${base}/pulls/${pr.number}/comments?${page}`, target, query),
    get(`${base}/issues/${pr.number}/comments?${page}`, target, query),
    get(`${base}/pulls/${pr.number}/reviews?${page}`, target, query),
  ])
  // One failure is the whole read: a review missing half its comments is worse
  // than one that says it could not be read.
  if (!inline.ok) return inline
  if (!issue.ok) return issue
  if (!reviews.ok) return reviews

  const out: ForgeComment[] = []
  for (const raw of list(inline.value)) {
    out.push({
      author: isRecord(raw.user) ? str(raw.user.login) : '',
      body: str(raw.body),
      path: str(raw.path) || null,
      // `line` is null once the comment's diff hunk is gone; the original line
      // is where it was written, which is the honest fallback.
      line: zeroBased(num(raw.line) ?? num(raw.original_line)),
      url: str(raw.html_url),
      outdated: num(raw.line) === null,
    })
  }
  for (const raw of list(issue.value)) {
    out.push({
      author: isRecord(raw.user) ? str(raw.user.login) : '',
      body: str(raw.body),
      path: null,
      line: null,
      url: str(raw.html_url),
      outdated: false,
    })
  }
  for (const raw of list(reviews.value)) {
    // A review with no body is an approval or the envelope around inline
    // comments already collected above — nothing to read.
    if (!str(raw.body)) continue
    out.push({
      author: isRecord(raw.user) ? str(raw.user.login) : '',
      body: str(raw.body),
      path: null,
      line: null,
      url: str(raw.html_url),
      outdated: false,
    })
  }
  return { ok: true, value: out }
}

async function gitlabComments(
  target: ForgeTarget,
  pr: PullRequest,
  query: Query,
): Promise<ForgeResult<ForgeComment[]>> {
  const url = `${target.api}/projects/${projectId(target)}/merge_requests/${pr.number}/notes?per_page=${PAGE_SIZE}`
  const answer = await get(url, target, query)
  if (!answer.ok) return answer
  const out: ForgeComment[] = []
  for (const raw of values(answer.value)) {
    // Every branch push, label and assignment is a note too; they are the bulk
    // of a busy merge request and none of them is feedback.
    if (raw.system === true) continue
    const position = isRecord(raw.position) ? raw.position : null
    const newLine = position ? num(position.new_line) : null
    const oldLine = position ? num(position.old_line) : null
    out.push({
      author: isRecord(raw.author) ? str(raw.author.username) : '',
      body: str(raw.body),
      path: position ? str(position.new_path) || str(position.old_path) || null : null,
      line: zeroBased(newLine ?? oldLine),
      url: `${pr.url}#note_${num(raw.id) ?? ''}`,
      outdated: newLine === null && oldLine !== null,
    })
  }
  return { ok: true, value: out }
}

/**
 * Gitea and Forgejo keep a review's comments behind the review that holds them,
 * so this is the one dialect that needs a request per review. The cap is what
 * keeps a long-running pull request from becoming fifty round trips.
 */
const MAX_REVIEWS = 20

async function giteaComments(
  target: ForgeTarget,
  pr: PullRequest,
  query: Query,
): Promise<ForgeResult<ForgeComment[]>> {
  const base = `${target.api}/repos/${target.owner}/${target.repo}`
  const [issue, reviews] = await Promise.all([
    get(`${base}/issues/${pr.number}/comments?limit=${PAGE_SIZE}`, target, query),
    get(`${base}/pulls/${pr.number}/reviews?limit=${PAGE_SIZE}`, target, query),
  ])
  if (!issue.ok) return issue
  if (!reviews.ok) return reviews

  const out: ForgeComment[] = []
  for (const raw of list(issue.value)) {
    out.push({
      author: isRecord(raw.user) ? str(raw.user.login) : '',
      body: str(raw.body),
      path: null,
      line: null,
      url: str(raw.html_url),
      outdated: false,
    })
  }
  const reviewList = list(reviews.value).slice(0, MAX_REVIEWS)
  for (const review of reviewList) {
    const id = num(review.id)
    const author = isRecord(review.user) ? str(review.user.login) : ''
    if (str(review.body)) {
      out.push({
        author,
        body: str(review.body),
        path: null,
        line: null,
        url: str(review.html_url),
        outdated: false,
      })
    }
    if (id === null || num(review.comments_count) === 0) continue
    const answer = await get(`${base}/pulls/${pr.number}/reviews/${id}/comments`, target, query)
    if (!answer.ok) return answer
    for (const raw of list(answer.value)) {
      out.push({
        author: isRecord(raw.user) ? str(raw.user.login) : author,
        body: str(raw.body),
        path: str(raw.path) || null,
        line: zeroBased(num(raw.original_line) ?? num(raw.line)),
        url: str(raw.html_url),
        outdated: false,
      })
    }
  }
  return { ok: true, value: out }
}

async function bitbucketComments(
  target: ForgeTarget,
  pr: PullRequest,
  query: Query,
): Promise<ForgeResult<ForgeComment[]>> {
  const url = `${target.api}/repositories/${target.owner}/${target.repo}/pullrequests/${pr.number}/comments?pagelen=${PAGE_SIZE}`
  const answer = await get(url, target, query)
  if (!answer.ok) return answer
  const out: ForgeComment[] = []
  for (const raw of values(answer.value)) {
    if (raw.deleted === true) continue
    const inline = isRecord(raw.inline) ? raw.inline : null
    const content = isRecord(raw.content) ? str(raw.content.raw) : ''
    const user = isRecord(raw.user) ? str(raw.user.display_name) || str(raw.user.nickname) : ''
    const href = isRecord(raw.links) && isRecord(raw.links.html) ? str(raw.links.html.href) : ''
    // `to` is the line in the new file, `from` the old one — a comment carrying
    // only `from` is on a line the change removed.
    const to = inline ? num(inline.to) : null
    const from = inline ? num(inline.from) : null
    out.push({
      author: user,
      body: content,
      path: inline ? str(inline.path) || null : null,
      line: zeroBased(to ?? from),
      url: href,
      outdated: to === null && from !== null,
    })
  }
  return { ok: true, value: out }
}
