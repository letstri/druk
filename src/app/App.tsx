import { basename, dirname } from 'node:path'

import type { BorderSides, MouseEvent } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'

import { watchAppearance } from '../core/appearance'
import { loadProjectConfig, resolveConfig } from '../core/config'
import type { Config } from '../core/config'
import { watchGitRefs, watchTree } from '../core/fs'
import { isImagePath } from '../core/image'
import { isMarkdownPath } from '../core/markdown'
import { isPdfPath } from '../core/pdf'
import { checkForUpdate, currentVersion } from '../core/update'
import { extensionProblems } from '../extensions'
import { languageLabel } from '../languages'
import { filetypeForPath } from '../languages/highlight'
import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'
import { ComparePanel } from '../ui/ComparePanel'
import { ComparisonView } from '../ui/ComparisonView'
import { DiffView } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'
import { EditorPane } from '../ui/EditorPane'
import { ExtensionsPanel } from '../ui/ExtensionsPanel'
import { FileTree } from '../ui/FileTree'
import { GitPanel } from '../ui/GitPanel'
import { ImageView } from '../ui/ImageView'
import { LspStatusView } from '../ui/LspStatusView'
import { MarkdownView } from '../ui/MarkdownView'
import { PdfView } from '../ui/PdfView'
import { PreviewPane } from '../ui/PreviewPane'
import { ReviewPanel } from '../ui/ReviewPanel'
import { SettingsView } from '../ui/SettingsView'
import { SidebarTabs } from '../ui/SidebarTabs'
import { StatusBar } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { createCommands } from './actions'
import { createBranches } from './branches'
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
import { CLASH_CHANGED, CLASH_DELETED, createWorkspace, restoreWorkspace } from './workspace'

/** The divider draws its own left edge; a box border is how it spans the height. */
const BORDER_LEFT: BorderSides[] = ['left']

/** Bounds on the drawn part of the divider: shorter reads as dirt, longer as chrome. */
const GRIP_MIN = 3
const GRIP_MAX = 9

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
  /** `druk file.ts:42:7`: 0-based column to land on, beside `openLine`. */
  openCol?: number | null
  /** The user's own settings; the project's overrides go on top of them. */
  initialConfig: Config
  /**
   * `<rootDir>/.druk/settings.json`, already read — main.tsx needs it before the
   * first render to paint the right theme, and reading it twice would be waste.
   * Left out, it is read here.
   */
  initialProject?: Partial<Config>
  /**
   * The startup checks — druk's own version, and the extension market — are
   * unconditional for users. This switch exists so the test harness can keep
   * hundreds of launches off the npm registry and off the market.
   */
  checkUpdates?: boolean
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const rootDir = props.rootDir
  const single = props.openFile ?? null

  const restored = restoreWorkspace(rootDir, single)

  const status = createStatus()
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
    // Null unless the source-control panel is the sidebar's view: the tree's own
    // cursor must not decide which repository a command acts on.
    () => (panes.view() === 'git' ? panes.gitCursor() : null),
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

  // A file whose language no installed extension serves is the market's cue.
  lsp.onMissingServer(market.suggestForFiletype)
  // Also on the quit path: the renderer tears the root down before exiting, and
  // a leaked server would outlive the editor (tests leak them per launch).
  onCleanup(lsp.dispose)
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
  const branches = createBranches({ status, git, gitOp, prompts: promptState })
  const review = createReview({
    rootDir,
    status,
    settings,
    workspace,
    git,
    panes,
  })
  const promptHandlers = createPromptHandlers({
    renderer,
    state: promptState,
    status,
    tree,
    panes,
    editor,
    workspace,
    fileOps,
    gitOp,
    branches,
    lsp,
    market,
    review,
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

  /** The active tab when it is an image — a viewer page covers the editor slot. */
  const activeImage = () => {
    const path = workspace.activePath()
    return path && isImagePath(path) ? path : null
  }

  const activePdf = () => {
    const path = workspace.activePath()
    return path && isPdfPath(path) ? path : null
  }

  /**
   * A page or a viewer is drawn over the editor's slot, so the textarea is neither
   * focused nor taking keys. Read in three places that must agree: EditorPane's
   * `focused` and `blocked`, and the Ctrl+C owner in `keyboard.ts` — where a
   * disagreement left the key belonging to a textarea that had stopped listening.
   */
  const editorCovered = () =>
    workspace.diff() !== null ||
    workspace.page() !== null ||
    comparison.detailOpen() ||
    activeImage() !== null ||
    activePdf() !== null ||
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
    comparison,
    workspace,
    navigation,
    fileOps,
    prompts: { ...promptState, ...promptHandlers },
    overlays,
  }

  /**
   * Which repository the branch and the panel header are about — named only when
   * there is more than one, where "main" alone says nothing about whose main it is.
   */
  const repoName = createMemo(() => {
    const active = git.activeRepo()
    return git.repos().length > 1 && active ? basename(active) : null
  })

  wireGitEffects({ rootDir, git, tree, editor, workspace, config: settings.config })
  wireLspEffects({ lsp, settings, workspace })
  const { commands, actions } = createCommands(ctx)
  installKeyboard(ctx, actions)

  // `revision` covers saves, git commands and anything the watcher sees in .git;
  // `reloadKey` covers a buffer replaced from disk; `diffBase` covers the branch
  // being compared against moving under it. `refreshDiff` returns at once when no
  // diff is open, so the subprocess it needs is only ever spawned for a page that
  // is actually on screen.
  //
  // It reads `gitStatus`, which `wireGitEffects` fills from the same three — and
  // does so first, since effects run in creation order and that call is above.
  createEffect(
    on(
      () => [git.revision(), editor.reloadKey(), git.diffBase()] as const,
      () => {
        actions.refreshDiff()
        comparison.refresh()
      },
    ),
  )

  const { config } = settings
  const { say } = status

  /** True between grabbing the sidebar divider and letting go. */
  const [resizing, setResizing] = createSignal(false)

  /**
   * Rows of the drawn grip — a fifth of the pane, so it stays a hint on a tall
   * terminal and does not eat a short one. The column above and below it drags
   * too; nothing here is the grab target.
   */
  const gripHeight = () =>
    Math.max(GRIP_MIN, Math.min(GRIP_MAX, Math.round((dimensions().height - 2) / 5)))

  const startResize = (event: MouseEvent) => {
    setResizing(true)
    settings.resizeSidebar(event.x)
  }

  /** Worst problem per line of the active file: the gutter dot and inline text. */
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

  /** Every problem of the active file with its range, for the span tints. */
  const problemRanges = createMemo(() => {
    const path = workspace.activePath()
    return (path ? lsp.problems[path] : undefined) ?? []
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

  /** The status page's rows, in a stable order however the servers started. */
  const serverList = createMemo(() =>
    Object.values(lsp.servers).toSorted((a, b) => a.id.localeCompare(b.id)),
  )

  /** The state of the strip's rendered-markdown button, or null when it has none.
   * Keyed on the view rather than the path: the diff tab of a .md file is a diff,
   * and its own page has nothing to render. */
  const markdownTab = () => {
    const view = workspace.activeView()
    if (!view || workspace.isDiffView(view) || !isMarkdownPath(view)) return null
    return { rendered: view === workspace.renderedPath() }
  }

  const closeComparisonDetail = () => {
    comparison.closeDetail()
    panes.focusTree()
  }

  /** The diff was opened from the source-control panel, and the panel is still
   * there to go back to. */
  const backToPanel = () => panes.sidebar() && panes.view() === 'git'

  onMount(() => {
    // A shortcut that did not take is invisible until the key is pressed and
    // nothing happens, so a bad `keybindings` entry is reported on the way in.
    const { invalid, conflicts } = settings.keymap()
    const bad = invalid[0]
    const clash = conflicts.find(entry => entry.rejected)
    // Same reason as the two above: an extension that contributes nothing because
    // its manifest is wrong looks exactly like one that is not installed.
    const badExtension = extensionProblems()[0]
    if (bad) say(`Shortcut "${bad.value}" for ${bad.label}: ${bad.reason}`, 'warn')
    else if (clash) {
      say(
        `${clash.key} is bound twice — ${clash.winner} keeps it, ${clash.loser} has no key`,
        'warn',
      )
    } else if (badExtension) {
      say(`Extension ${basename(dirname(badExtension.source))}: ${badExtension.reason}`, 'warn')
    }
    // Same refusal `druk file.ts` deserves as opening one from the tree, and for the
    // same reason: an empty editor with a status line under it looks like a bug.
    if (restored.failed) workspace.setNotice({ name: basename(single!), reason: restored.failed })
    const line = props.openLine
    const buffer = workspace.activeBuffer()
    if (line != null && buffer) {
      const lines = buffer.content.split('\n')
      const row = Math.min(line, lines.length - 1)
      editor.requestGoto(row, Math.min(props.openCol ?? 0, lines[row]!.length))
    }
  })

  // Polling, not a subscription: no OS offers one portably. `watchAppearance`
  // reports the current appearance straight away, so turning the setting on — and
  // starting with it already on — paints the matching theme without waiting a tick.
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
    // Deliberately not awaited with the version check: the market says its piece
    // in the status bar, and one slow request must not delay the other's banner.
    void market.check()
  })

  // `AVAILABLE` lists the registry rather than waiting to be searched, so opening
  // the panel is what has to guarantee there is a catalog to list. `ready` is the
  // shared first fetch, so this costs nothing when the startup check already ran,
  // and it is deliberately not gated on `extensionUpdates`: that setting silences
  // druk's own offers, and opening this panel is the user asking.
  createEffect(
    on(
      () => panes.sidebar() && panes.view() === 'extensions',
      showing => {
        if (showing) void market.ready()
      },
    ),
  )

  // The same arrangement for the review panel, and for the same reason: the
  // comments are the half of the list druk cannot know without asking, and `f`
  // is a key nobody finds. The branch is in the signal too, so a switch while
  // the panel is up re-asks — the comments belong to the branch, not to the
  // session.
  createEffect(
    on(
      () => (panes.sidebar() && panes.view() === 'review' ? git.branch() : null),
      branch => {
        if (branch) review.autoFetch()
      },
    ),
  )

  // …and puts the code the cursor points at into the editor slot beside it. The
  // remarks are drawn on their own lines, so the panel is the index and the file
  // is the review — a list of rows over an unrelated file is neither.
  // The count rather than the view alone, so the comments a fetch brings back
  // land in the editor too — arriving a second after the panel opened is the
  // ordinary case, and by then the view has not changed to fire on. The guard
  // reads focus untracked: once the keyboard has gone to the editor the user is
  // reading something, and a late fetch must not swap the file under them.
  createEffect(
    on(
      () => (panes.sidebar() && panes.view() === 'review' ? review.count() : -1),
      count => {
        if (count > 0 && panes.focus() === 'tree') actions.reviewShow()
      },
    ),
  )

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

  // A repository under the opened folder needs the same HEAD/refs watch the root
  // gets, or a commit or checkout made in it elsewhere leaves its branch and marks
  // stale. Re-subscribed as the list changes: a repository can be cloned into the
  // folder while druk is open.
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

  // The watcher has no follow-up message of its own, so unlike the git callers it
  // reports the clash itself — and clears it again once the files agree, since
  // nothing else would ever replace a warning the user has already dealt with.
  onMount(() =>
    onCleanup(
      watchTree(rootDir, changed => {
        // History moved elsewhere: nothing in the working tree need have changed, so
        // this is the only thing that tells the branch and ahead/behind to re-read.
        if (changed.git) git.bump()
        // An install replaced what every server resolves imports through, and
        // none of them is watching it — see `dependenciesChanged`.
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
      <Tabs
        tabs={workspace.views().map(id => ({
          id,
          // The diff's own tab, marked as one: a file and its diff are two tabs
          // for one path, and the strip has to say which is which. A markdown tab
          // reading as the rendered document is still the one tab, so it is the
          // same name with a mark rather than a second entry.
          name: workspace.isDiffView(id)
            ? `⇄ ${basename(id)}`
            : id === workspace.renderedPath()
              ? `¶ ${basename(id)}`
              : basename(id),
          dirty: workspace.buffers[id]?.dirty ?? false,
          preview: id === workspace.previewPath(),
        }))}
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
          <box
            width={settings.treeWidth()}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.sidebarBg}
          >
            <SidebarTabs
              // The review has no button of its own: it is a view of the change
              // the source-control panel lists, so the strip keeps Git pressed
              // while it is up — which also makes that button the way back.
              view={panes.view() === 'review' ? 'git' : panes.view()}
              focused={panes.focus() === 'tree'}
              width={settings.treeWidth()}
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
                pull={review.pull() ? `#${review.pull()!.number} ${review.pull()!.title}` : null}
                fetching={review.fetching()}
                focused={panes.focus() === 'tree'}
                width={settings.treeWidth()}
                onFocus={() => panes.setFocus('tree')}
                onActivate={actions.reviewActivate}
                onCollapseAll={actions.reviewCollapseAll}
              />
            </Show>
            <Show when={panes.view() === 'files'}>
              <FileTree
                rootName={basename(rootDir) || rootDir}
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
                  // Landing in a file is how a page closes — the tree stays
                  // interactive while one is up, like any other editor page.
                  workspace.setDiff(null)
                  workspace.setPage(null)
                  // Opening a file is the end of browsing; leaving the mode on
                  // would put the preview back over it on the way to the tree.
                  preview.close()
                  workspace.activateNode(node)
                }}
                onPin={node => workspace.pinTab(node.path)}
                onFocus={() => panes.setFocus('tree')}
                onCollapseAll={tree.collapseAll}
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
                    cursor={panes.gitCursor()}
                    focused={panes.focus() === 'tree'}
                    width={settings.treeWidth()}
                    inRepo={git.inRepo()}
                    iconTheme={settings.activeIconTheme()}
                    onFocus={() => panes.setFocus('tree')}
                    onActivate={actions.gitActivateRow}
                    onCollapseAll={actions.gitCollapseAll}
                    reviewCount={review.count()}
                    onReview={() => panes.showView('review')}
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
          {/* The sidebar's edge, and the grab target that resizes it. The whole
              column drags; only a short grip at its middle is drawn, because a
              rule the whole way down is a second vertical line beside the
              editor's gutter and reads as chrome rather than as a hint. The
              accent while dragging says the grab took. Painted in `bg`, not
              `panelBg` — the sidebar's right edge is found by where panel colour
              stops, and the resize tests measure exactly that. The sidebar
              starts at column 0, so the pointer's x is the width asked for. */}
          <box
            width={1}
            flexShrink={0}
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            backgroundColor={ui.bg}
            onMouseDown={startResize}
          >
            <box
              width={1}
              height={gripHeight()}
              flexShrink={0}
              backgroundColor={ui.bg}
              border={BORDER_LEFT}
              borderColor={resizing() ? ui.accent : ui.border}
              onMouseDown={startResize}
            />
          </box>
        </Show>
        {/* The diff pane sits over the editor's slot only, so the tabs, tree and
            status bar stay put — it reads as a view of the editor, not a modal. */}
        <box flexGrow={1} flexDirection="column">
          <EditorPane
            path={workspace.activePath()}
            content={workspace.activeBuffer()?.content ?? ''}
            rootName={basename(rootDir) || rootDir}
            branch={git.branch()}
            version={currentVersion()}
            filetype={workspace.activePath() ? filetypeForPath(workspace.activePath()!) : undefined}
            // Also unfocused while the diff or a viewer covers the pane: the
            // terminal's own cursor tracks the focused textarea and is drawn
            // over everything, so a focused editor bleeds a phantom block into
            // whatever page sits on top.
            focused={panes.focus() === 'editor' && !editorCovered()}
            reloadKey={editor.reloadKey()}
            goto={editor.goto()}
            history={editor.history()}
            edit={editor.edit()}
            lineOp={editor.lineOp()}
            foldOp={editor.foldOp()}
            vim={config.vim}
            cursorStyle={config.cursorStyle}
            wrap={config.wrap}
            tabSize={config.tabSize}
            gitLines={git.gitLines()}
            problems={problemLines()}
            problemRanges={problemRanges()}
            problemText={config.lspInline}
            reviews={review.marks()}
            reviewText={config.reviewInline}
            // Only while the panel is showing: the card is a reading aid that
            // covers the lines under it, which is a trade worth making for the
            // review and not for ordinary editing.
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
            // The diff is a page over this pane, not an overlay — but the hidden
            // textarea must still not eat keys meant for it.
            blocked={overlays.overlay() || editorCovered()}
            onChange={workspace.onEditorChange}
            onCursor={editor.setCursor}
            onSelection={editor.setSelection}
            onFocus={() => panes.setFocus('editor')}
            onVimMode={editor.setVimMode}
            onQuit={promptHandlers.quit}
          />
          <Show when={activeImage()}>
            {(path: () => string) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                <ImageView
                  path={path()}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  height={dimensions().height - 2}
                  onFocus={() => panes.setFocus('editor')}
                />
              </box>
            )}
          </Show>
          {/* Keep one owner for the App lifetime: a remount can queue its open
              before the previous instance's late document close. */}
          <PdfView
            path={activePdf()}
            width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
            height={dimensions().height - 2}
            focused={panes.focus() === 'editor'}
            blocked={
              overlays.overlay() ||
              workspace.diff() !== null ||
              workspace.page() !== null ||
              comparison.detailOpen()
            }
            onFocus={() => panes.setFocus('editor')}
          />
          <Show when={workspace.renderedPath()}>
            {(path: () => string) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                <MarkdownView
                  path={path()}
                  name={basename(path())}
                  content={workspace.buffers[path()]?.content ?? ''}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
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
                width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                focused={panes.focus() === 'editor'}
                blocked={overlays.overlay()}
                onFocus={() => panes.setFocus('editor')}
                onClose={() => workspace.setPage(null)}
              />
            </box>
          </Show>
          <Show when={workspace.page() === 'lspStatus'}>
            <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
              <LspStatusView
                servers={serverList()}
                width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                focused={panes.focus() === 'editor'}
                blocked={overlays.overlay()}
                onFocus={() => panes.setFocus('editor')}
                onRestart={actions.restartLsp}
                onUninstall={actions.uninstallServer}
                onClose={() => workspace.setPage(null)}
              />
            </box>
          </Show>
          <Show when={workspace.diff()}>
            {(file: () => DiffFile) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={50}>
                <DiffView
                  file={file()}
                  mode={config.diffView}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onToggleMode={settings.toggleDiffView}
                  escLabel={backToPanel() ? 'panel' : 'close'}
                  onClose={() => {
                    // The panel is the only thing that pages to the next change,
                    // so Esc here gives the focus back to it rather than closing:
                    // Tab into the diff would otherwise be a dead end, with the
                    // arrows scrolling and nothing left that moves to another file.
                    if (backToPanel()) panes.focusTree()
                    else workspace.setDiff(null)
                  }}
                />
              </box>
            )}
          </Show>
          {/* Above every page: it is a look at another file, and it lasts only
              as long as the tree is being walked. */}
          <Show when={preview.target()}>
            {(target: () => PreviewTarget) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={65}>
                <PreviewPane
                  path={target().path}
                  isDir={target().isDir}
                  buffer={workspace.buffers[target().path]?.content}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  height={dimensions().height - 2}
                  scroll={preview.scrollRequest()}
                  onFocus={() => panes.setFocus('editor')}
                />
              </box>
            )}
          </Show>
          <Show when={comparison.detailOpen()}>
            <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={55}>
              <ComparisonView
                file={comparison.selectedFile()}
                content={comparison.selectedContent()}
                commit={comparison.selectedCommit()}
                mode={config.diffView}
                width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                focused={panes.focus() === 'editor'}
                blocked={overlays.overlay()}
                onFocus={() => panes.setFocus('editor')}
                onMoveFile={comparison.moveDetail}
                onToggleMode={settings.toggleDiffView}
                onClose={closeComparisonDetail}
              />
            </box>
          </Show>
        </box>
      </box>
      <StatusBar
        message={status.status().msg}
        tone={status.status().tone}
        filetype={
          activeImage()
            ? 'image'
            : activePdf()
              ? 'pdf'
              : workspace.activePath()
                ? languageLabel(filetypeForPath(workspace.activePath()!) ?? 'plain')
                : undefined
        }
        // A viewer tab has no caret: the numbers would be wherever the editor last was.
        cursor={
          workspace.activePath() && !activeImage() && !activePdf() && !workspace.renderedPath()
            ? editor.cursor()
            : undefined
        }
        dirty={workspace.activeBuffer()?.dirty ?? false}
        vimMode={workspace.activePath() && !activeImage() && !activePdf() ? editor.vimMode() : null}
        repo={repoName()}
        branch={git.branch()}
        ahead={git.upstream()?.ahead ?? 0}
        behind={git.upstream()?.behind ?? 0}
        changed={git.gitStatus().size}
        problems={problemCounts()}
        focus={panes.focus()}
        busy={status.busy()}
      />
      <OverlayStack ctx={ctx} commands={commands} />
    </box>
  )
}
