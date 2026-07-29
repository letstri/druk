import { dirname } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import type { AppContext } from './context'

/** True for Ctrl+Opt+<key>, however this terminal spells the second modifier. */
const chord = (key: KeyEvent) => key.shift || key.option || key.meta

/** The global keymap: everything that fires before the focused pane sees the key. */
export function installKeyboard(ctx: AppContext) {
  const { settings, tree, panes, editor, workspace, fileOps, prompts, overlays } = ctx
  const { config } = settings

  useKeyboard((key: KeyEvent) => {
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

    // Peek toggles on Ctrl+K and folds on any other key, which is what lets it
    // stand in for "hold to see" on terminals that never report a key release.
    if (key.ctrl && k === 'k') return claim(() => overlays.setPeek(p => !p))
    if (overlays.peek()) overlays.setPeek(false)

    if (key.ctrl && k === 'q') return claim(prompts.quit)
    // Ctrl+C quits from the tree. In the editor it belongs to EditorPane, which is
    // the only place that knows whether there is a selection to copy instead — the
    // renderer's own selection covers mouse drags only. Either way it
    // routes through `quit()`, so a dirty buffer still gets its prompt.
    if (key.ctrl && k === 'c' && panes.focus() !== 'editor') return claim(prompts.quit)
    // With VS Code keys, Ctrl+P opens a file — as it does there — and the palette
    // moves to Ctrl+Shift+P, a chord only kitty-protocol terminals can send as
    // distinct bytes. F1, VS Code's other palette key, works everywhere, so it
    // opens the palette under either preset.
    if (k === 'f1') return claim(() => overlays.setPalette(true))
    if (key.ctrl && k === 'p') {
      const openFile = config.keybindings === 'vscode' && !chord(key)
      return claim(() => (openFile ? overlays.setPicker('files') : overlays.setPalette(true)))
    }
    if (key.ctrl && k === 'o') return claim(() => overlays.setPicker('files'))
    if (key.ctrl && chord(key) && k === 't') return claim(workspace.reopenTab)
    // Ctrl+E is line-end in every terminal; keep the tab family on the arrows.
    if (key.ctrl && (k === 't' || k === 'up')) return claim(() => overlays.setPicker('tabs'))
    if (key.ctrl && k === 'g') return claim(() => prompts.setPrompt({ kind: 'gotoLine' }))
    if (key.ctrl && k === 's') return claim(workspace.saveActive)
    // Ctrl+Shift+<letter> is byte-identical to Ctrl+<letter> outside the kitty
    // keyboard protocol, so it cannot be bound at all in Terminal.app, plain
    // iTerm2 or tmux — hence a plain Ctrl chord for the project search. Ctrl+Opt
    // arrives as ctrl+meta (Terminal.app) or ctrl+option (iTerm2), never both.
    // In vim, Ctrl+R is redo and belongs to the editor. Project search keeps its
    // other spelling, Ctrl+Opt+F, so nothing becomes unreachable.
    const vimOwnsRedo = config.vim && panes.focus() === 'editor' && editor.vimMode() !== 'insert'
    if (key.ctrl && k === 'r' && !vimOwnsRedo) {
      return claim(() => overlays.setSearch({ scope: 'project' }))
    }
    if (key.ctrl && chord(key) && k === 'f') {
      return claim(() => overlays.setSearch({ scope: 'project' }))
    }
    if (key.ctrl && k === 'f') return claim(() => overlays.setSearch({ scope: 'file' }))
    if (key.ctrl && k === 'w') {
      return claim(() => {
        // The diff page is the frontmost "tab": close it before any file tab.
        if (overlays.diff()) return overlays.setDiff(null)
        if (workspace.activePath()) workspace.closeTab(workspace.activePath()!)
      })
    }
    if (key.ctrl && chord(key) && k === 'n') {
      return claim(() => prompts.setPrompt({ kind: 'newFolder', dir: tree.targetDir() }))
    }
    if (key.ctrl && k === 'n') {
      return claim(() => prompts.setPrompt({ kind: 'newFile', dir: tree.targetDir() }))
    }
    if (key.ctrl && k === 'b') return claim(panes.toggleSidebar)
    // macOS binds plain Ctrl+arrows to Mission Control, so they never arrive there.
    // Ctrl+Opt+arrow reports as ctrl+arrow and does reach us, and MacBooks have no
    // page keys — hence all three spellings.
    if (key.ctrl && (k === 'pageup' || k === 'left')) return claim(() => workspace.switchTab(-1))
    if (key.ctrl && (k === 'pagedown' || k === 'right')) return claim(() => workspace.switchTab(1))

    if (panes.focus() === 'editor') {
      // In vim, Esc belongs to the mode switch. Focus moves synchronously, so
      // leaving now would mean EditorPane's vim handler is already unfocused when
      // it runs and never sees the key.
      const vimOwnsEscape = config.vim && editor.vimMode() !== 'normal'
      // With the diff page up, Esc belongs to it (it closes the page) — moving
      // focus to the tree here would take the key away before it ever arrives.
      if (k === 'escape' && panes.sidebar() && !vimOwnsEscape && !overlays.diff()) {
        panes.focusTree()
      }
      return // everything else belongs to the textarea
    }

    // The cases below switch on the bare key name, so a chord that got this far
    // would fire one of them — Ctrl+D on the tree used to open the delete prompt.
    if (key.ctrl || key.meta || key.option) return

    // Solid applies focus synchronously, so without this the key that opens a
    // file also reaches the freshly focused textarea.
    key.preventDefault()
    const node = tree.selectedNode()
    const vimNav: Record<string, string> = { h: 'left', j: 'down', k: 'up', l: 'right' }
    switch (config.vim ? (vimNav[k] ?? k) : k) {
      case 'tab':
        // The diff page counts as an editor to hand focus to, file open or not.
        if (workspace.activePath() || overlays.diff()) panes.setFocus('editor')
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
      // Bare keys rather than a chord: the tree owns its keyboard while focused,
      // and every Ctrl+Opt pair worth having is already spoken for.
      case '[':
        settings.nudgeSidebar(-2)
        break
      case ']':
        settings.nudgeSidebar(2)
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
