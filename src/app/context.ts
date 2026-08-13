import type { Branches } from './branches'
import type { CommitView } from './commitView'
import type { Comparison } from './comparison'
import type { EditorBridge } from './editor'
import type { ExtensionsPanel } from './extensionsPanel'
import type { FileOps } from './fileOps'
import type { Git, GitOp } from './git'
import type { Lsp } from './lsp'
import type { Market } from './market'
import type { Navigation } from './navigation'
import type { Overlays } from './Overlays'
import type { Panes } from './panes'
import type { Preview } from './preview'
import type { PromptHandlers, PromptState } from './prompts'
import type { Review } from './review'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/** Every controller, assembled once in App and handed to the wiring that spans them. */
export interface AppContext {
  rootDir: string
  /** A page or viewer covers the editor's slot, so its textarea takes no keys. */
  editorCovered: () => boolean
  status: Status
  settings: Settings
  tree: Tree
  panes: Panes
  preview: Preview
  editor: EditorBridge
  git: Git
  gitOp: GitOp
  lsp: Lsp
  market: Market
  extensions: ExtensionsPanel
  review: Review
  branches: Branches
  commitView: CommitView
  comparison: Comparison
  workspace: Workspace
  navigation: Navigation
  fileOps: FileOps
  prompts: PromptState & PromptHandlers
  overlays: Overlays
}
