import { basename } from 'node:path'

import { createMemo, createSignal, Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import { replaceAll, replaceMatch } from '../core/search'
import type { Match } from '../core/search'
import type { UpdateInfo } from '../core/update'
import { ChoiceModal } from '../ui/ChoiceModal'
import { CommandPalette } from '../ui/CommandPalette'
import { CommitModal } from '../ui/CommitModal'
import type { CommitFile } from '../ui/CommitModal'
import { ConfirmModal } from '../ui/ConfirmModal'
import type { DiffFile } from '../ui/DiffView'
import { FilePicker } from '../ui/FilePicker'
import { HelpOverlay } from '../ui/HelpOverlay'
import { KeyPeek } from '../ui/KeyPeek'
import { PromptModal } from '../ui/PromptModal'
import { SearchPanel } from '../ui/SearchPanel'
import type { SearchScope } from '../ui/SearchPanel'
import { UpdateBanner } from '../ui/UpdateBanner'
import type { Command } from './commands'
import type { AppContext } from './context'
import type { EditorBridge } from './editor'
import type { Git } from './git'
import type { Panes } from './panes'
import type { PromptState } from './prompts'
import type { Confirmation, Conflict } from './types'
import type { Workspace } from './workspace'

/** The transient full-screen surfaces: search, pickers, palette, help, update. */
export function createOverlays(deps: {
  renderer: { getSelection: () => { getSelectedText: () => string } | null }
  promptState: PromptState
  workspace: Workspace
  git: Git
  panes: Panes
  editor: EditorBridge
}) {
  const { renderer, promptState, workspace, git, panes, editor } = deps

  const [help, setHelp] = createSignal(false)
  /** The Opt+/ strip of every key alive in this pane; any next key closes it. */
  const [peek, setPeek] = createSignal(false)
  const [palette, setPalette] = createSignal(false)
  const [picker, setPicker] = createSignal<'files' | 'tabs' | null>(null)
  /** Open search: its scope, and whether the replacement field starts showing. */
  const [search, setSearch] = createSignal<{ scope: SearchScope; replacing?: boolean } | null>(null)
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null)
  /** Open diff view: the changed files it pages through and which one shows. */
  const [diff, setDiff] = createSignal<{ files: DiffFile[]; index: number } | null>(null)

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
        git.commitPick()
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
    // The diff page gives way to anything that lands in a file.
    setDiff(null)
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
    diff,
    setDiff,
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
  const { status, settings, panes, git, workspace, prompts, overlays } = app
  const { say } = status

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
            onConfirm={prompts.confirmPrompt}
            onCancel={() => prompts.setPrompt(null)}
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
                : undefined
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
                : undefined
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
              overlays.setDiff(null)
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
              settings.patchConfig({ skipUpdate: info().latest })
              overlays.setUpdate(null)
            }}
          />
        )}
      </Show>
      <Show when={overlays.peek()}>
        <KeyPeek pane={panes.focus()} vscodeKeys={settings.config.keybindings === 'vscode'} />
      </Show>
      <Show when={overlays.help()}>
        <HelpOverlay vscodeKeys={settings.config.keybindings === 'vscode'} />
      </Show>
    </>
  )
}
