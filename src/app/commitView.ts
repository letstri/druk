import { createSignal } from 'solid-js'

import { comparisonCommitDetail, comparisonFileContent } from '../core/git'
import type { ComparisonCommitDetail, ComparisonContent, ComparisonFile } from '../core/git'
import type { Status } from './status'

export function createCommitView(deps: { status: Status }) {
  const [commit, setCommit] = createSignal<ComparisonCommitDetail | null>(null)
  const [file, setFile] = createSignal<ComparisonFile | null>(null)
  const [content, setContent] = createSignal<ComparisonContent | null>(null)
  const [fileCursor, setFileCursor] = createSignal(0)
  let repoDir: string | null = null
  let generation = 0

  const loadContent = async (target: ComparisonFile, run: number) => {
    if (!repoDir) return
    const loaded = await comparisonFileContent(repoDir, target)
    if (run !== generation) return
    if (!loaded.ok) return deps.status.say(loaded.detail, 'error')
    setContent(loaded.value)
  }

  const open = (repo: string, oid: string) => {
    const run = ++generation
    repoDir = repo
    void (async () => {
      const loaded = await comparisonCommitDetail(repo, oid)
      if (run !== generation) return
      if (!loaded.ok) return deps.status.say(loaded.detail, 'error')
      setCommit(loaded.value)
      setFileCursor(0)
      setContent(null)
      const first = loaded.value.files[0] ?? null
      setFile(first)
      if (first) void loadContent(first, run)
    })()
  }

  const moveFile = (delta: number) => {
    const detail = commit()
    if (!detail) return
    const next = Math.max(0, Math.min(detail.files.length - 1, fileCursor() + delta))
    if (next === fileCursor()) return
    const target = detail.files[next]
    if (!target) return
    const run = ++generation
    setFileCursor(next)
    setFile(target)
    setContent(null)
    void loadContent(target, run)
  }

  const close = () => {
    generation++
    setCommit(null)
    setFile(null)
    setContent(null)
    setFileCursor(0)
  }

  const isOpen = () => commit() !== null

  return { commit, file, content, open, moveFile, close, isOpen }
}

export type CommitView = ReturnType<typeof createCommitView>
