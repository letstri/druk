import { createSignal } from 'solid-js'

import type { KeyScope } from '../ui/keys'
import type { SidebarView } from '../ui/SidebarTabs'
import type { Tree } from './tree'
import type { Focus } from './types'

export function createPanes(tree: Tree, initialSidebar: boolean) {
  const [sidebar, setSidebar] = createSignal(initialSidebar)
  const [focus, setFocus] = createSignal<Focus>(
    initialSidebar ? 'tree' : 'editor'
  )
  const [view, setView] = createSignal<SidebarView>('files')

  const focusTree = () => {
    // Revealing in a tree not on screen expands folders that stay expanded when it returns.
    if (view() !== 'files') {
      return setFocus('tree')
    }
    const path = tree.selectedPath()
    if (path) {
      tree.reveal(path)
    }
    if (!tree.nodes().some((n) => n.path === tree.selectedPath())) {
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

  const showView = (next: SidebarView) => {
    setView(next)
    setSidebar(true)
    focusTree()
  }

  const toggleView = (next: Exclude<SidebarView, 'files'>) =>
    showView(sidebar() && view() === next ? 'files' : next)

  const keyPane = (): KeyScope => {
    const showing = view()
    return focus() === 'tree' && showing !== 'files' ? showing : focus()
  }

  return {
    focus,
    focusTree,
    keyPane,
    setFocus,
    showView,
    sidebar,
    toggleSidebar,
    toggleView,
    view,
  }
}

export type Panes = ReturnType<typeof createPanes>
