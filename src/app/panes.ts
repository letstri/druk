import { createSignal } from 'solid-js'

import type { KeyScope } from '../ui/keys'
import type { SidebarView } from '../ui/SidebarTabs'
import type { Tree } from './tree'
import type { Focus } from './types'

/** Which pane the keyboard belongs to, whether the sidebar is on screen, and
 * which of its views — the file tree, the source-control panel or the extensions
 * panel — it shows. */
export function createPanes(tree: Tree, initialSidebar: boolean) {
  const [sidebar, setSidebar] = createSignal(initialSidebar)
  const [focus, setFocus] = createSignal<Focus>(initialSidebar ? 'tree' : 'editor')
  const [view, setView] = createSignal<SidebarView>('files')
  /** Row under the cursor in the source-control panel; clamped where it is read,
   * because the change list shrinks under it on every commit. */
  const [gitCursor, setGitCursor] = createSignal(0)

  // Focus is useless without a visible cursor: a file opened from the picker or a
  // tab may sit in a collapsed folder, leaving no row to highlight.
  const focusTree = () => {
    // The other views borrow this focus slot. Revealing here would expand
    // folders in a tree that is not on screen, and the expansion would still be
    // there when it comes back.
    if (view() !== 'files') return setFocus('tree')
    const path = tree.selectedPath()
    if (path) tree.reveal(path)
    if (!tree.nodes().some(n => n.path === tree.selectedPath())) {
      tree.setSelectedPath(tree.nodes()[0]?.path ?? null)
    }
    setFocus('tree')
  }

  const toggleSidebar = () => {
    if (sidebar()) {
      setSidebar(false)
      setFocus('editor')
      return
    }
    setSidebar(true)
    focusTree()
  }

  /** Open the sidebar on one of its views, as the tab strip above it does. */
  const showView = (next: SidebarView) => {
    setView(next)
    setSidebar(true)
    focusTree()
  }

  /** Ctrl+Opt+G, as VS Code's Ctrl+Shift+G: show the panel, or put the tree back. */
  const toggleGitView = () => {
    if (sidebar() && view() === 'git') return showView('files')
    showView('git')
  }

  /** Ctrl+Opt+X, as VS Code's Ctrl+Shift+X, and the same in-and-out as git's. */
  const toggleExtensionsView = () => {
    if (sidebar() && view() === 'extensions') return showView('files')
    showView('extensions')
  }

  /**
   * Ctrl+Opt+R: the review notes and the pull request's comments. Out is the
   * source-control panel rather than the tree — the review has no button in the
   * strip, it is reached from that panel's header, and landing anywhere else
   * would leave no way back to where the ◆ was pressed.
   */
  const toggleReviewView = () => {
    if (sidebar() && view() === 'review') return showView('git')
    showView('review')
  }

  /** Which keymap is live, for the peek strip: the other views have keys of their
   * own and show under the tree's focus. */
  const keyPane = (): KeyScope => {
    const showing = view()
    return focus() === 'tree' && showing !== 'files' ? showing : focus()
  }

  return {
    sidebar,
    focus,
    setFocus,
    focusTree,
    toggleSidebar,
    view,
    showView,
    toggleGitView,
    toggleExtensionsView,
    toggleReviewView,
    keyPane,
    gitCursor,
    setGitCursor,
  }
}

export type Panes = ReturnType<typeof createPanes>
