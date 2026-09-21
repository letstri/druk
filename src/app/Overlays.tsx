import { basename, relative } from 'node:path'

import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import type { Branch } from '../core/git'
import {
  buildQuery,
  planProjectReplace,
  replaceAll,
  replaceMatch,
} from '../core/search'
import type { Match, SearchOptions } from '../core/search'
import type { UpdateInfo } from '../core/update'
import { shortenHome } from '../core/workspaces'
import { SEVERITY_RANK } from '../lsp/protocol'
import { ChoiceModal } from '../ui/ChoiceModal'
import { CommandPalette } from '../ui/CommandPalette'
import { CommitModal } from '../ui/CommitModal'
import type { CommitFile } from '../ui/CommitModal'
import { CompareFilter } from '../ui/CompareFilter'
import { ConfirmModal } from '../ui/ConfirmModal'
import { FilePicker } from '../ui/FilePicker'
import { HelpOverlay } from '../ui/HelpOverlay'
import { KeyPeek } from '../ui/KeyPeek'
import { ListPicker } from '../ui/ListPicker'
import type { PickerItem } from '../ui/ListPicker'
import { ProblemsModal } from '../ui/ProblemsModal'
import type { ProblemEntry } from '../ui/ProblemsModal'
import { PromptModal } from '../ui/PromptModal'
import { MIN_QUERY, SearchPanel } from '../ui/SearchPanel'
import type { SearchMemory, SearchScope } from '../ui/SearchPanel'
import { UpdateBanner } from '../ui/UpdateBanner'
import type { Branches } from './branches'
import type { Command } from './commands'
import type { Comparison } from './comparison'
import type { AppContext } from './context'
import type { EditorBridge } from './editor'
import type { Git } from './git'
import { problemsOn } from './lsp'
import type { Problem } from './lsp'
import type { Panes } from './panes'
import type { PromptState } from './prompts'
import { KIND_CHOICES } from './review'
import type { Confirmation, Conflict, Prompt } from './types'
import type { Workspace } from './workspace'

const branchItem = (branch: Branch): PickerItem => ({
  current: branch.current,
  id: branch.name,
  label: branch.name,
  note: branch.remote ? 'remote' : (branch.upstream ?? ''),
})

const pickBranch = (
  branches: Branch[],
  id: string,
  take: (branch: Branch) => void
) => {
  const branch = branches.find((entry) => entry.name === id)
  if (branch) {
    take(branch)
  }
}

type InstallServerPrompt = Extract<Prompt, { kind: 'installServer' }>
type ReviewKindPrompt = Extract<Prompt, { kind: 'reviewKind' }>
type ActivatePrompt = Extract<Prompt, { kind: 'activateExtension' }>
type StashPickPrompt = Extract<Prompt, { kind: 'stashPick' }>
type StashActionPrompt = Extract<Prompt, { kind: 'stashAction' }>
type TagDeletePrompt = Extract<Prompt, { kind: 'tagDelete' }>
type RemoteRemovePrompt = Extract<Prompt, { kind: 'remoteRemove' }>
type FileHistoryPrompt = Extract<Prompt, { kind: 'fileHistory' }>
type LocationsPrompt = Extract<Prompt, { kind: 'lspLocations' }>
type WorkspacePickPrompt = Extract<Prompt, { kind: 'workspacePick' }>
type WorktreePickPrompt = Extract<Prompt, { kind: 'worktreePick' }>
type ConflictSidePrompt = Extract<Prompt, { kind: 'mergeConflict' }>

type ProblemsScope = 'all' | 'cursor'

const searchFlags = (options: SearchOptions) => {
  const parts = [
    options.caseSensitive && 'case',
    options.wholeWord && 'word',
    options.regex && 'regex',
  ].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

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
  const {
    renderer,
    promptState,
    workspace,
    git,
    branches,
    comparison,
    panes,
    editor,
  } = deps

  const [help, setHelp] = createSignal(false)
  const [peek, setPeek] = createSignal(false)
  const [palette, setPalette] = createSignal(false)
  const [picker, setPicker] = createSignal<'files' | 'tabs' | null>(null)
  const [search, setSearch] = createSignal<{
    scope: SearchScope
    replacing?: boolean
  } | null>(null)
  const [lastSearch, setLastSearch] = createSignal<
    Partial<Record<SearchScope, SearchMemory>>
  >({})
  const rememberSearch = (scope: SearchScope, state: SearchMemory) =>
    setLastSearch((prev) => ({ ...prev, [scope]: state }))
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null)
  const [problemsOpen, setProblemsOpen] = createSignal<ProblemsScope | null>(
    null
  )
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
      )
  )

  // One line only: a query spanning a newline matches nothing.
  const selection = () => {
    const text = renderer.getSelection()?.getSelectedText() ?? ''
    return text.includes('\n') ? '' : text
  }

  // A selection brings back neither row nor folds: an index into another search points at nothing.
  const searchOpensWith = (scope: SearchScope): SearchMemory => {
    const last = lastSearch()[scope]
    const options = last?.options ?? {}
    const selected = selection()
    if (selected) {
      return { folded: [], index: 0, options, query: selected }
    }
    return {
      folded: last?.folded ?? [],
      index: last?.index ?? 0,
      options,
      query: last?.query ?? '',
    }
  }

  const jumpTo = (match: Match) => {
    setSearch(null)
    if (match.path && match.path !== workspace.activePath()) {
      workspace.openFile(match.path)
    }
    editor.requestGoto(match.line, match.col)
    panes.setFocus('editor')
  }

  return {
    help,
    jumpTo,
    lastSearch,
    overlay,
    palette,
    peek,
    picker,
    problemsOpen,
    rememberSearch,
    search,
    searchOpensWith,
    selection,
    setHelp,
    setPalette,
    setPeek,
    setPicker,
    setProblemsOpen,
    setSearch,
    setUpdate,
    update,
  }
}

export type Overlays = ReturnType<typeof createOverlays>

export function OverlayStack(props: {
  ctx: AppContext
  commands: Accessor<Command[]>
}) {
  // ctx is assembled once in App and never replaced, so reading it eagerly is safe.
  const app = props.ctx
  const {
    status,
    settings,
    panes,
    git,
    workspace,
    prompts,
    overlays,
    editor,
    lsp,
  } = app
  const { say } = status

  const entry = (problem: Problem): ProblemEntry => ({
    ...problem,
    rel: relative(app.rootDir, problem.path) || basename(problem.path),
  })

  const problemRows = createMemo<ProblemEntry[]>(() => {
    const path = workspace.activePath()
    if (overlays.problemsOpen() === 'cursor') {
      const list = path ? lsp.problems[path] : undefined
      return (list ? problemsOn(list, editor.cursor().line) : []).map(entry)
    }
    const rows: ProblemEntry[] = []
    for (const tab of workspace.tabs()) {
      for (const problem of lsp.problems[tab] ?? []) {
        rows.push(entry(problem))
      }
    }
    return rows.toSorted(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.rel.localeCompare(b.rel) ||
        a.line - b.line ||
        a.col - b.col
    )
  })

  // Otherwise `overlay()` keeps the keyboard with a modal no longer there.
  createEffect(() => {
    if (overlays.problemsOpen() && problemRows().length === 0) {
      overlays.setProblemsOpen(null)
    }
  })

  const promptOf = <K extends NonNullable<Prompt>['kind']>(kind: K) =>
    createMemo<Extract<Prompt, { kind: K }> | null>(() => {
      const ask = prompts.prompt()
      return ask?.kind === kind ? (ask as Extract<Prompt, { kind: K }>) : null
    })
  const installServer = promptOf('installServer')
  // Only the npm kind offers a choice; the others are a line to print.
  const managerChoice = () => {
    const ask = installServer()
    return ask?.install.kind === 'npm' ? ask : null
  }
  const reviewKind = promptOf('reviewKind')
  const activate = promptOf('activateExtension')
  const activation = () => {
    const ask = activate()
    return ask && ask.choices.length > 1 ? ask : null
  }
  const stashPick = promptOf('stashPick')
  const stashAction = promptOf('stashAction')
  const tagDelete = promptOf('tagDelete')
  const remoteRemove = promptOf('remoteRemove')
  const fileHistory = promptOf('fileHistory')
  const locations = promptOf('lspLocations')
  const workspacePick = promptOf('workspacePick')
  const worktreePick = promptOf('worktreePick')
  const conflictSide = promptOf('mergeConflict')

  return (
    <>
      <Show when={prompts.promptTitle()}>
        {(title: () => string) => (
          <PromptModal
            title={title()}
            initialValue={prompts.promptValue()}
            history={prompts.promptHistory()}
            onSubmit={prompts.submitPrompt}
            onCancel={() => prompts.setPrompt(null)}
          />
        )}
      </Show>
      <Show when={managerChoice()}>
        {(ask: () => InstallServerPrompt) => (
          <ChoiceModal
            title="Language server missing"
            message={`${ask().name} is not installed. Choose a package manager:`}
            choices={ask().managers.map((manager) => ({
              id: manager,
              label: manager,
            }))}
            onPick={prompts.chooseInstallServer}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={reviewKind()}>
        {(ask: () => ReviewKindPrompt) => (
          <ChoiceModal
            title="Review note"
            message={`What kind of remark is this, on ${basename(ask().path)}:${ask().line + 1}?`}
            choices={KIND_CHOICES}
            onPick={prompts.chooseReviewKind}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={conflictSide()}>
        {(ask: () => ConflictSidePrompt) => (
          <ChoiceModal
            title="Merge conflict"
            message={`Which side of the conflict on line ${ask().line + 1} should stay?`}
            choices={[
              {
                id: 'ours',
                label: `Current change${ask().ours ? ` (${ask().ours})` : ''}`,
              },
              {
                id: 'theirs',
                label: `Incoming change${ask().theirs ? ` (${ask().theirs})` : ''}`,
              },
              { id: 'both', label: 'Both changes, current first' },
            ]}
            onPick={prompts.chooseConflictSide}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={activation()}>
        {(ask: () => ActivatePrompt) => (
          <ChoiceModal
            title="Extension installed"
            message={`${ask().name} is installed. Use one of what it adds?${
              ask().more > 0 ? ` ${ask().more} more are in the palette.` : ''
            }`}
            choices={ask().choices}
            onPick={prompts.chooseActivation}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={stashPick()}>
        {(ask: () => StashPickPrompt) => (
          <ListPicker
            title="Stashes"
            placeholder="Type part of a stash message…"
            items={ask().stashes.map((stash) => ({
              id: stash.ref,
              label: `${stash.ref}  ${stash.message}`,
            }))}
            onPick={prompts.chooseStash}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={stashAction()}>
        {(ask: () => StashActionPrompt) => (
          <ChoiceModal
            title={ask().ref}
            message={ask().message}
            choices={[
              { id: 'apply', label: 'Apply — keep the stash' },
              { id: 'pop', label: 'Pop — apply and drop it' },
              { id: 'drop', label: 'Drop — discard its changes' },
            ]}
            onPick={prompts.chooseStashAction}
            onCancel={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={tagDelete()}>
        {(ask: () => TagDeletePrompt) => (
          <ListPicker
            title="Delete tag"
            placeholder="Type part of a tag name…"
            items={ask().tags.map((tag) => ({ id: tag, label: tag }))}
            onPick={prompts.chooseTagDelete}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={remoteRemove()}>
        {(ask: () => RemoteRemovePrompt) => (
          <ListPicker
            title="Remove remote"
            placeholder="Type part of a remote name…"
            items={ask().remotes.map((remote) => ({
              id: remote.name,
              label: `${remote.name}  ${remote.url}`,
            }))}
            onPick={prompts.chooseRemoteRemove}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={workspacePick()}>
        {(ask: () => WorkspacePickPrompt) => (
          <ListPicker
            title="Switch workspace"
            placeholder="Type part of a folder name or path…"
            items={ask().entries.map((candidate) => ({
              id: candidate.path,
              label: [
                candidate.name,
                candidate.current ? '· current' : '',
                candidate.branch ? `⎇ ${candidate.branch}` : '',
                shortenHome(candidate.path),
              ]
                .filter(Boolean)
                .join('  '),
            }))}
            onPick={prompts.chooseWorkspace}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={worktreePick()}>
        {(ask: () => WorktreePickPrompt) => (
          <ListPicker
            title={
              ask().mode === 'switch' ? 'Switch worktree' : 'Remove worktree'
            }
            placeholder="Type part of a branch name or path…"
            items={ask().trees.map((tree) => ({
              id: tree.path,
              label: [tree.branch ?? 'detached', shortenHome(tree.path)].join(
                '  '
              ),
            }))}
            onPick={prompts.chooseWorktree}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={fileHistory()}>
        {(ask: () => FileHistoryPrompt) => (
          <ListPicker
            title="File history"
            placeholder="Type part of a commit subject…"
            items={ask().commits.map((commit) => ({
              id: commit.oid,
              label: `${commit.oid.slice(0, 7)}  ${commit.subject}`,
            }))}
            onPick={prompts.chooseHistoryCommit}
            onClose={prompts.cancelPrompt}
          />
        )}
      </Show>
      <Show when={locations()}>
        {(ask: () => LocationsPrompt) => (
          <ListPicker
            title={ask().title}
            placeholder="Type part of a line…"
            items={ask().hits.map((hit, index) => ({
              id: String(index),
              label: hit.label,
              note: hit.note,
            }))}
            onPick={prompts.chooseLocation}
            onClose={prompts.cancelPrompt}
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
              if (confirmed?.kind === 'replaceProject') {
                overlays.setSearch(null)
              }
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
            initial={overlays.searchOpensWith(open().scope)}
            onSearch={(state) => overlays.rememberSearch(open().scope, state)}
            replacing={open().replacing}
            buffers={
              open().scope === 'project' ? workspace.replaceOverlay : undefined
            }
            suspended={prompts.prompt() !== null}
            onPick={overlays.jumpTo}
            onReplaceOne={
              open().scope === 'file'
                ? (match, replacement) => {
                    const path = workspace.activePath()
                    const buffer = workspace.activeBuffer()
                    if (!path || !buffer) {
                      return
                    }
                    const next = replaceMatch(
                      buffer.content,
                      match,
                      replacement
                    )
                    // Null when the line moved on since the scan: never write at a drifted offset.
                    if (next === null) {
                      return say('That match is gone', 'warn')
                    }
                    workspace.applyReplacement(path, next)
                  }
                : (match, replacement) =>
                    workspace.applyMatchReplace(match, replacement)
            }
            onReplaceAll={
              open().scope === 'file'
                ? (query, replacement, options) => {
                    const path = workspace.activePath()
                    const buffer = workspace.activeBuffer()
                    if (!path || !buffer) {
                      return
                    }
                    const next = replaceAll(
                      buffer.content,
                      query,
                      replacement,
                      options
                    )
                    overlays.setSearch(null)
                    if (next === buffer.content) {
                      return say('Nothing to replace')
                    }
                    workspace.applyReplacement(path, next)
                    say(`Replaced "${query}" in ${basename(path)}`)
                  }
                : (query, replacement, options) => {
                    if (!buildQuery(query, options)) {
                      return say('Invalid regex', 'warn')
                    }
                    if (query.length < MIN_QUERY) {
                      return
                    }
                    const { targets, matches } = planProjectReplace(
                      app.rootDir,
                      query,
                      options,
                      workspace.replaceOverlay()
                    )
                    if (matches === 0) {
                      return say('Nothing to replace')
                    }
                    prompts.setPrompt({
                      files: targets.length,
                      flags: searchFlags(options),
                      kind: 'replaceProject',
                      matches,
                      options,
                      paths: targets.map((t) => t.path),
                      query,
                      replacement,
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
            onPick={(path, position) => {
              overlays.setPicker(null)
              if (position && path === workspace.activeView()) {
                app.navigation.mark()
              }
              workspace.openFile(path)
              // No goto for a file that would not open, or it would aim at the one on screen.
              const lines = workspace.buffers[path]?.content.split('\n').length
              if (position && lines && workspace.activePath() === path) {
                editor.requestGoto(
                  Math.min(position.line, lines - 1),
                  position.col
                )
              }
            }}
            onClose={() => overlays.setPicker(null)}
          />
        )}
      </Show>
      <Show when={overlays.palette()}>
        <CommandPalette
          commands={props.commands()}
          onClose={() => overlays.setPalette(false)}
        />
      </Show>
      <Show when={git.commitPick()}>
        {(files: () => CommitFile[]) => (
          <CommitModal
            files={files()}
            onSubmit={(paths) => {
              git.setCommitPick(null)
              prompts.setPrompt({
                kind: 'commit',
                paths,
                variant: git.commitVariant(),
              })
            }}
            onCancel={() => git.setCommitPick(null)}
          />
        )}
      </Show>
      <Show when={app.branches.pick()}>
        {(open: () => { branches: Branch[] }) => (
          <ListPicker
            title={app.branches.pickTitle()}
            placeholder="Type part of a branch name…"
            items={open().branches.map(branchItem)}
            onPick={(id) =>
              pickBranch(open().branches, id, app.branches.choose)
            }
            onClose={() => app.branches.setPick(null)}
          />
        )}
      </Show>
      <Show when={app.comparison.basePick()}>
        {(branches: () => Branch[]) => (
          <ListPicker
            title="Compare against branch"
            placeholder="Type part of a branch name…"
            items={branches().map(branchItem)}
            onPick={(id) =>
              pickBranch(branches(), id, app.comparison.chooseBase)
            }
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
        <ProblemsModal
          problems={problemRows()}
          title={
            overlays.problemsOpen() === 'cursor'
              ? 'Problem at cursor'
              : 'Problems'
          }
          onPick={(row) => {
            overlays.setProblemsOpen(null)
            if (row.path !== workspace.activePath()) {
              workspace.openFile(row.path)
            }
            editor.requestGoto(row.line, row.col)
            panes.setFocus('editor')
          }}
          onCancel={() => overlays.setProblemsOpen(null)}
        />
      </Show>
      <Show
        when={
          prompts.prompt()?.kind === 'discardChange'
            ? null
            : workspace.conflict()
        }
      >
        {(c: () => Conflict) => (
          <ChoiceModal
            title={
              c().deleted ? 'File deleted on disk' : 'File changed on disk'
            }
            message={
              c().deleted
                ? `"${basename(c().path)}" was deleted on disk and has unsaved edits here.`
                : `"${basename(c().path)}" changed on disk and has unsaved edits here.`
            }
            choices={
              c().deleted
                ? [
                    {
                      id: 'overwrite',
                      label: 'Write it back (recreate the file)',
                    },
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
