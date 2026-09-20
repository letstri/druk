import { basename, dirname } from 'node:path'

import type { BorderSides, MouseEvent } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'

import { watchAppearance } from '../core/appearance'
import { loadProjectConfig, resolveConfig } from '../core/config'
import type { Config } from '../core/config'
import { watchGitRefs, watchTree } from '../core/fs'
import { isImagePath } from '../core/image'
import { hasPathAt } from '../core/imports'
import { isMarkdownPath } from '../core/markdown'
import { reportProgress } from '../core/progress'
import { watchNotes } from '../core/review'
import { formatTitle, restoreTerminalTitle, setTerminalTitle } from '../core/title'
import { checkForUpdate, currentVersion } from '../core/update'
import { extensionProblems } from '../extensions'
import { iconFor } from '../icons'
import { languageLabel } from '../languages'
import { filetypeForPath } from '../languages/highlight'
import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'
import { servers as serverSpecs } from '../lsp/servers'
import { ui } from '../themes'
import { ChangesView } from '../ui/ChangesView'
import { ComparePanel } from '../ui/ComparePanel'
import { ComparisonView } from '../ui/ComparisonView'
import { EditorPane } from '../ui/EditorPane'
import { ExtensionsPanel } from '../ui/ExtensionsPanel'
import { FileTree } from '../ui/FileTree'
import { GitPanel } from '../ui/GitPanel'
import { useHover } from '../ui/hover'
import { ImageView } from '../ui/ImageView'
import { LspStatusView } from '../ui/LspStatusView'
import { MarkdownView } from '../ui/MarkdownView'
import { PreviewPane } from '../ui/PreviewPane'
import { ReviewPanel } from '../ui/ReviewPanel'
import { copyOnSelect } from '../ui/selection'
import { SettingsView } from '../ui/SettingsView'
import { SidebarTabs } from '../ui/SidebarTabs'
import { StatusBar } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { setTooltipsEnabled, useTooltipPeek } from '../ui/tooltip'
import { TooltipLayer } from '../ui/TooltipLayer'
import { createCommands } from './actions'
import { createBranches } from './branches'
import { rowSlotKey } from './changeSections'
import { createCommitView } from './commitView'
import { createComparison } from './comparison'
import type { AppContext } from './context'
import { createEditorBridge } from './editor'
import { createExtensionsPanel } from './extensionsPanel'
import { createFileOps } from './fileOps'
import { createGit, createGitOp, wireGitEffects } from './git'
import { installKeyboard } from './keyboard'
import { createLsp, wireLspEffects } from './lsp'
import { createMarket } from './market'
import { createNavigation } from './navigation'
import { createOverlays, OverlayStack } from './Overlays'
import { createPanes } from './panes'
import { createPreview } from './preview'
import type { PreviewTarget } from './preview'
import { createPromptHandlers, createPromptState } from './prompts'
import { createReview } from './review'
import { createSettings } from './settings'
import { createStatus, READY } from './status'
import { createTree, hiddenNodes } from './tree'
import {
  CLASH_CHANGED,
  CLASH_DELETED,
  createWorkspace,
  PAGE_TITLES,
  pageKindOf,
  restoreWorkspace,
} from './workspace'
import { createWorkspaces } from './workspaces'

// The grip is one column wide: a left border lands on that column whichever side it is on.
const BORDER_LEFT: BorderSides[] = ['left']

const GRIP_MIN = 3
const GRIP_MAX = 9

export function App(props: {
  rootDir: string
  openFile?: string | null
  // 0-based line to land on in `openFile`.
  openLine?: number | null
  // 0-based column to land on, beside `openLine`.
  openCol?: number | null
  initialConfig: Config
  initialProject?: Partial<Config>
  checkUpdates?: boolean
  onOpenWorkspace?: (dir: string) => void
  notice?: string | null
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const rootDir = props.rootDir
  const projectName = basename(rootDir) || rootDir
  const single = props.openFile ?? null

  const restored = restoreWorkspace(rootDir, single)

  const status = createStatus()
  copyOnSelect(status.say)
  // First, so a restore's warning is the later, louder message.
  if (props.notice) status.say(props.notice)
  const project = props.initialProject ?? loadProjectConfig(rootDir)
  const initial = resolveConfig(props.initialConfig, project)
  const editor = createEditorBridge(initial.vim)
  const settings = createSettings({
    user: props.initialConfig,
    project,
    rootDir,
    status,
    editor,
    dimensions,
  })
  const tree = createTree(
    rootDir,
    { expanded: restored.expanded, selected: restored.activePath },
    () => hiddenNodes(rootDir, settings.config),
  )
  const panes = createPanes(tree, restored.sidebar)
  const preview = createPreview({ tree, panes })
  const git = createGit(
    rootDir,
    () => settings.config.gitPanelView,
    () => panes.view() === 'git',
  )
  const comparison = createComparison({ rootDir, git, status })
  const promptState = createPromptState()
  const lsp = createLsp({ rootDir, settings, status, prompts: promptState })
  const market = createMarket({
    rootDir,
    settings,
    status,
    prompts: promptState,
    onServersReload: lsp.restart,
  })

  lsp.onMissingServer(market.suggestForFiletype)
  onCleanup(lsp.dispose)
  onCleanup(() => reportProgress({ kind: 'off' }))
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
  const extensionsPanel = createExtensionsPanel({
    settings,
    market,
    status,
    lsp,
    prompts: promptState,
  })
  const navigation = createNavigation({ workspace, editor, panes, status })
  const fileOps = createFileOps({ rootDir, status, tree, workspace, renderer })
  const gitOp = createGitOp({ git, status, workspace })
  const workspaces = createWorkspaces({
    rootDir,
    status,
    git,
    gitOp,
    workspace,
    setPrompt: promptState.setPrompt,
    open: props.onOpenWorkspace,
  })
  const branches = createBranches({ status, git, gitOp, prompts: promptState })
  const commitView = createCommitView({ status })
  workspace.onPageClose('commit', commitView.close)
  workspace.onPageClose('compare', comparison.closeDetail)
  createEffect(
    on(commitView.isOpen, open =>
      open ? workspace.openPage('commit') : workspace.closePage('commit'),
    ),
  )
  createEffect(
    on(comparison.detailOpen, open =>
      open ? workspace.openPage('compare') : workspace.closePage('compare'),
    ),
  )
  const review = createReview({ rootDir, status, workspace })
  const promptHandlers = createPromptHandlers({
    renderer,
    state: promptState,
    status,
    tree,
    panes,
    editor,
    workspace,
    fileOps,
    git,
    gitOp,
    commitView,
    branches,
    lsp,
    market,
    review,
    workspaces,
  })
  const overlays = createOverlays({
    renderer,
    promptState,
    workspace,
    git,
    branches,
    comparison,
    panes,
    editor,
  })

  const activeImage = () => {
    const path = workspace.activePath()
    return path && isImagePath(path) ? path : null
  }

  // EditorPane's `focused` and `blocked` and keyboard.ts's Ctrl+C owner must all agree with this.
  const editorCovered = () =>
    workspace.page() !== null ||
    activeImage() !== null ||
    workspace.renderedPath() !== null ||
    preview.target() !== null

  const ctx: AppContext = {
    rootDir,
    editorCovered,
    status,
    settings,
    tree,
    panes,
    preview,
    editor,
    git,
    gitOp,
    lsp,
    market,
    extensions: extensionsPanel,
    review,
    branches,
    commitView,
    comparison,
    workspace,
    workspaces,
    navigation,
    fileOps,
    prompts: { ...promptState, ...promptHandlers },
    overlays,
  }

  const repoName = createMemo(() => {
    const active = git.activeRepo()
    return git.repos().length > 1 && active ? basename(active) : null
  })

  wireGitEffects({ rootDir, git, tree, editor, workspace, config: settings.config })
  wireLspEffects({ lsp, settings, workspace })
  const { commands, actions } = createCommands(ctx)
  const keyboard = installKeyboard(ctx, actions)

  // After the keymap, so the peek never sees an unresolved chord.
  useTooltipPeek()
  createEffect(() => setTooltipsEnabled(settings.config.tooltips))

  // The false branch restores the shell's own title rather than simply skipping.
  createEffect(() => {
    if (!settings.config.terminalTitle) return restoreTerminalTitle()
    const path = workspace.activePath()
    setTerminalTitle(formatTitle(projectName, path, Boolean(workspace.activeBuffer()?.dirty)))
  })
  onCleanup(() => restoreTerminalTitle())

  // `statusEntries` is the async fill `revision` only starts: without it the page rebuilds stale.
  createEffect(
    on(
      () => [git.revision(), editor.reloadKey(), git.diffBase(), git.statusEntries()] as const,
      () => {
        actions.refreshChanges()
        comparison.refresh()
      },
    ),
  )

  // Only on the way in: resting on a heading is how a whole group is staged.
  createEffect(
    on(
      () => [panes.view(), git.rows().some(row => row.kind === 'file')] as const,
      ([view, hasFile], previous) => {
        if (view !== 'git' || !hasFile) return
        const opened = previous?.[0] !== 'git'
        if (opened || (!previous?.[1] && git.gitCursor() === 0)) actions.gitLandOnFile()
      },
      { defer: true },
    ),
  )

  const { config } = settings
  const { say } = status

  const [resizing, setResizing] = createSignal(false)
  const grip = useHover()

  const gripHeight = () =>
    Math.max(GRIP_MIN, Math.min(GRIP_MAX, Math.round((dimensions().height - 2) / 5)))

  // On the left the pointer's x is the width; on the right the sidebar follows the divider at x.
  const sidebarWidthFromPointer = (x: number) =>
    config.sidebarPosition === 'right' ? dimensions().width - x - 1 : x

  // The editor's column: every page drawn over its slot is sized from this.
  const slotWidth = () => dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)

  const slotHeight = () => dimensions().height - 2

  const startResize = (event: MouseEvent) => {
    setResizing(true)
    settings.resizeSidebar(sidebarWidthFromPointer(event.x))
  }

  const problemLines = createMemo(() => {
    const lines = new Map<number, { severity: ProblemSeverity; message: string }>()
    const path = workspace.activePath()
    if (!path) return lines
    for (const problem of lsp.problems[path] ?? []) {
      const held = lines.get(problem.line)
      if (!held || SEVERITY_RANK[problem.severity] < SEVERITY_RANK[held.severity]) {
        lines.set(problem.line, { severity: problem.severity, message: problem.message })
      }
    }
    return lines
  })

  const problemRanges = createMemo(() => {
    const path = workspace.activePath()
    return (path ? lsp.problems[path] : undefined) ?? []
  })

  const tabSeverity = (path: string): 'error' | 'warning' | null => {
    let worst: 'warning' | null = null
    for (const problem of lsp.problems[path] ?? []) {
      if (problem.severity === 'error') return 'error'
      if (problem.severity === 'warning') worst = 'warning'
    }
    return worst
  }

  const pathUnderCursor = createMemo(() => {
    const path = workspace.activePath()
    if (!path || activeImage() || workspace.renderedPath()) return false
    const at = editor.cursor()
    const line = workspace.buffers[path]?.content.split('\n')[at.line]
    return line !== undefined && hasPathAt(line, at.col)
  })

  const problemCounts = createMemo(() => {
    const path = workspace.activePath()
    let errors = 0
    let warnings = 0
    for (const problem of (path ? lsp.problems[path] : undefined) ?? []) {
      if (problem.severity === 'error') errors++
      else if (problem.severity === 'warning') warnings++
    }
    return { errors, warnings }
  })

  const serverList = createMemo(() =>
    Object.values(lsp.servers).toSorted((a, b) => a.id.localeCompare(b.id)),
  )

  // Keyed on the view, not the path: a page over the editor slot has nothing to render.
  const markdownTab = () => {
    const view = workspace.activeView()
    if (!view || !isMarkdownPath(view)) return null
    return { rendered: view === workspace.renderedPath() }
  }

  const closeComparisonDetail = () => {
    comparison.closeDetail()
    panes.focusTree()
  }

  onMount(() => {
    const { invalid, conflicts } = settings.keymap()
    const bad = invalid[0]
    const clash = conflicts.find(entry => entry.rejected)
    const badExtension = extensionProblems()[0]
    const unknownServer = Object.keys(settings.config.lspServers).find(
      id => !serverSpecs().some(spec => spec.id === id),
    )
    if (bad) say(`Shortcut "${bad.value}" for ${bad.label}: ${bad.reason}`, 'warn')
    else if (clash) {
      say(
        `${clash.key} is bound twice — ${clash.winner} keeps it, ${clash.loser} has no key`,
        'warn',
      )
    } else if (badExtension) {
      say(`Extension ${basename(dirname(badExtension.source))}: ${badExtension.reason}`, 'warn')
    } else if (unknownServer) {
      say(`lspServers: no installed extension brings a server "${unknownServer}"`, 'warn')
    }
    if (restored.failed) workspace.setNotice({ name: basename(single!), reason: restored.failed })
    const line = props.openLine
    const buffer = workspace.activeBuffer()
    if (line != null && buffer) {
      const lines = buffer.content.split('\n')
      const row = Math.min(line, lines.length - 1)
      editor.requestGoto(row, Math.min(props.openCol ?? 0, lines[row]!.length))
    }
  })

  // Polling, not a subscription: no OS offers one portably.
  createEffect(
    on(
      () => config.themeSync,
      sync => {
        if (!sync) return
        onCleanup(watchAppearance(settings.applyAppearance))
      },
    ),
  )

  onMount(() => {
    if (props.checkUpdates === false) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void (async () => {
      const info = await checkForUpdate()
      if (!cancelled && info && info.latest !== initial.skipUpdate) {
        overlays.setUpdate(info)
      }
    })()
    void market.check()
  })

  // Deliberately not gated on `extensionUpdates`, which silences druk's own offers.
  createEffect(
    on(
      () => panes.sidebar() && panes.view() === 'extensions',
      showing => {
        if (showing) void market.openPanel()
      },
    ),
  )

  // The count, not the view: a note another writer adds under an open panel changes no view.
  createEffect(
    on(
      () => (panes.sidebar() && panes.view() === 'review' ? review.count() : -1),
      count => {
        if (count > 0 && panes.focus() === 'tree') actions.reviewShow()
      },
    ),
  )

  // OpenTUI's key parser swallows CSI I / CSI O, so raw stdin is the only place to see a blur.
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

  createEffect(
    on(git.repos, repos => {
      const stops = repos
        .filter(repo => repo !== rootDir)
        .map(repo => watchGitRefs(repo, () => git.bump()))
      onCleanup(() => {
        for (const stop of stops) stop()
      })
    }),
  )

  onMount(() => onCleanup(watchNotes(review.reloadNotes)))

  onMount(() =>
    onCleanup(
      watchTree(rootDir, changed => {
        if (changed.git) git.bump()
        // No server watches its own node_modules — see `dependenciesChanged`.
        if (changed.deps) lsp.dependenciesChanged()
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
      {/* Drag capture is on the row, not the divider: the pointer leaves a one-column target at once. */}
      <box
        flexDirection={config.sidebarPosition === 'right' ? 'row-reverse' : 'row'}
        flexGrow={1}
        onMouseDrag={(event: MouseEvent) => {
          if (resizing()) settings.resizeSidebar(sidebarWidthFromPointer(event.x))
        }}
        onMouseDragEnd={() => setResizing(false)}
        onMouseUp={() => setResizing(false)}
      >
        <Show when={panes.sidebar()}>
          <box
            width={settings.treeWidth()}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.sidebarBg}
          >
            <SidebarTabs
              view={panes.view()}
              focused={panes.focus() === 'tree'}
              width={settings.treeWidth()}
              reviewCount={review.count()}
              onSelect={view => panes.showView(view)}
            />
            <Show when={panes.view() === 'extensions'}>
              <ExtensionsPanel
                rows={extensionsPanel.rows()}
                cursor={extensionsPanel.cursor()}
                installedCount={extensionsPanel.installedCount()}
                query={extensionsPanel.query()}
                focused={panes.focus() === 'tree'}
                width={settings.treeWidth()}
                onFocus={() => panes.setFocus('tree')}
                onSearch={extensionsPanel.search}
                onOpenSearch={extensionsPanel.openSearch}
                onActivate={extensionsPanel.activate}
              />
            </Show>
            <Show when={panes.view() === 'review'}>
              <ReviewPanel
                rows={review.rows()}
                cursor={review.cursor()}
                count={review.count()}
                focused={panes.focus() === 'tree'}
                width={settings.treeWidth()}
                onFocus={() => panes.setFocus('tree')}
                onActivate={actions.reviewActivate}
                onCollapseAll={actions.reviewCollapseAll}
              />
            </Show>
            <Show when={panes.view() === 'files'}>
              <FileTree
                rootName={projectName}
                nodes={tree.nodes()}
                selectedPath={tree.selectedPath()}
                expanded={tree.expanded()}
                focused={panes.focus() === 'tree'}
                width={settings.treeWidth()}
                gitStatus={git.gitStatus()}
                gitIgnored={git.gitIgnored()}
                cutPaths={fileOps.cut()}
                markedPaths={tree.marked()}
                iconTheme={settings.activeIconTheme()}
                onActivate={node => {
                  // Leaving preview on would put it back over the file on the way to the tree.
                  preview.close()
                  workspace.activateNode(node)
                }}
                onPin={node => workspace.pinTab(node.path)}
                onFocus={() => panes.setFocus('tree')}
                onCollapseAll={tree.collapseAll}
                onSwitchWorkspace={workspaces.pick}
              />
            </Show>
            <Show when={panes.view() === 'git'}>
              <Show
                when={comparison.active()}
                fallback={
                  <GitPanel
                    repo={repoName()}
                    branch={git.branch()}
                    ahead={git.upstream()?.ahead ?? 0}
                    behind={git.upstream()?.behind ?? 0}
                    rows={git.rows()}
                    base={git.diffBase()}
                    staging={git.staging()}
                    cursor={git.gitCursor()}
                    focused={panes.focus() === 'tree'}
                    width={settings.treeWidth()}
                    inRepo={git.inRepo()}
                    iconTheme={settings.activeIconTheme()}
                    commitMessage={git.commitMessage()}
                    messageEditing={git.messageEditing()}
                    hasMessageHistory={git.messageHistory().length > 0}
                    hasUpstream={git.upstream()?.name != null}
                    onFocus={() => panes.setFocus('tree')}
                    onActivate={actions.gitActivateRow}
                    onCollapseAll={actions.gitCollapseAll}
                    onToggleStage={actions.gitToggleStage}
                    onMessageFocus={actions.gitFocusMessage}
                    onMessageInput={git.typeMessage}
                    onCommit={actions.gitCommitBox}
                    onSync={actions.gitSync}
                  />
                }
              >
                <ComparePanel
                  state={comparison.state()}
                  comparison={comparison.result()}
                  files={comparison.filteredFiles()}
                  commits={comparison.filteredCommits()}
                  mode={comparison.mode()}
                  cursor={
                    comparison.mode() === 'files'
                      ? comparison.fileCursor()
                      : comparison.commitCursor()
                  }
                  focused={panes.focus() === 'tree'}
                  width={settings.treeWidth()}
                  error={comparison.error()}
                  onFocus={() => panes.setFocus('tree')}
                  onActivate={index => {
                    if (comparison.mode() === 'files') {
                      comparison.move(index - comparison.fileCursor())
                    } else {
                      comparison.move(index - comparison.commitCursor())
                    }
                    comparison.openSelection()
                  }}
                />
              </Show>
            </Show>
          </box>
          {/* Painted in `bg`, not `panelBg`: the resize tests find the edge where panel colour stops. */}
          <box
            width={1}
            flexShrink={0}
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            backgroundColor={ui.bg}
            onMouseDown={startResize}
            onMouseOver={grip.enter}
            onMouseOut={grip.leave}
          >
            <box
              width={1}
              height={gripHeight()}
              flexShrink={0}
              backgroundColor={ui.bg}
              border={BORDER_LEFT}
              borderColor={resizing() ? ui.accent : grip.hovered() ? ui.dim : ui.border}
              onMouseDown={startResize}
            />
          </box>
        </Show>
        <box flexGrow={1} flexDirection="column">
          <Tabs
            width={slotWidth()}
            tabs={workspace.views().map(id => {
              const kind = pageKindOf(id)
              return {
                id,
                name: kind
                  ? PAGE_TITLES[kind]
                  : id === workspace.renderedPath()
                    ? `¶ ${basename(id)}`
                    : basename(id),
                dirty: workspace.buffers[id]?.dirty ?? false,
                preview: id === workspace.previewPath(),
                severity: kind ? null : tabSeverity(id),
                icon:
                  config.tabIcons && !kind && id !== workspace.renderedPath()
                    ? iconFor(settings.activeIconTheme(), { name: basename(id), isDir: false })
                    : null,
              }
            })}
            activeId={workspace.activeView()}
            canBack={navigation.canBack()}
            canForward={navigation.canForward()}
            onSelect={workspace.showView}
            onClose={workspace.closeView}
            onBack={navigation.back}
            onForward={navigation.forward}
            onOverflow={() => overlays.setPicker('tabs')}
            markdown={markdownTab()}
            onToggleMarkdown={workspace.toggleRendered}
          />
          <box flexGrow={1} flexDirection="column">
            <EditorPane
              path={workspace.activePath()}
              content={workspace.activeBuffer()?.content ?? ''}
              rootName={projectName}
              branch={git.branch()}
              version={currentVersion()}
              filetype={
                workspace.activePath() ? filetypeForPath(workspace.activePath()!) : undefined
              }
              // The terminal's cursor tracks the focused textarea over everything, bleeding into a page.
              focused={panes.focus() === 'editor' && !editorCovered()}
              reloadKey={editor.reloadKey()}
              goto={editor.goto()}
              history={editor.history()}
              edit={editor.edit()}
              lineOp={editor.lineOp()}
              lineHome={editor.lineHome()}
              foldOp={editor.foldOp()}
              vim={config.vim}
              cursorStyle={config.cursorStyle}
              wrap={config.wrap}
              scrollPastEnd={config.scrollPastEnd}
              tabSize={config.tabSize}
              gitLines={git.gitLines()}
              problems={problemLines()}
              problemRanges={problemRanges()}
              problemText={config.lspInline}
              conflicts={workspace.mergeConflicts()}
              reviews={review.marks()}
              reviewText={config.reviewInline}
              reviewCard={panes.sidebar() && panes.view() === 'review' ? review.card() : null}
              complete={
                config.lsp && config.lspCompletion
                  ? (line, col) => {
                      const path = workspace.activePath()
                      return path ? lsp.complete(path, line, col) : Promise.resolve(null)
                    }
                  : null
              }
              resolveCompletion={
                config.lsp && config.lspCompletion
                  ? item => {
                      const path = workspace.activePath()
                      return path ? lsp.resolveCompletion(path, item) : Promise.resolve(null)
                    }
                  : null
              }
              completionRequest={editor.completion()}
              onCompletionMenu={editor.setCompletionOpen}
              notice={workspace.notice()}
              blocked={overlays.overlay() || editorCovered()}
              onChange={workspace.onEditorChange}
              onCursor={editor.setCursor}
              onSelection={editor.setSelection}
              onFocus={() => panes.setFocus('editor')}
              onVimMode={editor.setVimMode}
              onStatus={status.say}
              onQuit={promptHandlers.quit}
            />
            <Show when={activeImage()}>
              {(path: () => string) => (
                <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                  <ImageView
                    path={path()}
                    width={slotWidth()}
                    height={slotHeight()}
                    blocked={overlays.overlay()}
                    onFocus={() => panes.setFocus('editor')}
                  />
                </box>
              )}
            </Show>
            <Show when={workspace.renderedPath()}>
              {(path: () => string) => (
                <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                  <MarkdownView
                    path={path()}
                    name={basename(path())}
                    content={workspace.buffers[path()]?.content ?? ''}
                    width={slotWidth()}
                    focused={panes.focus() === 'editor'}
                    blocked={overlays.overlay()}
                    onFocus={() => panes.setFocus('editor')}
                    onShowSource={workspace.toggleRendered}
                  />
                </box>
              )}
            </Show>
            <Show when={workspace.page() === 'settings'}>
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
                <SettingsView
                  rows={settings.rows()}
                  scope={settings.scope()}
                  onToggleScope={settings.toggleScope}
                  configFile={settings.configFile()}
                  width={slotWidth()}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onClose={() => workspace.closePage()}
                />
              </box>
            </Show>
            <Show when={workspace.page() === 'lspStatus'}>
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
                <LspStatusView
                  servers={serverList()}
                  width={slotWidth()}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onRestart={actions.restartLsp}
                  onUninstall={actions.uninstallServer}
                  onClose={() => workspace.closePage()}
                />
              </box>
            </Show>
            <Show when={workspace.page() === 'allChanges'}>
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
                <ChangesView
                  sections={actions.allChanges()}
                  meta={actions.allChangesMeta()}
                  focusKey={rowSlotKey(git.cursorRow())}
                  title={git.diffBase() ? `Against ${git.diffBase()}` : 'Uncommitted'}
                  mode={config.diffView}
                  width={slotWidth()}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onToggleMode={settings.toggleDiffView}
                  staging={git.staging() && !comparison.active()}
                  onToggleStage={actions.gitToggleStageKey}
                  onClose={() => workspace.closePage()}
                />
              </box>
            </Show>
            <Show when={preview.target()}>
              {(target: () => PreviewTarget) => (
                <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={65}>
                  <PreviewPane
                    path={target().path}
                    isDir={target().isDir}
                    buffer={workspace.buffers[target().path]?.content}
                    width={slotWidth()}
                    height={slotHeight()}
                    scroll={preview.scrollRequest()}
                    onFocus={() => panes.setFocus('editor')}
                  />
                </box>
              )}
            </Show>
            <Show when={workspace.page() === 'compare'}>
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={55}>
                <ComparisonView
                  file={comparison.selectedFile()}
                  content={comparison.selectedContent()}
                  commit={comparison.selectedCommit()}
                  mode={config.diffView}
                  width={slotWidth()}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onMoveFile={comparison.moveDetail}
                  onToggleMode={settings.toggleDiffView}
                  onClose={closeComparisonDetail}
                />
              </box>
            </Show>
            <Show when={workspace.page() === 'commit'}>
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={55}>
                <ComparisonView
                  file={commitView.file()}
                  content={commitView.content()}
                  commit={commitView.commit()}
                  mode={config.diffView}
                  width={slotWidth()}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onMoveFile={commitView.moveFile}
                  onToggleMode={settings.toggleDiffView}
                  onClose={commitView.close}
                />
              </box>
            </Show>
          </box>
        </box>
      </box>
      <StatusBar
        message={status.status().msg}
        tone={status.status().tone}
        filetype={
          activeImage()
            ? 'image'
            : workspace.activePath()
              ? languageLabel(filetypeForPath(workspace.activePath()!) ?? 'plain')
              : undefined
        }
        // A viewer tab has no caret: the numbers would be wherever the editor last was.
        cursor={
          workspace.activePath() && !activeImage() && !workspace.renderedPath()
            ? editor.cursor()
            : undefined
        }
        dirty={workspace.activeBuffer()?.dirty ?? false}
        vimMode={workspace.activePath() && !activeImage() ? editor.vimMode() : null}
        repo={repoName()}
        branch={git.branch()}
        ahead={git.upstream()?.ahead ?? 0}
        behind={git.upstream()?.behind ?? 0}
        changed={git.gitStatus().size}
        problems={problemCounts()}
        focus={panes.keyPane()}
        pathUnderCursor={panes.keyPane() === 'editor' && pathUnderCursor()}
        busy={status.busy()}
        onBranch={actions.gitSwitchBranch}
        onSync={actions.gitSync}
        onChanges={() => panes.showView('git')}
        onProblems={actions.problemsList}
        onSave={workspace.saveActive}
        onGotoLine={() => promptState.setPrompt({ kind: 'gotoLine' })}
        onHint={keyboard.run}
      />
      <TooltipLayer />
      <OverlayStack ctx={ctx} commands={commands} />
    </box>
  )
}
