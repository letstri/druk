import { dirname } from 'node:path'

import type { KeyEvent } from '@opentui/core'

import { parentRow } from '../core/changeTree'
import { useKeys } from '../ui/useKeys'
import type { CommandActions } from './commands'
import type { AppContext } from './context'
import { matchKeymap } from './keymap'

/** The global keymap: everything that fires before the focused pane sees the key. */
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
    editorCovered,
  } = ctx
  const { config } = settings

  const togglePeek = () => overlays.setPeek(peeking => !peeking)

  /**
   * Whether EditorPane's own Ctrl+C handler will run — it needs the focus slot, a
   * live textarea and nothing drawn over it. Holding the focus slot is not enough:
   * a page or viewer keeps it while taking no keys, and a tab-less editor has no
   * buffer to copy from, so deferring on `focus()` alone left Ctrl+C owned by
   * nobody on the welcome screen and under every page.
   */
  const editorOwnsCopy = () =>
    panes.focus() === 'editor' && workspace.activePath() !== null && !editorCovered()

  /**
   * What each bindable command does when its key arrives — see `keymap.ts` for the
   * keys themselves. Every id in `BINDABLE` needs an entry here or its key is dead,
   * which is what `test/keymap.test.ts` checks.
   */
  const handlers: Record<string, () => void> = {
    'palette': () => overlays.setPalette(true),
    'peek': togglePeek,
    'open': () => overlays.setPicker('files'),
    'save': workspace.saveActive,
    'goto': () => prompts.setPrompt({ kind: 'gotoLine' }),
    'goto.definition': actions.gotoDefinition,
    'goto.file': actions.openFileUnderCursor,
    'find.file': () => overlays.setSearch({ scope: 'file' }),
    'find.project': () => overlays.setSearch({ scope: 'project' }),
    'find.replace': actions.replaceInFile,
    'find.replaceProject': actions.replaceInProject,
    'file.new': () => prompts.setPrompt({ kind: 'newFile', dir: tree.targetDir() }),
    'file.newDir': () => prompts.setPrompt({ kind: 'newFolder', dir: tree.targetDir() }),
    'tabs.close': () => {
      // A page is the frontmost "tab": close it before any file tab.
      if (workspace.page()) return workspace.setPage(null)
      if (workspace.diff()) return workspace.setDiff(null)
      if (comparison.detailOpen()) return comparison.closeDetail()
      if (workspace.activePath()) workspace.closeTab(workspace.activePath()!)
    },
    'tabs.reopen': workspace.reopenTab,
    'tabs.switch': () => overlays.setPicker('tabs'),
    'tabs.prev': () => workspace.switchTab(-1),
    'tabs.next': () => workspace.switchTab(1),
    'nav.back': actions.navBack,
    'nav.forward': actions.navForward,
    'tabs.closeOthers': actions.closeOthers,
    'tabs.closeAll': actions.closeAll,
    'view.sidebar': panes.toggleSidebar,
    'view.git': panes.toggleGitView,
    'view.extensions': panes.toggleExtensionsView,
    'view.collapse': actions.collapseSidebar,
    'view.markdown': workspace.toggleRendered,
    'view.wrap': actions.toggleWrap,
    'view.focus': actions.toggleFocus,
    'git.diffFile': actions.gitDiffFile,
    'git.commit': actions.gitCommit,
    'git.push': actions.gitPush,
    'git.compare': actions.gitCompareBranches,
    'problems.list': actions.problemsList,
    'problems.next': actions.problemsNext,
    'problems.prev': actions.problemsPrev,
    'problems.restart': actions.restartLsp,
    'settings': actions.openSettings,
    'help': actions.showHelp,
    'quit': prompts.quit,
  }

  useKeys((key: KeyEvent) => {
    const k = key.name

    // Overlays own their keys (handled inside their own components).
    if (overlays.help()) {
      if (k === 'escape') overlays.setHelp(false)
      return
    }
    if (overlays.overlay()) return

    // The refusal has been read by the time another key is pressed. Dismissed here
    // rather than on a timer, so it cannot vanish while it is still being read.
    if (workspace.notice()) workspace.setNotice(null)

    /**
     * Run a global chord and hide the key from the textarea, which binds many of
     * the same ones itself — Ctrl+W deletes a word, Ctrl+F/Ctrl+B move the caret,
     * Ctrl+←/→ jump a word. Without this, closing a tab also ate a word.
     */
    const claim = (run: () => void) => {
      key.preventDefault()
      run()
    }

    const bound = matchKeymap(settings.keymap(), key)

    // Peek toggles on its own key and folds on any other, which is what lets it
    // stand in for "hold to see" on terminals that never report a key release.
    if (bound === 'peek') return claim(togglePeek)
    if (overlays.peek()) overlays.setPeek(false)

    // Ctrl+C quits from the tree. In the editor it belongs to EditorPane, which is
    // the only place that knows whether there is a selection to copy instead — the
    // renderer's own selection covers mouse drags only. Either way it
    // routes through `quit()`, so a dirty buffer still gets its prompt. Not a
    // bindable command: the two meanings are split across two owners.
    if (key.ctrl && k === 'c' && !editorOwnsCopy()) return claim(prompts.quit)

    // In vim, Ctrl+R is redo and belongs to the editor, whatever the keymap says it
    // runs. Project search keeps its other spelling, Ctrl+Opt+F, so nothing becomes
    // unreachable — and a shortcut deliberately rebound onto Ctrl+R still loses it
    // here, since the editor's own redo has no second spelling to fall back on.
    const vimOwnsRedo = config.vim && panes.focus() === 'editor' && editor.vimMode() !== 'insert'
    if (bound && !(vimOwnsRedo && key.ctrl && k === 'r')) {
      const run = handlers[bound]
      if (run) return claim(run)
    }

    if (panes.focus() === 'editor') {
      // In vim, Esc belongs to the mode switch. Focus moves synchronously, so
      // leaving now would mean EditorPane's vim handler is already unfocused when
      // it runs and never sees the key.
      const vimOwnsEscape = config.vim && editor.vimMode() !== 'normal'
      // With a page up, Esc belongs to it (it closes the page) — moving
      // focus to the tree here would take the key away before it ever arrives.
      // Same when the completion menu is open: Esc dismisses it in EditorPane.
      const pageUp =
        workspace.diff() !== null ||
        workspace.page() !== null ||
        comparison.detailOpen() ||
        workspace.renderedPath() !== null
      if (
        k === 'escape' &&
        panes.sidebar() &&
        !vimOwnsEscape &&
        !pageUp &&
        !editor.completionOpen()
      ) {
        panes.focusTree()
      }
      return // everything else belongs to the textarea
    }

    // The cases below switch on the bare key name, so a chord that got this far
    // would fire one of them — Ctrl+D on the tree used to open the delete prompt.
    if (key.ctrl || key.meta || key.option) return

    // Ahead of the blanket `preventDefault` below, and the only branch that is:
    // the extensions panel's search is a real input, so while it is up the
    // printable keys are its. Claiming them here would swallow the typing.
    if (panes.view() === 'extensions' && extensions.query() !== null) {
      switch (k) {
        case 'up':
          extensions.move(-1)
          break
        case 'down':
          extensions.move(1)
          break
        case 'return':
        case 'enter':
          extensions.activate()
          break
        case 'escape':
          extensions.closeSearch()
          break
        default:
          return // the field's
      }
      key.preventDefault()
      return
    }

    // Solid applies focus synchronously, so without this the key that opens a
    // file also reaches the freshly focused textarea.
    key.preventDefault()

    // Bare keys rather than a chord: the sidebar's panes own their keyboard while
    // focused, and every Ctrl+Opt pair worth having is already spoken for. Ahead
    // of the per-pane switches because the width belongs to the sidebar, not to
    // whichever of them is showing.
    if (k === '[' || k === ']') return settings.nudgeSidebar(k === '[' ? -2 : 2)

    const vimNav: Record<string, string> = { h: 'left', j: 'down', k: 'up', l: 'right' }

    // The extensions panel borrows the tree's focus slot, so its keys replace the
    // tree's while it shows — or `d` would still offer to delete files.
    if (panes.view() === 'extensions') {
      switch (config.vim ? (vimNav[k] ?? k) : k) {
        case 'tab':
          // Shift+Tab walks the tab strip above the sidebar, the way it walks
          // any other one; plain Tab keeps handing the keyboard to the editor.
          if (key.shift) panes.showView('files')
          else if (workspace.activePath() || workspace.diff()) panes.setFocus('editor')
          break
        case 'up':
          extensions.move(-1)
          break
        case 'down':
          extensions.move(1)
          break
        case 'right':
          extensions.fold(false)
          break
        case 'left':
          extensions.fold(true)
          break
        case 'return':
        case 'enter':
          extensions.activate()
          break
        case 'backspace':
        case 'delete':
          extensions.remove()
          break
        case '/':
          extensions.openSearch()
          break
        case 'u':
          extensions.updateAll()
          break
        case 'r':
          extensions.reload()
          break
        case 'escape':
          panes.toggleExtensionsView()
          break
      }
      return
    }

    // The source-control panel borrows the tree's focus slot, so its keys replace
    // the tree's while it shows — or `d` would still offer to delete files.
    if (panes.view() === 'git') {
      // Comparison takes the panel's keyboard over while it is up: its list is a
      // different list, and `d`/`Esc` mean different things there.
      if (comparison.active()) {
        switch (config.vim ? (vimNav[k] ?? k) : k) {
          case 'b':
            if (key.shift) comparison.openBasePicker()
            else actions.gitSwitchBranch()
            break
          case 'c':
            comparison.toggleMode()
            break
          case '/':
            comparison.openFilter()
            break
          case 'up':
            comparison.move(-1)
            break
          case 'down':
            comparison.move(1)
            break
          case 'return':
          case 'enter':
            comparison.openSelection()
            break
          case 'tab':
            if (comparison.detailOpen()) panes.setFocus('editor')
            break
          case 'escape':
            // The detail sits on top of the panel: Esc dismisses that first, or
            // the comparison would close and leave the page it opened behind.
            if (comparison.detailOpen()) comparison.closeDetail()
            else comparison.close()
            break
        }
        return
      }
      if (key.shift && k === 'b') {
        actions.gitCompareBranches()
        return
      }

      const rows = git.rows()
      const at = Math.max(0, Math.min(panes.gitCursor(), rows.length - 1))
      const row = rows[at]
      /** The cursor is the diff's pager: the page follows it, so `gitMoveTo` is
       * the only way through the changes. */
      const goTo = actions.gitMoveTo
      switch (config.vim ? (vimNav[k] ?? k) : k) {
        case 'tab':
          // Shift+Tab walks the tab strip above the sidebar, the way it walks any
          // other one; plain Tab keeps handing the keyboard to the editor.
          if (key.shift) panes.showView('extensions')
          else if (workspace.activePath() || workspace.diff()) panes.setFocus('editor')
          break
        case 'up':
          goTo(at - 1)
          break
        case 'down':
          goTo(at + 1)
          break
        // Folder rows fold as the tree's do. On a file, ← walks out to the folder
        // holding it, which is the only way back to a row the arrows have passed.
        case 'right':
          if (row?.kind === 'dir' && row.collapsed) git.toggleCollapsed(row.rel)
          break
        case 'left':
          if (row?.kind === 'dir' && !row.collapsed) git.toggleCollapsed(row.rel)
          else if (row) goTo(parentRow(rows, at))
          break
        case 'return':
        case 'enter':
          actions.gitActivateRow(at)
          break
        case 'c':
          actions.gitCommit()
          break
        case 'p':
          actions.gitPush()
          break
        case 'b':
          actions.gitSwitchBranch()
          break
        case 'escape':
          // A diff opened from this panel sits on top of it: Esc dismisses that
          // first, or the panel would close and leave the page it opened behind,
          // with no key here that closes it.
          if (workspace.diff()) workspace.setDiff(null)
          else panes.toggleGitView()
          break
      }
      return
    }

    const node = tree.selectedNode()
    switch (config.vim ? (vimNav[k] ?? k) : k) {
      case 'tab':
        // Shift+Tab walks the tab strip above the sidebar (see the panel's copy).
        if (key.shift) panes.showView('git')
        // A page counts as an editor to hand focus to, file open or not.
        else if (workspace.activePath() || workspace.diff() || workspace.page()) {
          panes.setFocus('editor')
        }
        break
      case 'up':
        if (key.shift) tree.extendSelection(-1)
        else tree.moveSelection(-1)
        break
      case 'down':
        if (key.shift) tree.extendSelection(1)
        else tree.moveSelection(1)
        break
      case 'right':
        if (node?.isDir && !tree.expanded().has(node.path)) tree.toggleExpand(node.path)
        else tree.moveSelection(1)
        break
      case 'left':
        if (node?.isDir && tree.expanded().has(node.path)) tree.toggleExpand(node.path)
        else if (node) tree.setSelectedPath(dirname(node.path))
        break
      case 'return':
      case 'enter':
        if (node) workspace.activateNode(node)
        break
      case 'a':
        prompts.setPrompt({ kind: key.shift ? 'newFolder' : 'newFile', dir: tree.targetDir() })
        break
      case 'r':
        if (node) prompts.setPrompt({ kind: 'rename', target: node.path })
        break
      // Cut, copy and paste rather than a "move to…" prompt: the tree is already the
      // way to choose a folder, and typing a destination path is the thing it exists
      // to save you from.
      case 'x':
        fileOps.takeForPaste('cut')
        break
      case 'c':
        fileOps.takeForPaste('copy')
        break
      case 'p':
        fileOps.paste()
        break
      case 'escape':
        if (fileOps.clipboard().paths.length > 0) fileOps.cancelTake()
        else if (tree.marked().length > 0) tree.clearMarks()
        break
      case 'd':
      case 'delete':
      case 'backspace': {
        const targets = tree.actionTargets()
        if (targets.length > 0) prompts.setPrompt({ kind: 'delete', targets })
        break
      }
    }
  })
}
