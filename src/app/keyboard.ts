import { dirname } from 'node:path'

import type { KeyEvent } from '@opentui/core'

import { parentRow, rowArea, rowRel } from '../core/changeTree'
import { secondary } from '../core/keybindings'
import { useKeys } from '../ui/useKeys'
import type { CommandActions } from './commands'
import type { AppContext } from './context'
import { matchKeymap } from './keymap'

export function installKeyboard(ctx: AppContext, actions: CommandActions) {
  const {
    settings,
    tree,
    panes,
    editor,
    workspace,
    fileOps,
    prompts,
    overlays,
    git,
    comparison,
    extensions,
    preview,
    review,
    editorCovered,
  } = ctx
  const { config } = settings

  const togglePeek = () => overlays.setPeek((peeking) => !peeking)

  const editorOwnsCopy = () =>
    panes.focus() === 'editor' &&
    workspace.activePath() !== null &&
    !editorCovered()

  const handlers: Record<string, () => void> = {
    'editor.deleteLine': () => actions.lineOp('delete'),
    'editor.fold': () => actions.foldOp('fold'),
    'editor.foldAll': () => actions.foldOp('foldAll'),
    'editor.format': actions.formatDocument,
    'editor.formatOpen': actions.formatOpenFiles,
    'editor.lineStart': actions.lineHome,
    'editor.unfold': () => actions.foldOp('unfold'),
    'editor.unfoldAll': () => actions.foldOp('unfoldAll'),
    'file.copyPath': actions.copyPath,
    'file.copyRelativePath': actions.copyRelativePath,
    'file.new': () =>
      prompts.setPrompt({ dir: tree.targetDir(), kind: 'newFile' }),
    'file.newDir': () =>
      prompts.setPrompt({ dir: tree.targetDir(), kind: 'newFolder' }),
    'file.saveAll': workspace.saveAll,
    'file.saveWithoutFormatting': workspace.saveWithoutFormatting,
    'find.file': () => overlays.setSearch({ scope: 'file' }),
    'find.project': () => overlays.setSearch({ scope: 'project' }),
    'find.replace': actions.replaceInFile,
    'find.replaceProject': actions.replaceInProject,
    'git.acceptBoth': () => actions.conflictAccept('both'),
    'git.acceptOurs': () => actions.conflictAccept('ours'),
    'git.acceptTheirs': () => actions.conflictAccept('theirs'),
    'git.commit': actions.gitCommit,
    'git.compare': actions.gitCompareBranches,
    'git.conflictNext': actions.conflictNext,
    'git.conflictPrev': actions.conflictPrev,
    'git.conflictResolve': actions.conflictResolve,
    'git.diffAll': actions.gitDiffAll,
    'git.diffFile': actions.gitDiffFile,
    'git.diffLayout': actions.toggleDiffLayout,
    'git.discard': actions.gitDiscard,
    'git.graph': actions.gitCommitGraph,
    'git.openCommitWeb': actions.openCommitOnWeb,
    'git.push': actions.gitPush,
    'git.stage': actions.gitToggleStage,
    goto: () => prompts.setPrompt({ kind: 'gotoLine' }),
    'goto.definition': actions.gotoDefinition,
    'goto.file': actions.openFileUnderCursor,
    'goto.implementation': actions.gotoImplementation,
    'goto.references': actions.gotoReferences,
    'goto.symbol': actions.gotoSymbol,
    'goto.typeDefinition': actions.gotoTypeDefinition,
    'goto.workspaceSymbol': actions.gotoWorkspaceSymbol,
    help: actions.showHelp,
    'nav.back': actions.navBack,
    'nav.forward': actions.navForward,
    open: () => overlays.setPicker('files'),
    palette: () => overlays.setPalette(true),
    peek: togglePeek,
    'problems.detail': actions.problemsAtCursor,
    'problems.list': actions.problemsList,
    'problems.next': actions.problemsNext,
    'problems.prev': actions.problemsPrev,
    'problems.restart': actions.restartLsp,
    quit: prompts.quit,
    'review.note': actions.reviewNote,
    save: workspace.saveActive,
    settings: actions.openSettings,
    'tabs.close': () => {
      const view = workspace.activeView()
      if (view) {
        workspace.closeView(view)
      }
    },
    'tabs.closeAll': actions.closeAll,
    'tabs.closeOthers': actions.closeOthers,
    'tabs.next': () => workspace.switchTab(1),
    'tabs.prev': () => workspace.switchTab(-1),
    'tabs.reopen': workspace.reopenTab,
    'tabs.switch': () => overlays.setPicker('tabs'),
    'view.collapse': actions.collapseSidebar,
    'view.extensions': () => panes.toggleView('extensions'),
    'view.focus': actions.toggleFocus,
    'view.git': () => panes.toggleView('git'),
    'view.markdown': workspace.toggleRendered,
    'view.preview': actions.togglePreview,
    'view.review': () => panes.toggleView('review'),
    'view.sidebar': panes.toggleSidebar,
    'view.sidebarPosition': actions.toggleSidebarPosition,
    'view.wrap': actions.toggleWrap,
    'workspace.open': actions.openWorkspace,
    'workspace.switch': actions.switchWorkspace,
  }

  // Nothing here consumes text, so every switch reads `k`, the US key name.
  useKeys((key: KeyEvent, k: string) => {
    if (overlays.help()) {
      if (k === 'escape') {
        overlays.setHelp(false)
      }
      return
    }
    if (overlays.overlay()) {
      return
    }

    if (workspace.notice()) {
      workspace.setNotice(null)
    }

    const claim = (run: () => void) => {
      key.preventDefault()
      run()
    }

    const bound = matchKeymap(settings.keymap(), key)

    if (bound === 'peek') {
      return claim(togglePeek)
    }
    if (overlays.peek()) {
      overlays.setPeek(false)
    }

    // Ahead of the keymap, or Ctrl+Opt+C would quit.
    if (key.ctrl && k === 'c' && !secondary(key) && !editorOwnsCopy()) {
      return claim(prompts.quit)
    }

    // The open completion menu owns Ctrl+N/P, or they would open a file picker mid-word.
    if (editor.completionOpen() && key.ctrl && (k === 'n' || k === 'p')) {
      return
    }

    const vimOwnsRedo =
      config.vim && panes.focus() === 'editor' && editor.vimMode() !== 'insert'
    if (bound && !(vimOwnsRedo && key.ctrl && k === 'r')) {
      const run = handlers[bound]
      if (run) {
        return claim(run)
      }
    }

    if (panes.focus() === 'editor') {
      // Focus moves synchronously: leaving here unfocuses EditorPane before it sees Esc.
      const vimOwnsEscape = config.vim && editor.vimMode() !== 'normal'
      const pageUp =
        workspace.page() !== null || workspace.renderedPath() !== null
      if (
        k === 'escape' &&
        panes.sidebar() &&
        !vimOwnsEscape &&
        !pageUp &&
        !editor.completionOpen()
      ) {
        panes.focusTree()
      }
      return
    }

    // The cases below switch on bare key names: Ctrl+D would open the delete prompt.
    if (key.ctrl || key.meta || key.option) {
      return
    }

    // Ahead of the blanket `preventDefault` below: the commit box is a real input.
    if (panes.view() === 'git' && git.messageEditing()) {
      switch (k) {
        case 'return':
        case 'enter': {
          actions.gitCommitBox()
          break
        }
        case 'up': {
          git.walkMessageHistory(1)
          break
        }
        case 'down': {
          git.walkMessageHistory(-1)
          break
        }
        case 'escape': {
          git.setMessageEditing(false)
          break
        }
        default: {
          return
        }
      }
      key.preventDefault()
      return
    }

    if (panes.view() === 'extensions' && extensions.query() !== null) {
      switch (k) {
        case 'up': {
          extensions.move(-1)
          break
        }
        case 'down': {
          extensions.move(1)
          break
        }
        case 'return':
        case 'enter': {
          extensions.activate()
          break
        }
        case 'escape': {
          extensions.closeSearch()
          break
        }
        default: {
          return
        }
      }
      key.preventDefault()
      return
    }

    // Focus is applied synchronously: the key that opens a file would reach the textarea.
    key.preventDefault()

    if (k === '[' || k === ']') {
      return settings.nudgeSidebar(k === '[' ? -2 : 2)
    }

    const vimNav: Record<string, string> = {
      h: 'left',
      j: 'down',
      k: 'up',
      l: 'right',
    }

    // These views borrow the tree's focus slot, so their keys come before the tree's.
    if (panes.view() === 'extensions') {
      switch (config.vim ? (vimNav[k] ?? k) : k) {
        case 'tab': {
          if (key.shift) {
            panes.showView('files')
          } else if (workspace.activePath() || workspace.page()) {
            panes.setFocus('editor')
          }
          break
        }
        case 'up': {
          extensions.move(-1)
          break
        }
        case 'down': {
          extensions.move(1)
          break
        }
        case 'right': {
          extensions.fold(false)
          break
        }
        case 'left': {
          extensions.fold(true)
          break
        }
        case 'return':
        case 'enter': {
          extensions.activate()
          break
        }
        case 'backspace':
        case 'delete': {
          extensions.remove()
          break
        }
        case '/': {
          extensions.openSearch()
          break
        }
        case 'u': {
          extensions.updateAll()
          break
        }
        case 'r': {
          extensions.reload()
          break
        }
        case 'escape': {
          panes.toggleView('extensions')
          break
        }
        default: {
          break
        }
      }
      return
    }

    if (panes.view() === 'review') {
      switch (config.vim ? (vimNav[k] ?? k) : k) {
        case 'tab': {
          if (key.shift) {
            panes.showView('extensions')
          } else if (workspace.activePath() || workspace.page()) {
            panes.setFocus('editor')
          }
          break
        }
        case 'up': {
          actions.reviewMove(-1)
          break
        }
        case 'down': {
          actions.reviewMove(1)
          break
        }
        case 'right': {
          review.fold(false)
          break
        }
        case 'left': {
          review.fold(true)
          break
        }
        case 'return':
        case 'enter': {
          actions.reviewActivate(review.cursor())
          break
        }
        case 'backspace':
        case 'delete': {
          review.remove()
          break
        }
        case 'r': {
          actions.reviewReply()
          break
        }
        case 'escape': {
          panes.toggleView('review')
          break
        }
        default: {
          break
        }
      }
      return
    }

    if (panes.view() === 'git') {
      if (comparison.active()) {
        switch (config.vim ? (vimNav[k] ?? k) : k) {
          case 'b': {
            if (key.shift) {
              comparison.openBasePicker()
            } else {
              actions.gitSwitchBranch()
            }
            break
          }
          case 'c': {
            comparison.toggleMode()
            break
          }
          case '/': {
            comparison.openFilter()
            break
          }
          case 'up': {
            comparison.move(-1)
            break
          }
          case 'down': {
            comparison.move(1)
            break
          }
          case 'return':
          case 'enter': {
            comparison.openSelection()
            break
          }
          case 'tab': {
            if (comparison.detailOpen()) {
              panes.setFocus('editor')
            }
            break
          }
          case 'escape': {
            // The detail first, or the comparison would close and leave its page behind.
            if (comparison.detailOpen()) {
              comparison.closeDetail()
            } else {
              comparison.close()
            }
            break
          }
          default: {
            break
          }
        }
        return
      }
      if (key.shift && k === 'b') {
        actions.gitCompareBranches()
        return
      }
      if (key.shift && k === 's') {
        actions.toggleDiffLayout()
        return
      }

      const rows = git.rows()
      const at = Math.max(0, Math.min(git.gitCursor(), rows.length - 1))
      const row = rows[at]
      switch (config.vim ? (vimNav[k] ?? k) : k) {
        case 'tab': {
          if (key.shift) {
            panes.showView('review')
          } else if (workspace.activePath() || workspace.page()) {
            panes.setFocus('editor')
          }
          break
        }
        case 'up': {
          actions.gitMoveTo(at - 1)
          break
        }
        case 'down': {
          actions.gitMoveTo(at + 1)
          break
        }
        case 'right': {
          if (
            row &&
            row.kind !== 'file' &&
            row.kind !== 'commit' &&
            row.collapsed
          ) {
            git.toggleCollapsed(rowArea(row), rowRel(row))
          }
          break
        }
        case 'left': {
          if (
            row &&
            row.kind !== 'file' &&
            row.kind !== 'commit' &&
            !row.collapsed
          ) {
            git.toggleCollapsed(rowArea(row), rowRel(row))
          } else if (row) {
            actions.gitMoveTo(parentRow(rows, at))
          }
          break
        }
        case 'return':
        case 'enter': {
          actions.gitOpenRow(at)
          break
        }
        case 'space': {
          actions.gitToggleStage()
          break
        }
        case 'c': {
          actions.gitFocusMessage()
          break
        }
        case 'd': {
          actions.gitDiscard()
          break
        }
        case 'p': {
          actions.gitPush()
          break
        }
        case 's': {
          actions.gitSync()
          break
        }
        case 'a': {
          actions.gitDiffAll()
          break
        }
        case 'g': {
          actions.gitCommitGraph()
          break
        }
        case 'b': {
          actions.gitSwitchBranch()
          break
        }
        case 'w': {
          actions.switchWorktree()
          break
        }
        case 'r': {
          panes.showView('review')
          break
        }
        case 'escape': {
          // A page this panel opened first, or the panel would go and leave it behind.
          if (
            workspace.page() === 'commit' ||
            workspace.page() === 'allChanges' ||
            workspace.page() === 'graph'
          ) {
            workspace.closePage()
          } else {
            panes.toggleView('git')
          }
          break
        }
        default: {
          break
        }
      }
      return
    }

    const node = tree.selectedNode()
    switch (config.vim ? (vimNav[k] ?? k) : k) {
      case 'tab': {
        if (key.shift) {
          panes.showView('git')
        } else if (workspace.activePath() || workspace.page()) {
          panes.setFocus('editor')
        }
        break
      }
      case 'up': {
        if (key.shift) {
          tree.extendSelection(-1)
        } else {
          tree.moveSelection(-1)
        }
        break
      }
      case 'down': {
        if (key.shift) {
          tree.extendSelection(1)
        } else {
          tree.moveSelection(1)
        }
        break
      }
      case 'right': {
        if (node?.isDir && !tree.expanded().has(node.path)) {
          tree.toggleExpand(node.path)
        } else {
          tree.moveSelection(1)
        }
        break
      }
      case 'left': {
        if (node?.isDir && tree.expanded().has(node.path)) {
          tree.toggleExpand(node.path)
        } else if (node) {
          tree.setSelectedPath(dirname(node.path))
        }
        break
      }
      case 'return':
      case 'enter': {
        if (node && !node.isDir) {
          preview.close()
        }
        if (node) {
          workspace.activateNode(node)
        }
        break
      }
      case 'space': {
        preview.toggle()
        break
      }
      case 'pageup': {
        if (preview.target()) {
          preview.scroll(-1)
        }
        break
      }
      case 'pagedown': {
        if (preview.target()) {
          preview.scroll(1)
        }
        break
      }
      case 'a': {
        prompts.setPrompt({
          dir: tree.targetDir(),
          kind: key.shift ? 'newFolder' : 'newFile',
        })
        break
      }
      case 'r': {
        if (node) {
          prompts.setPrompt({ kind: 'rename', target: node.path })
        }
        break
      }
      case 'x': {
        fileOps.takeForPaste('cut')
        break
      }
      case 'c': {
        fileOps.takeForPaste('copy')
        break
      }
      case 'p': {
        fileOps.paste()
        break
      }
      case 'escape': {
        if (preview.target()) {
          preview.close()
        } else if (fileOps.clipboard().paths.length > 0) {
          fileOps.cancelTake()
        } else if (tree.marked().length > 0) {
          tree.clearMarks()
        }
        break
      }
      case 'd':
      case 'delete':
      case 'backspace': {
        const targets = tree.actionTargets()
        if (targets.length > 0) {
          prompts.setPrompt({ kind: 'delete', targets })
        }
        break
      }
      default: {
        break
      }
    }
  })

  return { run: (id: string) => handlers[id]?.() }
}
