import { basename } from 'node:path'

import type { MouseEvent } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'

import type { Config } from '../core/config'
import { watchTree } from '../core/fs'
import { checkForUpdate } from '../core/update'
import { languageLabel } from '../languages'
import { filetypeForPath } from '../languages/highlight'
import { ui } from '../themes'
import { DiffView } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'
import { EditorPane } from '../ui/EditorPane'
import { FileTree } from '../ui/FileTree'
import { StatusBar } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { createCommands } from './actions'
import type { AppContext } from './context'
import { createEditorBridge } from './editor'
import { createFileOps } from './fileOps'
import { createGit, createGitOp, wireGitEffects } from './git'
import { installKeyboard } from './keyboard'
import { createOverlays, OverlayStack } from './Overlays'
import { createPanes } from './panes'
import { createPromptHandlers, createPromptState } from './prompts'
import { createSettings } from './settings'
import { createStatus, READY } from './status'
import { createTree } from './tree'
import { CLASH_CHANGED, CLASH_DELETED, createWorkspace, restoreWorkspace } from './workspace'

/** Rows the divider's grip occupies — long enough to aim at, short enough to be a grip. */
const GRIP = [0, 1, 2, 3, 4]

/**
 * The composition root. Each concern lives in its own controller module; this
 * component creates them in dependency order, hands the assembled context to the
 * keyboard and palette wiring, and renders the layout around them.
 */
export function App(props: {
  rootDir: string
  /** `druk file.ts`: the one file to open, instead of the project's saved session. */
  openFile?: string | null
  /** `druk file.ts:42`: 0-based line to land on in `openFile`. */
  openLine?: number | null
  initialConfig: Config
  /**
   * The startup update check is unconditional for users — this switch exists so
   * the test harness can keep hundreds of launches off the npm registry.
   */
  checkUpdates?: boolean
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const rootDir = props.rootDir
  const single = props.openFile ?? null

  const restored = restoreWorkspace(rootDir, single)

  const status = createStatus()
  const editor = createEditorBridge(props.initialConfig.vim)
  const settings = createSettings({ initial: props.initialConfig, status, editor, dimensions })
  const tree = createTree(rootDir, { expanded: restored.expanded, selected: restored.activePath })
  const panes = createPanes(tree, restored.sidebar)
  const git = createGit(rootDir)
  const promptState = createPromptState()
  const workspace = createWorkspace({
    rootDir,
    single,
    restored,
    settings,
    status,
    tree,
    panes,
    editor,
    git,
    setPrompt: promptState.setPrompt,
  })
  const fileOps = createFileOps({ rootDir, status, tree, workspace })
  const gitOp = createGitOp({ rootDir, git, status, workspace })
  const promptHandlers = createPromptHandlers({
    rootDir,
    renderer,
    state: promptState,
    status,
    tree,
    panes,
    editor,
    workspace,
    fileOps,
    gitOp,
  })
  const overlays = createOverlays({ renderer, promptState, workspace, git, panes, editor })

  const ctx: AppContext = {
    rootDir,
    status,
    settings,
    tree,
    panes,
    editor,
    git,
    gitOp,
    workspace,
    fileOps,
    prompts: { ...promptState, ...promptHandlers },
    overlays,
  }

  wireGitEffects({ rootDir, git, tree, editor, workspace })
  const commands = createCommands(ctx)
  installKeyboard(ctx)

  const { config } = settings
  const { say } = status

  /** True between grabbing the sidebar divider and letting go. */
  const [resizing, setResizing] = createSignal(false)

  onMount(() => {
    // Same refusal `druk file.ts` deserves as opening one from the tree, and for the
    // same reason: an empty editor with a status line under it looks like a bug.
    if (restored.failed) workspace.setNotice({ name: basename(single!), reason: restored.failed })
    const line = props.openLine
    const buffer = workspace.activeBuffer()
    if (line != null && buffer) {
      const total = buffer.content.split('\n').length
      editor.requestGoto(Math.min(line, total - 1), 0)
    }
  })

  onMount(() => {
    if (props.checkUpdates === false) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void (async () => {
      const info = await checkForUpdate()
      if (!cancelled && info && info.latest !== props.initialConfig.skipUpdate) {
        overlays.setUpdate(info)
      }
    })()
  })

  // Focus reporting (DECSET 1004): the terminal sends CSI I / CSI O as the window
  // gains / loses focus. OpenTUI's key parser recognises both and swallows them,
  // so the raw stdin stream is the only place left to see the blur. The mode is
  // enabled only on a real terminal — in tests stdin is a mock and there is no
  // terminal to answer — but the listener is always attached, so a test can drive
  // it by emitting the sequence.
  onMount(() => {
    if (process.stdout.isTTY) process.stdout.write('\x1B[?1004h')
    const onStdin = (chunk: Buffer | string) => {
      if (config.autoSaveOnBlur && chunk.toString().includes('\x1B[O')) {
        workspace.saveDirtyOnBlur()
      }
    }
    renderer.stdin.on('data', onStdin)
    onCleanup(() => {
      renderer.stdin.off('data', onStdin)
      if (process.stdout.isTTY) process.stdout.write('\x1B[?1004l')
    })
  })

  // The watcher has no follow-up message of its own, so unlike the git callers it
  // reports the clash itself — and clears it again once the files agree, since
  // nothing else would ever replace a warning the user has already dealt with.
  onMount(() =>
    onCleanup(
      watchTree(rootDir, changed => {
        // History moved elsewhere: nothing in the working tree need have changed, so
        // this is the only thing that tells the branch and ahead/behind to re-read.
        if (changed.git) git.bump()
        if (!changed.tree) return
        const warning = workspace.clashWarning(workspace.syncFromDisk())
        if (warning) {
          say(warning, 'warn')
        } else if (
          status.status().msg.startsWith(CLASH_CHANGED) ||
          status.status().msg.startsWith(CLASH_DELETED)
        ) {
          say(READY)
        }
      }),
    ),
  )

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={ui.bg}>
      <Tabs
        tabs={workspace.tabs().map(p => ({
          path: p,
          name: basename(p),
          dirty: workspace.buffers[p]?.dirty ?? false,
          preview: p === workspace.previewPath(),
        }))}
        activePath={workspace.activePath()}
        onSelect={p => {
          // A tab picked while the diff covers the editor must show the file, not
          // change what the diff pane happens to sit on top of.
          overlays.setDiff(null)
          workspace.openFile(p)
        }}
        onClose={workspace.closeTab}
        onOverflow={() => overlays.setPicker('tabs')}
      />
      {/* Drag capture lives on the row, not the divider: the pointer leaves a
          one-column target immediately, and each drag event is delivered to
          whatever sits under it. */}
      <box
        flexDirection="row"
        flexGrow={1}
        onMouseDrag={(event: MouseEvent) => {
          if (resizing()) settings.resizeSidebar(event.x)
        }}
        onMouseDragEnd={() => setResizing(false)}
        onMouseUp={() => setResizing(false)}
      >
        <Show when={panes.sidebar()}>
          <FileTree
            rootName={basename(rootDir) || rootDir}
            nodes={tree.nodes()}
            selectedPath={tree.selectedPath()}
            expanded={tree.expanded()}
            focused={panes.focus() === 'tree'}
            width={settings.treeWidth()}
            gitStatus={git.gitStatus()}
            cutPaths={fileOps.cut()}
            markedPaths={tree.marked()}
            onActivate={node => {
              // Landing in a file is how the diff page closes — the tree stays
              // interactive while it is up, like any other editor page.
              overlays.setDiff(null)
              workspace.activateNode(node)
            }}
            onPin={node => workspace.pinTab(node.path)}
            onFocus={() => panes.setFocus('tree')}
          />
          {/* Drag handle: the whole column is the grab target, but only a short
              grip is drawn at its middle — a full-height rule is a heavy line
              down the screen for something you touch once. The spacers centre it
              without anyone having to know the pane's height. `scrollbar` is the
              palette's quiet rule colour, and the accent while dragging says the
              grab took. The sidebar starts at column 0, so the pointer's x is the
              width asked for. */}
          <box
            width={1}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.bg}
            onMouseDown={(event: MouseEvent) => {
              setResizing(true)
              settings.resizeSidebar(event.x)
            }}
          >
            <box flexGrow={1} backgroundColor={ui.bg} />
            <For each={GRIP}>
              {() => <text fg={resizing() ? ui.accent : ui.scrollbar} bg={ui.bg} content="│" />}
            </For>
            <box flexGrow={1} backgroundColor={ui.bg} />
          </box>
        </Show>
        {/* The diff pane sits over the editor's slot only, so the tabs, tree and
            status bar stay put — it reads as a view of the editor, not a modal. */}
        <box flexGrow={1} flexDirection="column">
          <EditorPane
            path={workspace.activePath()}
            content={workspace.activeBuffer()?.content ?? ''}
            filetype={workspace.activePath() ? filetypeForPath(workspace.activePath()!) : undefined}
            // Also unfocused while the diff covers the pane: the terminal's own
            // cursor tracks the focused textarea and is drawn over everything,
            // so a focused editor bleeds a phantom block into the diff.
            focused={panes.focus() === 'editor' && !overlays.diff()}
            theme={config.theme}
            reloadKey={editor.reloadKey()}
            goto={editor.goto()}
            history={editor.history()}
            edit={editor.edit()}
            lineOp={editor.lineOp()}
            vim={config.vim}
            vscodeKeys={config.keybindings === 'vscode'}
            tabSize={config.tabSize}
            gitLines={git.gitLines()}
            notice={workspace.notice()}
            // The diff is a page over this pane, not an overlay — but the hidden
            // textarea must still not eat keys meant for it.
            blocked={overlays.overlay() || overlays.diff() !== null}
            onChange={workspace.onEditorChange}
            onCursor={editor.setCursor}
            onFocus={() => panes.setFocus('editor')}
            onVimMode={editor.setVimMode}
            onQuit={promptHandlers.quit}
          />
          <Show when={overlays.diff()}>
            {(open: () => { files: DiffFile[]; index: number }) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={50}>
                <DiffView
                  files={open().files}
                  index={open().index}
                  mode={config.diffView}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onIndex={index => overlays.setDiff({ files: open().files, index })}
                  onToggleMode={settings.toggleDiffView}
                  onClose={() => overlays.setDiff(null)}
                />
              </box>
            )}
          </Show>
        </box>
      </box>
      <StatusBar
        message={status.status().msg}
        tone={status.status().tone}
        filetype={
          workspace.activePath()
            ? languageLabel(filetypeForPath(workspace.activePath()!) ?? 'plain')
            : undefined
        }
        cursor={workspace.activePath() ? editor.cursor() : undefined}
        dirty={workspace.activeBuffer()?.dirty ?? false}
        vimMode={workspace.activePath() ? editor.vimMode() : null}
        branch={git.branch()}
        ahead={git.upstream()?.ahead ?? 0}
        behind={git.upstream()?.behind ?? 0}
        changed={git.gitStatus().size}
        focus={panes.focus()}
        vscodeKeys={config.keybindings === 'vscode'}
        busy={status.busy()}
      />
      <OverlayStack ctx={ctx} commands={commands} />
    </box>
  )
}
