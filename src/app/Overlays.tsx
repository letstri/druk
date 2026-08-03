import { basename } from 'node:path'

import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import type { Branch } from '../core/git'
import { buildQuery, planProjectReplace, replaceAll, replaceMatch } from '../core/search'
import type { Match, SearchOptions } from '../core/search'
import type { UpdateInfo } from '../core/update'
import { BranchPicker } from '../ui/BranchPicker'
import { ChoiceModal } from '../ui/ChoiceModal'
import { CommandPalette } from '../ui/CommandPalette'
import { CommitModal } from '../ui/CommitModal'
import type { CommitFile } from '../ui/CommitModal'
import { CompareFilter } from '../ui/CompareFilter'
import { ConfirmModal } from '../ui/ConfirmModal'
import { FilePicker } from '../ui/FilePicker'
import { HelpOverlay } from '../ui/HelpOverlay'
import { KeyPeek } from '../ui/KeyPeek'
import { PromptModal } from '../ui/PromptModal'
import { MIN_QUERY, SearchPanel } from '../ui/SearchPanel'
import type { SearchScope } from '../ui/SearchPanel'
import { UpdateBanner } from '../ui/UpdateBanner'
import type { Branches } from './branches'
import type { Command } from './commands'
import type { Comparison } from './comparison'
import type { AppContext } from './context'
import type { EditorBridge } from './editor'
import type { Git } from './git'
import type { Panes } from './panes'
import type { PromptState } from './prompts'
import type { Confirmation, Conflict } from './types'
import type { Workspace } from './workspace'

/** The active search toggles, named in the confirm so what runs is what was agreed to. */
const searchFlags = (options: SearchOptions) => {
  const parts = [
    options.caseSensitive && 'case',
    options.wholeWord && 'word',
    options.regex && 'regex',
  ].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/** The transient full-screen surfaces: search, pickers, palette, help, update. */
export function createOverlays(deps: {
  renderer: { getSelection: () => { getSelectedText: () => string } | null }
  promptState: PromptState
  workspace: Workspace
  git: Git
  branches: Branches
  comparison: Comparison
  panes: Panes
  editor: EditorBridge
}) {
  const { renderer, promptState, workspace, git, branches, comparison, panes, editor } = deps

  const [help, setHelp] = createSignal(false)
  /** The Opt+/ strip of every key alive in this pane; any next key closes it. */
  const [peek, setPeek] = createSignal(false)
  const [palette, setPalette] = createSignal(false)
  const [picker, setPicker] = createSignal<'files' | 'tabs' | null>(null)
  /** Open search: its scope, and whether the replacement field starts showing. */
  const [search, setSearch] = createSignal<{ scope: SearchScope; replacing?: boolean } | null>(null)
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null)
  /** The problems list, jumping to a diagnostic on Enter. */
  const [problemsOpen, setProblemsOpen] = createSignal(false)

  /** True while a modal or overlay owns the keyboard. One list, two readers. */
  const overlay = createMemo(
    () =>
      !!(
        promptState.prompt() ||
        palette() ||
        workspace.conflict() ||
        help() ||
        search() ||
        update() ||
        picker() ||
        git.commitPick() ||
        branches.pick() ||
        comparison.basePick() ||
        comparison.filterOpen() ||
        problemsOpen()
      ),
  )

  /**
   * What is selected on screen, for search to open with. One line only: a query
   * spanning a newline matches nothing, so carrying it over would just look broken.
   */
  const selection = () => {
    const text = renderer.getSelection()?.getSelectedText() ?? ''
    return text.includes('\n') ? '' : text
  }

  const jumpTo = (match: Match) => {
    setSearch(null)
    // A page gives way to anything that lands in a file — `openFile` closes it,
    // but a match in the file already open never calls it.
    workspace.setDiff(null)
    workspace.setPage(null)
    if (match.path && match.path !== workspace.activePath()) workspace.openFile(match.path)
    editor.requestGoto(match.line, match.col)
    panes.setFocus('editor')
  }

  return {
    help,
    setHelp,
    peek,
    setPeek,
    palette,
    setPalette,
    picker,
    setPicker,
    search,
    setSearch,
    update,
    setUpdate,
    problemsOpen,
    setProblemsOpen,
    overlay,
    selection,
    jumpTo,
  }
}

export type Overlays = ReturnType<typeof createOverlays>

/** The modal stack: prompts, confirms, search, pickers, palette and banners. */
export function OverlayStack(props: { ctx: AppContext; commands: Accessor<Command[]> }) {
  // ctx is assembled once in App and never replaced, so reading it eagerly is safe.
  const app = props.ctx
  const { status, settings, panes, git, workspace, prompts, overlays, editor, lsp } = app
  const { say } = status

  /** Rows before the cap; the last is capped so ChoiceModal never overflows. */
  const PROBLEM_ROWS_MAX = 50

  /** Every open file's problems flattened for the list, in tab order. */
  const problemRows = createMemo(() => {
    const glyph = { error: '●', warning: '▲', info: '○', hint: '○' }
    const rows: { path: string; line: number; col: number; label: string }[] = []
    for (const path of workspace.tabs()) {
      for (const problem of lsp.problems[path] ?? []) {
        rows.push({
          path,
          line: problem.line,
          col: problem.col,
          label:
            `${basename(path)}:${problem.line + 1}:${problem.col + 1}  ` +
            `${glyph[problem.severity]} ${problem.message.replaceAll(/\s+/g, ' ')}`,
        })
      }
    }
    return rows
  })

  /** ChoiceModal draws every row it is given, so a pathological file is capped. */
  const problemChoices = createMemo(() => {
    const rows = problemRows()
    const shown = rows.slice(0, PROBLEM_ROWS_MAX).map((row, at) => ({
      id: String(at),
      label: row.label,
    }))
    if (rows.length > PROBLEM_ROWS_MAX) {
      shown.push({ id: 'more', label: `…and ${rows.length - PROBLEM_ROWS_MAX} more` })
    }
    return shown
  })

  // The list closes itself when the last problem is fixed while it is up —
  // otherwise `overlay()` would keep the keyboard with a modal no longer there.
  createEffect(() => {
    if (overlays.problemsOpen() && problemRows().length === 0) overlays.setProblemsOpen(false)
  })

  return (
    <>
      <Show when={prompts.promptTitle()}>
        {(title: () => string) => (
          <PromptModal
            title={title()}
            initialValue={prompts.promptValue()}
            onSubmit={prompts.submitPrompt}
            onCancel={() => prompts.setPrompt(null)}
          />
        )}
      </Show>
      <Show when={prompts.confirmation()}>
        {(ask: () => Confirmation) => (
          <ConfirmModal
            title={ask().title}
            verb={ask().verb}
            danger={ask().danger}
            message={ask().message}
            onConfirm={() => {
              const confirmed = prompts.prompt()
              prompts.confirmPrompt()
              // The panel sat suspended under the modal so cancel could return to
              // it; a confirmed replace is the one outcome that is done with it.
              if (confirmed?.kind === 'replaceProject') overlays.setSearch(null)
            }}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={overlays.search()}>
        {(open: () => { scope: SearchScope; replacing?: boolean }) => (
          <SearchPanel
            scope={open().scope}
            rootDir={app.rootDir}
            activePath={workspace.activePath()}
            activeContent={workspace.activeBuffer()?.content ?? ''}
            initialQuery={overlays.selection()}
            replacing={open().replacing}
            buffers={open().scope === 'project' ? workspace.replaceOverlay : undefined}
            suspended={prompts.prompt() !== null}
            onPick={overlays.jumpTo}
            onReplaceOne={
              open().scope === 'file'
                ? (match, replacement) => {
                    const path = workspace.activePath()
                    const buffer = workspace.activeBuffer()
                    if (!path || !buffer) return
                    const next = replaceMatch(buffer.content, match, replacement)
                    // Refused when the line has moved on since the scan — say so rather
                    // than writing the replacement at a drifted offset.
                    if (next === null) return say('That match is gone', 'warn')
                    workspace.applyReplacement(path, next)
                  }
                : (match, replacement) => workspace.applyMatchReplace(match, replacement)
            }
            onReplaceAll={
              open().scope === 'file'
                ? (query, replacement, options) => {
                    const path = workspace.activePath()
                    const buffer = workspace.activeBuffer()
                    if (!path || !buffer) return
                    const next = replaceAll(buffer.content, query, replacement, options)
                    overlays.setSearch(null)
                    if (next === buffer.content) return say('Nothing to replace')
                    workspace.applyReplacement(path, next)
                    say(`Replaced "${query}" in ${basename(path)}`)
                  }
                : (query, replacement, options) => {
                    // The gates get their own messages: an invalid pattern refused as
                    // "nothing to replace" would read as a project with no matches.
                    if (!buildQuery(query, options)) return say('Invalid regex', 'warn')
                    if (query.length < MIN_QUERY) return
                    const { targets, matches } = planProjectReplace(
                      app.rootDir,
                      query,
                      options,
                      workspace.replaceOverlay(),
                    )
                    if (matches === 0) return say('Nothing to replace')
                    prompts.setPrompt({
                      kind: 'replaceProject',
                      query,
                      replacement,
                      options,
                      paths: targets.map(t => t.path),
                      matches,
                      files: targets.length,
                      flags: searchFlags(options),
                    })
                  }
            }
            onClose={() => overlays.setSearch(null)}
          />
        )}
      </Show>
      <Show when={overlays.picker()}>
        {(kind: () => 'files' | 'tabs') => (
          <FilePicker
            rootDir={app.rootDir}
            files={kind() === 'tabs' ? workspace.tabs() : undefined}
            title={kind() === 'tabs' ? 'Switch tab' : 'Open file'}
            onPick={path => {
              overlays.setPicker(null)
              workspace.openFile(path)
            }}
            onClose={() => overlays.setPicker(null)}
          />
        )}
      </Show>
      <Show when={overlays.palette()}>
        <CommandPalette commands={props.commands()} onClose={() => overlays.setPalette(false)} />
      </Show>
      <Show when={git.commitPick()}>
        {(files: () => CommitFile[]) => (
          <CommitModal
            files={files()}
            onSubmit={paths => {
              git.setCommitPick(null)
              prompts.setPrompt({ kind: 'commit', paths })
            }}
            onCancel={() => git.setCommitPick(null)}
          />
        )}
      </Show>
      <Show when={app.branches.pick()}>
        {(open: () => { branches: Branch[] }) => (
          <BranchPicker
            title={app.branches.pickTitle()}
            branches={open().branches}
            onPick={app.branches.choose}
            onClose={() => app.branches.setPick(null)}
          />
        )}
      </Show>
      <Show when={app.comparison.basePick()}>
        {(branches: () => Branch[]) => (
          <BranchPicker
            title="Compare against branch"
            branches={branches()}
            onPick={app.comparison.chooseBase}
            onClose={app.comparison.closeBasePicker}
          />
        )}
      </Show>
      <Show when={app.comparison.filterOpen()}>
        <CompareFilter
          value={app.comparison.filter()}
          onInput={app.comparison.setFilter}
          onClose={app.comparison.closeFilter}
        />
      </Show>
      <Show when={overlays.problemsOpen()}>
        <ChoiceModal
          title="Problems"
          message="Enter jumps to the diagnostic."
          choices={problemChoices()}
          onPick={id => {
            const row = problemRows()[Number(id)]
            overlays.setProblemsOpen(false)
            // The "…and N more" row is a notice, not a destination.
            if (!row || id === 'more') return
            // `openFile` closes the page, but a problem in the open file skips it.
            workspace.setDiff(null)
            workspace.setPage(null)
            if (row.path !== workspace.activePath()) workspace.openFile(row.path)
            editor.requestGoto(row.line, row.col)
            panes.setFocus('editor')
          }}
          onCancel={() => overlays.setProblemsOpen(false)}
        />
      </Show>
      <Show when={workspace.conflict()}>
        {(c: () => Conflict) => (
          <ChoiceModal
            title={c().deleted ? 'File deleted on disk' : 'File changed on disk'}
            message={
              c().deleted
                ? `"${basename(c().path)}" was deleted on disk and has unsaved edits here.`
                : `"${basename(c().path)}" changed on disk and has unsaved edits here.`
            }
            choices={
              c().deleted
                ? [
                    { id: 'overwrite', label: 'Write it back (recreate the file)' },
                    { id: 'cancel', label: 'Cancel (keep editing)' },
                  ]
                : [
                    { id: 'overwrite', label: 'Overwrite (keep my version)' },
                    { id: 'reload', label: 'Reload (discard my changes)' },
                    { id: 'cancel', label: 'Cancel' },
                  ]
            }
            onPick={workspace.resolveConflict}
            onCancel={() => workspace.setConflict(null)}
          />
        )}
      </Show>
      <Show when={overlays.update()}>
        {(info: () => UpdateInfo) => (
          <UpdateBanner
            update={info()}
            onClose={() => overlays.setUpdate(null)}
            onSkip={() => {
              settings.patchUserConfig({ skipUpdate: info().latest })
              overlays.setUpdate(null)
            }}
          />
        )}
      </Show>
      <Show when={overlays.peek()}>
        <KeyPeek pane={panes.keyPane()} />
      </Show>
      <Show when={overlays.help()}>
        <HelpOverlay />
      </Show>
    </>
  )
}
